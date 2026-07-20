use crate::process_identity::{ProcessIdentity, ProcessInspector};
use crate::process_registry::{terminate_process, ProcessRegistry, RegistryError};
use crate::telemetry::LedgerHealth;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const PROTOCOL_VERSION: u16 = 1;
pub const IPC_MAX_REQUEST_BYTES: u64 = 16 * 1024;
pub const IPC_MAX_RESPONSE_BYTES: usize = 16 * 1024;
pub const IPC_QUEUE_CAPACITY: usize = 32;
pub const IPC_WORKER_COUNT: usize = 4;
const IPC_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementMode {
    ActiveEnforcement,
    #[default]
    AuditOnly,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeControlRequest {
    pub protocol_version: u16,
    pub request_id: String,
    pub capability: String,
    pub command: NativeControlCommand,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeControlCommand {
    Health,
    SetAuditMode { enabled: bool },
    RegisterProcess { process: ProcessIdentity },
    UnregisterProcess { process: ProcessIdentity },
    IsolateProcess { process: ProcessIdentity },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentHealth {
    Ready,
    WriteFailed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHealth {
    pub status: String,
    pub watcher: ComponentHealth,
    pub ledger: ComponentHealth,
    pub ipc: ComponentHealth,
    pub mode: EnforcementMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeControlResponse {
    pub protocol_version: u16,
    pub request_id: String,
    pub ok: bool,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_process_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<DaemonHealth>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEndpointRecord {
    pub protocol_version: u16,
    pub endpoint: PathBuf,
    pub pid: u32,
    pub started_at: String,
    pub capability_file: PathBuf,
}

pub struct ControlState {
    pub registry: Arc<ProcessRegistry>,
    pub mode: Arc<RwLock<EnforcementMode>>,
    pub ledger_health: Arc<RwLock<LedgerHealth>>,
    pub inspector: Arc<dyn ProcessInspector>,
}

pub struct IpcRuntime {
    pub endpoint: PathBuf,
    pub capability_file: PathBuf,
    pub worker: JoinHandle<()>,
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or(0) ^ right.get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}

fn response(request_id: String, ok: bool, code: &str) -> NativeControlResponse {
    NativeControlResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        ok,
        code: code.to_owned(),
        active_process_count: None,
        health: None,
    }
}

fn registry_code(error: RegistryError) -> &'static str {
    match error {
        RegistryError::AlreadyRegistered => "process_already_registered",
        RegistryError::IdentityMismatch => "process_identity_mismatch",
        RegistryError::Inspector(_) => "process_inspection_failed",
        RegistryError::InvalidPid => "invalid_process_id",
        RegistryError::NotRegistered => "process_not_registered",
        RegistryError::RegistryUnavailable => "registry_unavailable",
        RegistryError::SignalFailed(_) => "isolation_failed",
        RegistryError::StaleProcess => "stale_process_identity",
    }
}

pub fn handle_request(
    request: NativeControlRequest,
    expected_capability: &str,
    state: &ControlState,
) -> NativeControlResponse {
    let request_id = request.request_id;
    if request.protocol_version != PROTOCOL_VERSION {
        return response(request_id, false, "unsupported_protocol_version");
    }
    if request_id.is_empty() || request_id.len() > 128 {
        return response(String::new(), false, "invalid_request_id");
    }
    if !constant_time_equal(&request.capability, expected_capability) {
        return response(request_id, false, "unauthorized");
    }

    match request.command {
        NativeControlCommand::Health => {
            let mode = state
                .mode
                .read()
                .map_or(EnforcementMode::ActiveEnforcement, |mode| *mode);
            let ledger = state
                .ledger_health
                .read()
                .map_or(LedgerHealth::WriteFailed, |health| *health);
            let degraded = ledger == LedgerHealth::WriteFailed;
            NativeControlResponse {
                protocol_version: PROTOCOL_VERSION,
                request_id,
                ok: true,
                code: if degraded { "degraded" } else { "ready" }.to_owned(),
                active_process_count: Some(state.registry.active_count()),
                health: Some(DaemonHealth {
                    status: if degraded { "degraded" } else { "healthy" }.to_owned(),
                    watcher: ComponentHealth::Ready,
                    ledger: if degraded {
                        ComponentHealth::WriteFailed
                    } else {
                        ComponentHealth::Ready
                    },
                    ipc: ComponentHealth::Ready,
                    mode,
                }),
            }
        }
        NativeControlCommand::SetAuditMode { enabled } => {
            let next = if enabled {
                EnforcementMode::AuditOnly
            } else {
                EnforcementMode::ActiveEnforcement
            };
            match state.mode.write() {
                Ok(mut mode) => {
                    *mode = next;
                    response(request_id, true, "audit_mode_updated")
                }
                Err(_) => response(request_id, false, "mode_state_unavailable"),
            }
        }
        NativeControlCommand::RegisterProcess { process } => {
            match state.registry.register(process, state.inspector.as_ref()) {
                Ok(()) => response(request_id, true, "process_registered"),
                Err(error) => response(request_id, false, registry_code(error)),
            }
        }
        NativeControlCommand::UnregisterProcess { process } => {
            match state.registry.unregister(&process) {
                Ok(()) => response(request_id, true, "process_unregistered"),
                Err(error) => response(request_id, false, registry_code(error)),
            }
        }
        NativeControlCommand::IsolateProcess { process } => {
            let audit_only = state
                .mode
                .read()
                .is_ok_and(|mode| *mode == EnforcementMode::AuditOnly);
            if audit_only {
                return response(request_id, false, "audit_only");
            }
            match state
                .registry
                .isolate_with(&process, state.inspector.as_ref(), terminate_process)
            {
                Ok(()) => response(request_id, true, "process_isolated"),
                Err(error) => response(request_id, false, registry_code(error)),
            }
        }
    }
}

fn generate_capability() -> Result<String, io::Error> {
    let mut bytes = [0_u8; 32];
    OpenOptions::new()
        .read(true)
        .open("/dev/urandom")?
        .read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), io::Error> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(contents)?;
    file.sync_all()?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

fn peer_is_current_user(stream: &UnixStream) -> bool {
    #[cfg(any(
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    {
        nix::unistd::getpeereid(stream)
            .map(|(uid, _)| uid == nix::unistd::geteuid())
            .unwrap_or(false)
    }
    #[cfg(target_os = "linux")]
    {
        use nix::sys::socket::{getsockopt, sockopt::PeerCredentials};
        getsockopt(stream, PeerCredentials)
            .map(|credentials| credentials.uid() == nix::unistd::geteuid().as_raw())
            .unwrap_or(false)
    }
}

fn handle_connection(
    mut stream: UnixStream,
    capability: &str,
    state: &ControlState,
) -> Result<(), io::Error> {
    stream.set_read_timeout(Some(IPC_TIMEOUT))?;
    stream.set_write_timeout(Some(IPC_TIMEOUT))?;
    if !peer_is_current_user(&stream) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC peer UID does not match daemon owner",
        ));
    }
    let mut payload = String::new();
    let bytes =
        BufReader::new((&mut stream).take(IPC_MAX_REQUEST_BYTES + 1)).read_line(&mut payload)?;
    let result = if bytes as u64 > IPC_MAX_REQUEST_BYTES {
        response(String::new(), false, "request_too_large")
    } else {
        match serde_json::from_str::<NativeControlRequest>(&payload) {
            Ok(request) => handle_request(request, capability, state),
            Err(_) => response(String::new(), false, "malformed_request"),
        }
    };
    let mut serialized = serde_json::to_vec(&result)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    serialized.push(b'\n');
    if serialized.len() > IPC_MAX_RESPONSE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response too large",
        ));
    }
    stream.write_all(&serialized)?;
    stream.flush()
}

fn worker_loop(
    receiver: Arc<Mutex<Receiver<UnixStream>>>,
    capability: Arc<String>,
    state: Arc<ControlState>,
) {
    loop {
        let stream = match receiver.lock() {
            Ok(receiver) => receiver.recv(),
            Err(_) => return,
        };
        match stream {
            Ok(stream) => {
                if let Err(error) = handle_connection(stream, &capability, &state) {
                    eprintln!("[IPC ERROR] request rejected: {error}");
                }
            }
            Err(_) => return,
        }
    }
}

pub fn start_ipc(
    runtime_directory: &Path,
    state: Arc<ControlState>,
) -> Result<IpcRuntime, io::Error> {
    fs::create_dir_all(runtime_directory)?;
    fs::set_permissions(runtime_directory, fs::Permissions::from_mode(0o700))?;
    let endpoint = runtime_directory.join("daemon.sock");
    let capability_file = runtime_directory.join("capability");
    let endpoint_record = runtime_directory.join("daemon.json");
    if endpoint.exists() {
        if UnixStream::connect(&endpoint).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "a Krypton daemon is already listening for this workspace",
            ));
        }
        fs::remove_file(&endpoint)?;
    }
    let capability = Arc::new(generate_capability()?);
    write_private_file(&capability_file, capability.as_bytes())?;
    let listener = UnixListener::bind(&endpoint)?;
    fs::set_permissions(&endpoint, fs::Permissions::from_mode(0o600))?;
    let record = RuntimeEndpointRecord {
        protocol_version: PROTOCOL_VERSION,
        endpoint: endpoint.clone(),
        pid: std::process::id(),
        started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        capability_file: capability_file.clone(),
    };
    write_private_file(
        &endpoint_record,
        &serde_json::to_vec_pretty(&record)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
    )?;
    let (sender, receiver) = sync_channel::<UnixStream>(IPC_QUEUE_CAPACITY);
    let receiver = Arc::new(Mutex::new(receiver));
    for _ in 0..IPC_WORKER_COUNT {
        let receiver = Arc::clone(&receiver);
        let capability = Arc::clone(&capability);
        let state = Arc::clone(&state);
        thread::spawn(move || worker_loop(receiver, capability, state));
    }
    let worker = thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    if sender.send(stream).is_err() {
                        return;
                    }
                }
                Err(error) => eprintln!("[IPC ERROR] accept failed: {error}"),
            }
        }
    });
    Ok(IpcRuntime {
        endpoint,
        capability_file,
        worker,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        handle_request, ControlState, EnforcementMode, NativeControlCommand, NativeControlRequest,
        PROTOCOL_VERSION,
    };
    use crate::process_identity::{ProcessIdentity, ProcessIdentityError, ProcessInspector};
    use crate::process_registry::ProcessRegistry;
    use crate::telemetry::LedgerHealth;
    use std::path::PathBuf;
    use std::sync::{Arc, RwLock};

    struct MissingInspector;
    impl ProcessInspector for MissingInspector {
        fn inspect(&self, _pid: u32) -> Result<ProcessIdentity, ProcessIdentityError> {
            Err(ProcessIdentityError::NotRunning)
        }
    }

    fn state() -> ControlState {
        ControlState {
            registry: Arc::new(ProcessRegistry::default()),
            mode: Arc::new(RwLock::new(EnforcementMode::AuditOnly)),
            ledger_health: Arc::new(RwLock::new(LedgerHealth::Ready)),
            inspector: Arc::new(MissingInspector),
        }
    }

    fn request(capability: &str, command: NativeControlCommand) -> NativeControlRequest {
        NativeControlRequest {
            protocol_version: PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            capability: capability.to_owned(),
            command,
        }
    }

    #[test]
    fn rejects_an_invalid_capability() {
        let response = handle_request(
            request("wrong", NativeControlCommand::Health),
            "secret",
            &state(),
        );
        assert!(!response.ok);
        assert_eq!(response.code, "unauthorized");
    }

    #[test]
    fn returns_structured_health_for_a_valid_capability() {
        let response = handle_request(
            request("secret", NativeControlCommand::Health),
            "secret",
            &state(),
        );
        assert!(response.ok);
        assert!(response.health.is_some());
    }

    #[test]
    fn rejects_an_unknown_protocol_version() {
        let mut request = request("secret", NativeControlCommand::Health);
        request.protocol_version = 99;
        let response = handle_request(request, "secret", &state());
        assert_eq!(response.code, "unsupported_protocol_version");
    }

    #[test]
    fn unauthorized_callers_cannot_change_audit_mode() {
        let state = state();
        let response = handle_request(
            request(
                "wrong",
                NativeControlCommand::SetAuditMode { enabled: false },
            ),
            "secret",
            &state,
        );
        assert!(!response.ok);
        assert_eq!(
            *state.mode.read().expect("mode"),
            EnforcementMode::AuditOnly
        );
    }

    #[test]
    fn nonexistent_process_registration_fails_closed() {
        let response = handle_request(
            request(
                "secret",
                NativeControlCommand::RegisterProcess {
                    process: ProcessIdentity {
                        pid: 4242,
                        start_time: 1,
                        executable_path: PathBuf::from("/bin/false"),
                        parent_pid: None,
                    },
                },
            ),
            "secret",
            &state(),
        );
        assert_eq!(response.code, "process_inspection_failed");
    }
}
