use crate::health::RuntimeHealth;
use crate::notification::{NotificationStatus, QuarantineNotifier};
use crate::process_identity::{ProcessIdentity, ProcessInspector};
use crate::process_registry::{terminate_process, ProcessRegistry, RegistryError};
use crate::telemetry::LedgerHealth;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
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
    Degraded,
    Starting,
    WriteFailed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHealth {
    pub status: String,
    pub watcher: ComponentHealth,
    pub ledger: ComponentHealth,
    pub ipc: ComponentHealth,
    pub mode: Option<EnforcementMode>,
    pub registry: ComponentHealth,
    pub notification: ComponentHealth,
    pub telemetry_queue: ComponentHealth,
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
    pub notifier: Arc<dyn QuarantineNotifier>,
    pub notification_health: Arc<NotificationStatus>,
    pub components: Arc<RuntimeHealth>,
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
    handle_request_with_terminator(request, expected_capability, state, terminate_process)
}

fn handle_request_with_terminator<F>(
    request: NativeControlRequest,
    expected_capability: &str,
    state: &ControlState,
    terminate: F,
) -> NativeControlResponse
where
    F: FnOnce(u32) -> Result<(), String>,
{
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
            let mode = state.mode.try_read().ok().map(|mode| *mode);
            let ledger = state
                .ledger_health
                .try_read()
                .map_or(LedgerHealth::WriteFailed, |health| *health);
            let count = state.registry.active_count().ok();
            let watcher_ready = state.components.watcher_ready.load(Ordering::Relaxed);
            let watcher_failed = state.components.watcher_failed.load(Ordering::Relaxed);
            let ipc_failed = state.components.ipc_failed.load(Ordering::Relaxed);
            let queue_failed = state.components.telemetry_dropped.load(Ordering::Relaxed);
            let notification_failed = state.notification_health.is_degraded();
            let degraded = mode.is_none()
                || count.is_none()
                || ledger == LedgerHealth::WriteFailed
                || !watcher_ready
                || watcher_failed
                || ipc_failed
                || queue_failed
                || notification_failed;
            NativeControlResponse {
                protocol_version: PROTOCOL_VERSION,
                request_id,
                ok: true,
                code: if degraded { "degraded" } else { "ready" }.to_owned(),
                active_process_count: count,
                health: Some(DaemonHealth {
                    status: if degraded { "degraded" } else { "healthy" }.to_owned(),
                    watcher: if watcher_failed {
                        ComponentHealth::Degraded
                    } else if watcher_ready {
                        ComponentHealth::Ready
                    } else {
                        ComponentHealth::Starting
                    },
                    ledger: if ledger == LedgerHealth::WriteFailed {
                        ComponentHealth::WriteFailed
                    } else {
                        ComponentHealth::Ready
                    },
                    ipc: if ipc_failed {
                        ComponentHealth::Degraded
                    } else {
                        ComponentHealth::Ready
                    },
                    registry: if count.is_none() {
                        ComponentHealth::Degraded
                    } else {
                        ComponentHealth::Ready
                    },
                    notification: if notification_failed {
                        ComponentHealth::Degraded
                    } else {
                        ComponentHealth::Ready
                    },
                    telemetry_queue: if queue_failed {
                        ComponentHealth::Degraded
                    } else {
                        ComponentHealth::Ready
                    },
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
            let mode = match state.mode.try_read() {
                Ok(mode) => *mode,
                Err(_) => return response(request_id, false, "mode_state_unavailable"),
            };
            if mode == EnforcementMode::AuditOnly {
                return response(request_id, false, "audit_only");
            }
            match state
                .registry
                .isolate_with(&process, state.inspector.as_ref(), terminate)
            {
                Ok(()) => {
                    state.notifier.notify_confirmed_quarantine(&process);
                    response(request_id, true, "process_isolated")
                }
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
    crate::telemetry::write_private_atomic(path, |file| file.write_all(contents))
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
            Err(_) => {
                state.components.ipc_failed.store(true, Ordering::Relaxed);
                return;
            }
        };
        match stream {
            Ok(stream) => {
                if let Err(error) = handle_connection(stream, &capability, &state) {
                    state.components.ipc_failed.store(true, Ordering::Relaxed);
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
                    if sender.try_send(stream).is_err() {
                        state.components.ipc_failed.store(true, Ordering::Relaxed);
                    }
                }
                Err(error) => {
                    state.components.ipc_failed.store(true, Ordering::Relaxed);
                    eprintln!("[IPC ERROR] accept failed: {error}");
                }
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
    #[test]
    fn private_runtime_publication_rejects_symlink_temporary() {
        use std::fs;
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("krypton-ipc-atomic-{suffix}"));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("capability");
        let target = directory.join("unrelated");
        let temporary = directory.join("capability.tmp");
        fs::write(&target, b"untouched").unwrap();
        std::os::unix::fs::symlink(&target, &temporary).unwrap();
        let result = super::write_private_file(&path, b"fake-test-capability");
        let preserved = fs::read(&target).unwrap();
        fs::remove_file(temporary).unwrap();
        fs::remove_file(target).unwrap();
        fs::remove_dir(directory).unwrap();
        assert!(result.is_err());
        assert_eq!(preserved, b"untouched");
    }

    #[test]
    fn private_runtime_publication_replaces_permissive_file_privately() {
        use std::{fs, os::unix::fs::PermissionsExt};
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("krypton-ipc-private-{suffix}"));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("daemon.json");
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        super::write_private_file(&path, b"new").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
        assert_eq!(mode, 0o600);
        assert_eq!(bytes, b"new");
    }

    use super::{
        handle_request, handle_request_with_terminator, ControlState, EnforcementMode,
        NativeControlCommand, NativeControlRequest, NotificationStatus, RuntimeHealth,
        PROTOCOL_VERSION,
    };
    use crate::notification::QuarantineNotifier;
    use crate::process_identity::{ProcessIdentity, ProcessIdentityError, ProcessInspector};
    use crate::process_registry::ProcessRegistry;
    use crate::telemetry::LedgerHealth;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, RwLock};

    struct MissingInspector;
    impl ProcessInspector for MissingInspector {
        fn inspect(&self, _pid: u32) -> Result<ProcessIdentity, ProcessIdentityError> {
            Err(ProcessIdentityError::NotRunning)
        }
    }

    struct MatchingInspector(ProcessIdentity);
    impl ProcessInspector for MatchingInspector {
        fn inspect(&self, _pid: u32) -> Result<ProcessIdentity, ProcessIdentityError> {
            Ok(self.0.clone())
        }
    }

    #[derive(Default)]
    struct RecordingNotifier {
        notifications: AtomicUsize,
    }

    impl QuarantineNotifier for RecordingNotifier {
        fn notify_confirmed_quarantine(&self, _process: &ProcessIdentity) {
            self.notifications.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn state() -> ControlState {
        ControlState {
            registry: Arc::new(ProcessRegistry::default()),
            mode: Arc::new(RwLock::new(EnforcementMode::AuditOnly)),
            ledger_health: Arc::new(RwLock::new(LedgerHealth::Ready)),
            inspector: Arc::new(MissingInspector),
            notifier: Arc::new(RecordingNotifier::default()),
            notification_health: Arc::new(NotificationStatus::default()),
            components: Arc::new(RuntimeHealth::default()),
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

    fn isolation_state() -> (ControlState, ProcessIdentity, Arc<RecordingNotifier>) {
        let process = ProcessIdentity {
            pid: 4242,
            start_time: 10,
            executable_path: PathBuf::from("/usr/local/bin/claude"),
            parent_pid: Some(4000),
        };
        let inspector = Arc::new(MatchingInspector(process.clone()));
        let registry = Arc::new(ProcessRegistry::default());
        registry
            .register(process.clone(), inspector.as_ref())
            .expect("register process");
        let notifier = Arc::new(RecordingNotifier::default());
        (
            ControlState {
                registry,
                mode: Arc::new(RwLock::new(EnforcementMode::ActiveEnforcement)),
                ledger_health: Arc::new(RwLock::new(LedgerHealth::Ready)),
                inspector,
                notifier: notifier.clone(),
                notification_health: Arc::new(NotificationStatus::default()),
                components: Arc::new(RuntimeHealth::default()),
            },
            process,
            notifier,
        )
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
    fn poisoned_mode_reports_unknown_and_degraded() {
        let state = state();
        let _ = std::panic::catch_unwind(|| {
            let _guard = state.mode.write().unwrap();
            panic!("poison mode");
        });
        let reply = handle_request(
            request("secret", NativeControlCommand::Health),
            "secret",
            &state,
        );
        let health = serde_json::to_value(reply.health).unwrap();
        assert_eq!(health["status"], "degraded");
        assert!(health["mode"].is_null());
    }

    #[test]
    fn component_failures_are_reported_as_degraded() {
        for component in ["watcher", "ipc", "telemetryQueue"] {
            let state = state();
            state
                .components
                .watcher_ready
                .store(true, Ordering::Relaxed);
            match component {
                "watcher" => state
                    .components
                    .watcher_failed
                    .store(true, Ordering::Relaxed),
                "ipc" => state.components.ipc_failed.store(true, Ordering::Relaxed),
                _ => state
                    .components
                    .telemetry_dropped
                    .store(true, Ordering::Relaxed),
            }
            let reply = handle_request(
                request("secret", NativeControlCommand::Health),
                "secret",
                &state,
            );
            let health = serde_json::to_value(reply.health).unwrap();
            assert_eq!(health["status"], "degraded");
            assert_eq!(health[component], "degraded");
        }
    }

    #[test]
    fn poisoned_mode_cannot_authorize_a_signal() {
        let (state, process, notifier) = isolation_state();
        let _ = std::panic::catch_unwind(|| {
            let _guard = state.mode.write().unwrap();
            panic!("poison mode");
        });
        let reply = handle_request_with_terminator(
            request("secret", NativeControlCommand::IsolateProcess { process }),
            "secret",
            &state,
            |_| panic!("must not signal"),
        );
        assert_eq!(reply.code, "mode_state_unavailable");
        assert_eq!(notifier.notifications.load(Ordering::Relaxed), 0);
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

    #[test]
    fn notifies_after_authenticated_confirmed_isolation() {
        let (state, process, notifier) = isolation_state();
        let response = handle_request_with_terminator(
            request("secret", NativeControlCommand::IsolateProcess { process }),
            "secret",
            &state,
            |_| Ok(()),
        );

        assert_eq!(response.code, "process_isolated");
        assert_eq!(notifier.notifications.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn does_not_notify_an_unauthenticated_isolation_request() {
        let (state, process, notifier) = isolation_state();
        let response = handle_request_with_terminator(
            request("wrong", NativeControlCommand::IsolateProcess { process }),
            "secret",
            &state,
            |_| panic!("must not signal"),
        );

        assert_eq!(response.code, "unauthorized");
        assert_eq!(notifier.notifications.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn does_not_notify_when_signal_delivery_fails() {
        let (state, process, notifier) = isolation_state();
        let response = handle_request_with_terminator(
            request("secret", NativeControlCommand::IsolateProcess { process }),
            "secret",
            &state,
            |_| Err("signal denied".to_owned()),
        );

        assert_eq!(response.code, "isolation_failed");
        assert_eq!(notifier.notifications.load(Ordering::Relaxed), 0);
    }
}
