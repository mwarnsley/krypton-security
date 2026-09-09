use crate::health::RuntimeHealth;
use crate::mcp::{McpBoundary, McpReceipt};
use crate::notification::{NotificationStatus, QuarantineNotifier};
use crate::process_identity::{ProcessIdentity, ProcessInspector};
use crate::process_registry::{terminate_process, ProcessRegistry, RegistryError};
use crate::telemetry::LedgerHealth;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const PROTOCOL_VERSION: u16 = 1;
pub const IPC_MAX_REQUEST_BYTES: u64 = 16 * 1024;
pub const IPC_MAX_RESPONSE_BYTES: usize = 16 * 1024;
pub const IPC_QUEUE_CAPACITY: usize = 32;
pub const IPC_WORKER_COUNT: usize = 4;
const IPC_TIMEOUT: Duration = Duration::from_millis(1500);

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
    McpFile {
        tool: String,
        path: String,
        content: Option<String>,
    },
    Health,
    SetAuditMode {
        enabled: bool,
    },
    RegisterProcess {
        process: ProcessIdentity,
    },
    UnregisterProcess {
        process: ProcessIdentity,
    },
    IsolateProcess {
        process: ProcessIdentity,
    },
    TerminationReceipt {
        process: ProcessIdentity,
    },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt: Option<McpReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
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
    pub mcp: Option<McpBoundary>,
    pub registry: Arc<ProcessRegistry>,
    pub mode: Arc<RwLock<EnforcementMode>>,
    pub ledger_health: Arc<RwLock<LedgerHealth>>,
    pub inspector: Arc<dyn ProcessInspector>,
    pub notifier: Arc<dyn QuarantineNotifier>,
    pub notification_health: Arc<NotificationStatus>,
    pub components: Arc<RuntimeHealth>,
}

pub struct IpcRuntime {
    _worker: JoinHandle<()>,
    _startup_lock: fs::File,
    stopping: Arc<AtomicBool>,
}

impl Drop for IpcRuntime {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
    }
}

struct QueuedConnection {
    stream: UnixStream,
    accepted: Instant,
    completed: Arc<AtomicBool>,
}

struct SocketLease {
    stream: UnixStream,
    accepted: Instant,
    completed: Arc<AtomicBool>,
}

/// The listener owns a bounded lease for each queued or executing socket. Closing
/// an expired descriptor also interrupts its clones, independently of slow clients.
fn expire_connections(leases: &mut Vec<SocketLease>, state: &ControlState) {
    leases.retain(|lease| {
        if lease.completed.load(Ordering::Relaxed) {
            return false;
        }
        if lease.accepted.elapsed() < IPC_TIMEOUT {
            return true;
        }
        state.components.ipc_failed.store(true, Ordering::Relaxed);
        if let Err(error) = lease.stream.shutdown(std::net::Shutdown::Both) {
            if error.kind() != io::ErrorKind::NotConnected {
                state.components.ipc_failed.store(true, Ordering::Relaxed);
            }
        }
        false
    });
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
        receipt: None,
        content: None,
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
        NativeControlCommand::McpFile {
            tool,
            path,
            content,
        } => {
            if !matches!(tool.as_str(), "krypton_read_file" | "krypton_write_file")
                || path.is_empty()
                || path.len() > 1024
                || path.chars().any(char::is_control)
                || content.as_ref().is_some_and(|value| value.len() > 2048)
            {
                return response(request_id, false, "invalid_mcp_arguments");
            }
            let Some(boundary) = &state.mcp else {
                return response(request_id, false, "mcp_unavailable");
            };
            let healthy = state
                .ledger_health
                .try_read()
                .is_ok_and(|health| *health == LedgerHealth::Ready)
                && !state.components.telemetry_dropped.load(Ordering::Relaxed);
            let outcome = boundary.execute(&request_id, &tool, &path, content.as_deref(), healthy);
            if outcome.receipt.telemetry == "unavailable" {
                state
                    .components
                    .telemetry_dropped
                    .store(true, Ordering::Relaxed);
            }
            let mut reply = response(request_id, outcome.ok, outcome.code);
            reply.receipt = Some(outcome.receipt);
            reply.content = outcome.content;
            reply
        }
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
                receipt: None,
                content: None,
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
            match state.mode.try_write() {
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
        NativeControlCommand::TerminationReceipt { process } => {
            match state.registry.termination_receipt(&process) {
                Ok(true) => response(request_id, true, "process_isolated"),
                Ok(false) => response(request_id, true, "termination_unconfirmed"),
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

/// Recomputes the remaining absolute budget before every socket operation.
/// Partial reads, interrupted syscalls, and slow writes cannot reset the deadline.
struct DeadlineStream {
    stream: UnixStream,
    deadline: Instant,
}

impl DeadlineStream {
    fn remaining(&self) -> io::Result<Duration> {
        self.deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::TimedOut, "IPC absolute deadline exceeded")
            })
    }
}

impl Read for DeadlineStream {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.stream.set_read_timeout(Some(self.remaining()?))?;
        self.stream.read(bytes)
    }
}

impl Write for DeadlineStream {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.stream.set_write_timeout(Some(self.remaining()?))?;
        self.stream.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.remaining()?;
        self.stream.flush()
    }
}

fn handle_connection(
    stream: UnixStream,
    capability: &str,
    state: &ControlState,
    accepted: Instant,
) -> Result<(), io::Error> {
    // BSD/macOS accept inherits O_NONBLOCK from the listener. Restore blocking
    // request IO so an acceptance-to-first-byte gap waits within the absolute
    // deadline instead of returning WouldBlock and closing a healthy client.
    stream.set_nonblocking(false)?;
    let deadline = accepted
        .checked_add(IPC_TIMEOUT)
        .ok_or_else(|| io::Error::other("IPC deadline overflow"))?;
    let mut stream = DeadlineStream { stream, deadline };
    stream.remaining()?;
    if !peer_is_current_user(&stream.stream) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC peer UID does not match daemon owner",
        ));
    }
    let mut payload = String::new();
    let bytes =
        BufReader::new((&mut stream).take(IPC_MAX_REQUEST_BYTES + 1)).read_line(&mut payload)?;
    stream.remaining()?;
    let result = if bytes as u64 > IPC_MAX_REQUEST_BYTES {
        response(String::new(), false, "request_too_large")
    } else if !payload.ends_with('\n') {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "IPC client disconnected before request terminator",
        ));
    } else {
        match serde_json::from_str::<NativeControlRequest>(&payload) {
            Ok(request) => handle_request(request, capability, state),
            Err(_) => response(String::new(), false, "malformed_request"),
        }
    };
    stream.remaining()?;
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
    receiver: Arc<Mutex<Receiver<QueuedConnection>>>,
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
            Ok(connection) => {
                if handle_connection(connection.stream, &capability, &state, connection.accepted)
                    .is_err()
                {
                    state.components.ipc_failed.store(true, Ordering::Relaxed);
                }
                connection.completed.store(true, Ordering::Relaxed);
            }
            Err(_) => return,
        }
    }
}

/// Creates the private runtime directory and canonicalizes it before publishing
/// discovery paths, removing dot segments and resolving the existing directory.
fn prepare_runtime_directory(runtime_directory: &Path) -> Result<PathBuf, io::Error> {
    fs::create_dir_all(runtime_directory)?;
    let runtime_directory = fs::canonicalize(runtime_directory)?;
    fs::set_permissions(&runtime_directory, fs::Permissions::from_mode(0o700))?;
    Ok(runtime_directory)
}

pub fn start_ipc(
    runtime_directory: &Path,
    state: Arc<ControlState>,
) -> Result<IpcRuntime, io::Error> {
    let runtime_directory = prepare_runtime_directory(runtime_directory)?;
    // Keep the inode and lock for this runtime's lifetime. Never unlink this lock
    // file: replacing its inode would let another starter bypass exclusivity.
    let startup_lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(runtime_directory.join("startup.lock"))?;
    let lock_metadata = startup_lock.metadata()?;
    if !lock_metadata.is_file()
        || lock_metadata.nlink() != 1
        || lock_metadata.uid() != nix::unistd::geteuid().as_raw()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "invalid daemon startup lock",
        ));
    }
    startup_lock.try_lock().map_err(|error| {
        io::Error::new(
            io::Error::from(error).kind(),
            "another Krypton daemon is starting or running",
        )
    })?;
    startup_lock.set_permissions(fs::Permissions::from_mode(0o600))?;
    let endpoint = runtime_directory.join("daemon.sock");
    let capability_file = runtime_directory.join("capability");
    let endpoint_record = runtime_directory.join("daemon.json");
    match fs::symlink_metadata(&endpoint) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "existing IPC endpoint is not a socket",
                ));
            }
            use nix::sys::socket::{connect, socket, AddressFamily, SockFlag, SockType, UnixAddr};
            use std::os::fd::AsRawFd;
            let probe = socket(
                AddressFamily::Unix,
                SockType::Stream,
                SockFlag::empty(),
                None,
            )?;
            let probe = UnixStream::from(probe);
            probe.set_nonblocking(true)?;
            let address = UnixAddr::new(&endpoint)?;
            match connect(probe.as_raw_fd(), &address) {
                Err(nix::errno::Errno::ECONNREFUSED) => fs::remove_file(&endpoint)?,
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        "a Krypton daemon is listening or the endpoint cannot be safely replaced",
                    ))
                }
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let capability = Arc::new(generate_capability()?);
    // Bind first: a competing startup must not replace a live daemon capability.
    let listener = UnixListener::bind(&endpoint)?;
    let stopping = Arc::new(AtomicBool::new(false));
    let started = (|| -> io::Result<JoinHandle<()>> {
        fs::set_permissions(&endpoint, fs::Permissions::from_mode(0o600))?;
        listener.set_nonblocking(true)?;
        write_private_file(&capability_file, capability.as_bytes())?;
        let record = RuntimeEndpointRecord {
            protocol_version: PROTOCOL_VERSION,
            endpoint: endpoint.clone(),
            pid: std::process::id(),
            started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            capability_file: capability_file.clone(),
        };
        let (sender, receiver) = sync_channel::<QueuedConnection>(IPC_QUEUE_CAPACITY);
        let receiver = Arc::new(Mutex::new(receiver));
        for _ in 0..IPC_WORKER_COUNT {
            let receiver = Arc::clone(&receiver);
            let capability = Arc::clone(&capability);
            let state = Arc::clone(&state);
            thread::Builder::new()
                .name("krypton-ipc-request".to_owned())
                .spawn(move || worker_loop(receiver, capability, state))?;
        }
        write_private_file(
            &endpoint_record,
            &serde_json::to_vec_pretty(&record)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?,
        )?;
        let stopping = Arc::clone(&stopping);
        let state = Arc::clone(&state);
        thread::Builder::new()
            .name("krypton-ipc-listener".to_owned())
            .spawn(move || {
                let mut leases = Vec::with_capacity(IPC_QUEUE_CAPACITY + IPC_WORKER_COUNT);
                while !stopping.load(Ordering::Relaxed) {
                    expire_connections(&mut leases, &state);
                    match listener.accept() {
                        Ok((stream, _)) => {
                            if leases.len() >= IPC_QUEUE_CAPACITY + IPC_WORKER_COUNT {
                                state.components.ipc_failed.store(true, Ordering::Relaxed);
                                continue;
                            }
                            let duplicate = match stream.try_clone() {
                                Ok(duplicate) => duplicate,
                                Err(_) => {
                                    state.components.ipc_failed.store(true, Ordering::Relaxed);
                                    continue;
                                }
                            };
                            let accepted = Instant::now();
                            let completed = Arc::new(AtomicBool::new(false));
                            if sender
                                .try_send(QueuedConnection {
                                    stream,
                                    accepted,
                                    completed: Arc::clone(&completed),
                                })
                                .is_err()
                            {
                                state.components.ipc_failed.store(true, Ordering::Relaxed);
                            } else {
                                leases.push(SocketLease {
                                    stream: duplicate,
                                    accepted,
                                    completed,
                                });
                            }
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            // Deadline sweeps also run while no new client arrives.
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                        Err(_) => {
                            state.components.ipc_failed.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                }
                for lease in leases {
                    if lease.stream.shutdown(std::net::Shutdown::Both).is_err() {
                        state.components.ipc_failed.store(true, Ordering::Relaxed);
                    }
                }
            })
    })();
    let worker = match started {
        Ok(worker) => worker,
        Err(error) => {
            state.components.ipc_failed.store(true, Ordering::Relaxed);
            let mut cleanup_errors = Vec::new();
            for owned in [&endpoint_record, &capability_file, &endpoint] {
                if let Err(cleanup) = fs::remove_file(owned) {
                    if cleanup.kind() != io::ErrorKind::NotFound {
                        cleanup_errors.push(cleanup.to_string());
                    }
                }
            }
            if !cleanup_errors.is_empty() {
                return Err(io::Error::other(format!(
                    "IPC startup failed: {error}; cleanup failed: {}",
                    cleanup_errors.join("; ")
                )));
            }
            return Err(error);
        }
    };
    Ok(IpcRuntime {
        _worker: worker,
        _startup_lock: startup_lock,
        stopping,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn accepted_connection_waits_for_a_delayed_first_request() {
        use std::io::{BufRead, BufReader, Write};
        let directory =
            std::path::Path::new("/tmp").join(format!("krypton-delayed-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let runtime = super::start_ipc(&directory, std::sync::Arc::new(state())).unwrap();
        let capability = std::fs::read_to_string(directory.join("capability")).unwrap();
        let result = (|| -> std::io::Result<serde_json::Value> {
            let mut client =
                std::os::unix::net::UnixStream::connect(directory.join("daemon.sock"))?;
            client.set_read_timeout(Some(std::time::Duration::from_secs(1)))?;
            // Exercise the real acceptance-to-first-byte gap. macOS inherits the
            // listener's nonblocking flag until the accepted stream resets it.
            std::thread::sleep(std::time::Duration::from_millis(20));
            let request = serde_json::json!({"protocolVersion": 1, "requestId": "delayed", "capability": capability, "command": {"type":"health"}});
            writeln!(client, "{request}")?;
            let mut response = String::new();
            BufReader::new(client).read_line(&mut response)?;
            serde_json::from_str(&response).map_err(std::io::Error::other)
        })();
        drop(runtime);
        std::fs::remove_dir_all(directory).unwrap();
        assert!(
            result.is_ok(),
            "delayed request failed: {:?}",
            result.as_ref().err()
        );
        assert_eq!(result.unwrap()["requestId"], "delayed");
    }
    #[test]
    fn concurrent_starters_publish_exactly_one_owned_runtime() {
        let directory =
            std::path::Path::new("/tmp").join(format!("krypton-race-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let directory = directory.clone();
            let barrier = barrier.clone();
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                super::start_ipc(&directory, std::sync::Arc::new(state()))
            }));
        }
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        let successes = results.iter().filter(|result| result.is_ok()).count();
        let contended = results
            .iter()
            .filter(|result| {
                result
                    .as_ref()
                    .err()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::WouldBlock)
            })
            .count();
        drop(results);
        std::fs::remove_dir_all(directory).unwrap();
        assert_eq!(successes, 1);
        assert_eq!(contended, 1);
    }
    #[test]
    fn concurrent_startup_lock_is_fail_fast_without_publishing_runtime() {
        use std::os::unix::fs::OpenOptionsExt;
        let directory =
            std::path::Path::new("/tmp").join(format!("krypton-lock-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let lock = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(directory.join("startup.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        let started = std::time::Instant::now();
        let result = super::start_ipc(&directory, std::sync::Arc::new(state()));
        let elapsed = started.elapsed();
        let denied = match result {
            Err(error) => error.kind() == std::io::ErrorKind::WouldBlock,
            Ok(runtime) => {
                drop(runtime);
                false
            }
        };
        drop(lock);
        std::fs::remove_dir_all(directory).unwrap();
        assert!(denied);
        assert!(elapsed < std::time::Duration::from_millis(100));
    }
    #[test]
    fn queued_socket_expiry_closes_all_clones_and_reports_degradation() {
        use std::io::Read;
        let state = state();
        let (server, mut client) = std::os::unix::net::UnixStream::pair().unwrap();
        let queued_clone = server.try_clone().unwrap();
        let mut leases = vec![super::SocketLease {
            stream: server,
            accepted: std::time::Instant::now() - super::IPC_TIMEOUT,
            completed: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }];
        super::expire_connections(&mut leases, &state);
        let mut byte = [0];
        assert_eq!(client.read(&mut byte).unwrap(), 0);
        assert!(state
            .components
            .ipc_failed
            .load(std::sync::atomic::Ordering::Relaxed));
        assert!(leases.is_empty());
        drop(queued_clone);
    }

    #[test]
    fn expired_queued_request_cannot_change_mode() {
        use std::io::Write;
        let (server, mut client) = std::os::unix::net::UnixStream::pair().unwrap();
        client.write_all(b"{\"protocolVersion\":1,\"requestId\":\"test\",\"capability\":\"test\",\"command\":{\"type\":\"set_audit_mode\",\"enabled\":false}}\n").unwrap();
        let state = state();
        let result = super::handle_connection(
            server,
            "test",
            &state,
            std::time::Instant::now() - super::IPC_TIMEOUT,
        );
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
        assert_eq!(
            *state.mode.read().unwrap(),
            super::EnforcementMode::AuditOnly
        );
    }

    #[test]
    fn contended_mode_update_is_denied_without_waiting() {
        let state = state();
        let guard = state.mode.write().unwrap();
        let request = serde_json::from_value(serde_json::json!({
            "protocolVersion": 1, "requestId": "test", "capability": "test",
            "command": {"type":"set_audit_mode", "enabled":false}
        }))
        .unwrap();
        let reply = super::handle_request(request, "test", &state);
        drop(guard);
        assert_eq!(reply.code, "mode_state_unavailable");
        assert!(!reply.ok);
    }

    #[test]
    fn failed_discovery_publication_removes_owned_socket_and_capability() {
        let directory = std::path::Path::new("/tmp")
            .join(format!("krypton-startup-failure-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("daemon.json.tmp"), b"occupied").unwrap();
        let result = super::start_ipc(&directory, std::sync::Arc::new(state()));
        let socket_exists = directory.join("daemon.sock").exists();
        let capability_exists = directory.join("capability").exists();
        std::fs::remove_dir_all(directory).unwrap();
        assert_eq!(
            result.err().unwrap().kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert!(!socket_exists);
        assert!(!capability_exists);
    }
    #[test]
    fn slow_drip_cannot_extend_connection_deadline() {
        use std::io::Write;
        use std::time::{Duration, Instant};
        let (server, mut client) = std::os::unix::net::UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            for _ in 0..25 {
                if client.write_all(b" ").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        });
        let started = Instant::now();
        let result = super::handle_connection(server, "test", &state(), Instant::now());
        let elapsed = started.elapsed();
        writer.join().unwrap();
        assert!(result.is_err());
        assert!(
            elapsed < Duration::from_millis(1700),
            "elapsed: {elapsed:?}"
        );
    }

    #[test]
    fn disconnected_client_cannot_execute_unterminated_request() {
        use std::io::Write;
        let (server, mut client) = std::os::unix::net::UnixStream::pair().unwrap();
        client.write_all(br#"{"protocolVersion":1,"requestId":"test","capability":"test","command":{"type":"set_audit_mode","enabled":false}}"#).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let state = state();
        let result = super::handle_connection(server, "test", &state, std::time::Instant::now());
        assert!(result.is_err());
        assert_eq!(
            *state.mode.read().unwrap(),
            super::EnforcementMode::AuditOnly
        );
    }
    #[test]
    fn runtime_directory_normalization_removes_dot_segments_before_publication() {
        let directory =
            std::env::temp_dir().join(format!("krypton-normalize-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let runtime = directory
            .join(".")
            .join(".krypton")
            .join(".")
            .join("runtime");
        let actual = super::prepare_runtime_directory(&runtime).unwrap();
        let expected = std::fs::canonicalize(&directory)
            .unwrap()
            .join(".krypton/runtime");
        let endpoint = actual.join("daemon.sock");
        let capability = actual.join("capability");
        std::fs::remove_dir_all(&directory).unwrap();
        assert_eq!(
            endpoint.as_os_str(),
            expected.join("daemon.sock").as_os_str()
        );
        assert_eq!(
            capability.as_os_str(),
            expected.join("capability").as_os_str()
        );
    }

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
            mcp: None,
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
                mcp: None,
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

    fn receipt_request(process: &ProcessIdentity) -> NativeControlRequest {
        serde_json::from_value(serde_json::json!({
            "protocolVersion": 1,
            "requestId": "receipt-test",
            "capability": "secret",
            "command": {"type": "termination_receipt", "process": process}
        }))
        .expect("receipt request schema")
    }

    #[test]
    fn receipt_confirms_successful_native_isolation() {
        let (state, process, _) = isolation_state();
        handle_request_with_terminator(
            request(
                "secret",
                NativeControlCommand::IsolateProcess {
                    process: process.clone(),
                },
            ),
            "secret",
            &state,
            |_| Ok(()),
        );
        let reply = handle_request(receipt_request(&process), "secret", &state);
        assert!(reply.ok);
        assert_eq!(reply.code, "process_isolated");
    }

    #[test]
    fn receipt_does_not_confirm_failed_or_unauthorized_or_audit_isolation() {
        for denial in ["signal", "unauthorized", "audit"] {
            let (state, process, _) = isolation_state();
            if denial == "audit" {
                *state.mode.write().unwrap() = EnforcementMode::AuditOnly;
            }
            handle_request_with_terminator(
                request(
                    if denial == "unauthorized" {
                        "wrong"
                    } else {
                        "secret"
                    },
                    NativeControlCommand::IsolateProcess {
                        process: process.clone(),
                    },
                ),
                "secret",
                &state,
                |_| Err("signal denied".to_owned()),
            );
            let reply = handle_request(receipt_request(&process), "secret", &state);
            assert!(reply.ok);
            assert_eq!(reply.code, "termination_unconfirmed");
        }
    }

    #[test]
    fn receipt_lookup_requires_authentication_and_supported_protocol() {
        for protocol in [1, 99] {
            let (state, process, _) = isolation_state();
            handle_request_with_terminator(
                request(
                    "secret",
                    NativeControlCommand::IsolateProcess {
                        process: process.clone(),
                    },
                ),
                "secret",
                &state,
                |_| Ok(()),
            );
            let mut lookup = receipt_request(&process);
            lookup.protocol_version = protocol;
            lookup.capability = "wrong".to_owned();
            let reply = handle_request(lookup, "secret", &state);
            assert!(!reply.ok);
            assert_eq!(
                reply.code,
                if protocol == 1 {
                    "unauthorized"
                } else {
                    "unsupported_protocol_version"
                }
            );
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
