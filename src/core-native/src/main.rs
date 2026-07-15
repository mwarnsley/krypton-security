use chrono::{SecondsFormat, Utc};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use notify::{Event, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::fs::OpenOptions;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const ALERT_QUEUE_CAPACITY: usize = 1_024;
const BREAKOUT_RATE_LIMIT: usize = 3;
const BREAKOUT_RATE_WINDOW: Duration = Duration::from_secs(5);
const IPC_BIND_ADDRESS: &str = "127.0.0.1:9000";
const IPC_MAX_PAYLOAD_BYTES: u64 = 64;
const IPC_READ_TIMEOUT: Duration = Duration::from_secs(2);
const IPC_ERROR_INVALID_COMMAND: &str = "ERROR: INVALID_COMMAND\n";
const IPC_ERROR_ISOLATION_FAILED: &str = "ERROR: ISOLATION_FAILED\n";
const IPC_ERROR_PID_NOT_OWNED: &str = "ERROR: PID_NOT_OWNED\n";
const IPC_SUCCESS_PID_ISOLATED: &str = "SUCCESS: PID_ISOLATED\n";
const NATIVE_TRIGGER_SIGNATURE: &str = "NATIVE_FS_WATCH";
static ALERT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

type OwnedProcessRegistry = Arc<RwLock<HashSet<u32>>>;
type BreakoutHistory = Arc<Mutex<HashMap<u32, VecDeque<Instant>>>>;

/// Represents a fail-closed native process-isolation failure.
#[derive(Debug, Eq, PartialEq)]
enum IsolationError {
    /// The daemon was asked to isolate its own process identifier.
    DaemonSelfTarget,
    /// The shared ownership registry could not be read safely.
    RegistryUnavailable,
    /// The requested PID is not registered as a Krypton-owned child.
    TargetNotOwned,
    /// Native signal delivery failed after ownership verification.
    SignalFailed(String),
}

/// Represents a fail-closed breakout-rate tracking failure.
#[derive(Debug, Eq, PartialEq)]
enum RateLimitError {
    /// The shared ownership registry could not be read safely.
    RegistryUnavailable,
    /// The shared breakout history could not be updated safely.
    HistoryUnavailable,
}

/// Represents one native security event in the shared telemetry ledger schema.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityAlert {
    /// A stable identifier unique to this daemon process and alert sequence.
    id: String,
    /// The ISO-8601 UTC time at which the event was observed.
    timestamp: String,
    /// The native daemon process identifier associated with the event.
    target_process_id: u32,
    /// The deterministic operation observed by the watcher.
    attempted_action: String,
    /// The absolute path that triggered the boundary decision.
    attempted_path: String,
    /// The deterministic enforcement state assigned to the event.
    enforcement_status: String,
    /// The native policy source that produced the alert.
    trigger_signature: String,
}

impl SecurityAlert {
    /// Creates one dashboard-compatible alert for a native breakout event.
    ///
    /// # Arguments
    ///
    /// * `attempted_path` - The absolute filesystem path rejected by policy.
    fn native_breakout(attempted_path: &Path) -> Self {
        let target_process_id = std::process::id();

        Self::native_breakout_with_status(attempted_path, target_process_id, "INTERCEPTED")
    }

    /// Creates one dashboard-compatible automated quarantine alert.
    ///
    /// # Arguments
    ///
    /// * `attempted_path` - The absolute filesystem path rejected by policy.
    /// * `target_process_id` - The registered Krypton child process isolated by policy.
    fn automated_quarantine(attempted_path: &Path, target_process_id: u32) -> Self {
        Self::native_breakout_with_status(attempted_path, target_process_id, "AUTOMATED_QUARANTINE")
    }

    /// Creates one native breakout alert with an explicit PID and enforcement state.
    ///
    /// # Arguments
    ///
    /// * `attempted_path` - The absolute filesystem path rejected by policy.
    /// * `target_process_id` - The process identifier associated with enforcement.
    /// * `enforcement_status` - The deterministic policy outcome stored in telemetry.
    fn native_breakout_with_status(
        attempted_path: &Path,
        target_process_id: u32,
        enforcement_status: &str,
    ) -> Self {
        let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let sequence = ALERT_SEQUENCE.fetch_add(1, Ordering::Relaxed);

        Self {
            id: format!("native:{target_process_id}:{timestamp}:{sequence}"),
            timestamp,
            target_process_id,
            attempted_action: "filesystem_boundary_breakout".to_owned(),
            attempted_path: attempted_path.to_string_lossy().into_owned(),
            enforcement_status: enforcement_status.to_owned(),
            trigger_signature: NATIVE_TRIGGER_SIGNATURE.to_owned(),
        }
    }
}

/// Determines whether a target's canonical filesystem path is contained by the
/// canonical sandbox root.
///
/// Both paths must exist so the operating system can resolve symbolic links and
/// parent-directory components before the component-aware boundary check runs.
///
/// # Arguments
///
/// * `sandbox_root` - The authorized sandbox directory to use as the boundary.
/// * `target_path` - The existing filesystem path to validate.
///
/// # Returns
///
/// Returns `Ok(true)` when the resolved target is inside the resolved sandbox,
/// `Ok(false)` when it escapes that boundary, or an [`io::Error`] when either
/// path cannot be canonicalized.
fn is_path_safe(sandbox_root: &str, target_path: &str) -> Result<bool, io::Error> {
    let canonical_sandbox_root = fs::canonicalize(sandbox_root)?;
    let canonical_target_path = fs::canonicalize(target_path)?;

    Ok(canonical_target_path.starts_with(canonical_sandbox_root))
}

/// Determines whether an event path belongs to a noisy generated directory.
///
/// # Arguments
///
/// * `event_path` - The incoming filesystem event path string to inspect.
///
/// # Returns
///
/// Returns `true` for Next.js cache, dependency, or Git metadata paths.
///
/// # Complexity
///
/// Runs in O(L) time for path length L and uses O(1) additional space.
///
/// # Examples
///
/// ```ignore
/// assert!(is_ignored_event_path("/project/.next/cache/trace"));
/// ```
fn is_ignored_event_path(event_path: &str) -> bool {
    event_path.contains(".next/")
        || event_path.contains("node_modules/")
        || event_path.contains(".git/")
}

/// Locates the absolute Krypton project root from the process working directory.
///
/// The upward search supports launching from either the repository root or the
/// nested `src/core-native` crate without binding to a duplicate workspace.
///
/// # Arguments
///
/// * `current_dir` - The absolute process working directory returned by
///   [`std::env::current_dir`].
///
/// # Returns
///
/// Returns the canonical repository root containing both the Node.js manifest
/// and the native Rust crate manifest.
///
/// # Errors
///
/// Returns an error when no matching project root exists in the directory's
/// ancestor chain or when the discovered root cannot be canonicalized.
fn resolve_project_root(current_dir: &Path) -> Result<PathBuf, io::Error> {
    let project_root = current_dir
        .ancestors()
        .find(|candidate| {
            candidate.join("package.json").is_file()
                && candidate.join("src/core-native/Cargo.toml").is_file()
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "the Krypton project root could not be resolved from the current directory",
            )
        })?;

    fs::canonicalize(project_root)
}

/// Resolves and creates the repository-root sandbox directory when necessary.
///
/// # Arguments
///
/// * `project_root` - The absolute Krypton repository root resolved from the
///   process working directory.
///
/// # Returns
///
/// Returns the canonical absolute sandbox directory ready for watcher binding.
///
/// # Errors
///
/// Returns an error when the directory cannot be created or canonicalized, or
/// when the configured sandbox path exists but is not a directory.
fn ensure_sandbox_root(project_root: &Path) -> Result<PathBuf, io::Error> {
    let sandbox_root = project_root.join("sandbox_workspace");

    if !sandbox_root.exists() {
        fs::create_dir_all(&sandbox_root)?;
    }

    let canonical_sandbox_root = fs::canonicalize(sandbox_root)?;

    if !canonical_sandbox_root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotADirectory,
            "the sandbox workspace path is not a directory",
        ));
    }

    Ok(canonical_sandbox_root)
}

/// Serializes and appends one security alert to the shared JSON-lines ledger.
///
/// The alert is serialized before the ledger is opened, replaces an initial
/// empty-array dashboard sentinel when present, and is otherwise written as one
/// newline-terminated append payload. Callers retain responsibility for logging
/// failures so a transient telemetry error cannot panic the monitoring loop.
///
/// # Arguments
///
/// * `ledger_path` - The project-root telemetry file to create or append.
/// * `alert` - The strongly typed security event to persist.
///
/// # Errors
///
/// Returns an error when JSON serialization, file opening, or append I/O fails.
fn append_security_alert(
    ledger_path: &Path,
    alert: &SecurityAlert,
) -> Result<(), Box<dyn std::error::Error>> {
    let serialized_alert = serde_json::to_string(alert)?;
    let mut ledger_line = serialized_alert.into_bytes();
    ledger_line.push(b'\n');

    let mut ledger = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(ledger_path)?;
    let ledger_length = ledger.metadata()?.len();

    if ledger_length <= 3 {
        let mut existing_contents = String::new();
        ledger.read_to_string(&mut existing_contents)?;

        if existing_contents.trim() == "[]" {
            ledger.set_len(0)?;
            ledger.seek(SeekFrom::Start(0))?;
        } else {
            ledger.seek(SeekFrom::End(0))?;
        }
    } else {
        ledger.seek(SeekFrom::End(0))?;
    }

    ledger.write_all(&ledger_line)?;

    Ok(())
}

/// Starts a dedicated worker that serializes queued alerts to the shared ledger.
///
/// The bounded queue prevents unbounded memory growth, while the filesystem
/// event loop uses non-blocking `try_send` calls and never waits for disk I/O.
///
/// # Arguments
///
/// * `ledger_path` - The project-root JSON-lines ledger owned by the writer.
///
/// # Returns
///
/// Returns the bounded alert sender and the worker handle used for shutdown.
fn start_alert_writer(ledger_path: PathBuf) -> (SyncSender<SecurityAlert>, JoinHandle<()>) {
    let (alert_sender, alert_receiver) = sync_channel(ALERT_QUEUE_CAPACITY);
    let writer_handle = thread::spawn(move || {
        for alert in alert_receiver {
            if let Err(error) = append_security_alert(&ledger_path, &alert) {
                eprintln!("[ERROR] Native security alert could not be appended: {error}");
            }
        }
    });

    (alert_sender, writer_handle)
}

/// Queues one filesystem boundary alert without blocking the kernel event loop.
///
/// # Arguments
///
/// * `alert_sender` - The bounded telemetry queue sender.
/// * `event_path` - The filesystem path denied or failed closed by policy.
fn enqueue_security_alert(alert_sender: &SyncSender<SecurityAlert>, event_path: &Path) {
    let alert = SecurityAlert::native_breakout(event_path);

    try_enqueue_security_alert(alert_sender, alert);
}

/// Queues one prepared security alert without blocking the kernel event loop.
///
/// # Arguments
///
/// * `alert_sender` - The bounded telemetry queue sender.
/// * `alert` - The complete seven-field alert payload to persist.
fn try_enqueue_security_alert(alert_sender: &SyncSender<SecurityAlert>, alert: SecurityAlert) {
    match alert_sender.try_send(alert) {
        Ok(()) => {}
        Err(TrySendError::Full(alert)) => eprintln!(
            "[ERROR] Native alert queue is full; dropped alert {}",
            alert.id
        ),
        Err(TrySendError::Disconnected(alert)) => eprintln!(
            "[ERROR] Native alert writer is unavailable; dropped alert {}",
            alert.id
        ),
    }
}

/// Records one breakout for every currently registered Krypton child.
///
/// FSEvents does not identify the process that caused a filesystem mutation, so
/// the native watchdog mirrors the reference engine's fail-closed behavior and
/// applies the event only to the current owned-process registry snapshot.
/// Histories are pruned to the five-second sliding window before the new event
/// is appended, and stale or unregistered process entries are removed.
///
/// # Arguments
///
/// * `breakout_history` - The thread-safe per-PID sliding event histories.
/// * `owned_processes` - The native least-privilege process ownership registry.
/// * `observed_at` - The monotonic time at which the breakout was observed.
///
/// # Returns
///
/// Returns the registered PIDs whose histories now exceed three events, or a
/// fail-closed synchronization error.
///
/// # Complexity
///
/// Runs in O(P + E) time for P registered processes and E retained events, with
/// O(P + E) history storage bounded by the active five-second window.
fn record_registered_breakout(
    breakout_history: &BreakoutHistory,
    owned_processes: &OwnedProcessRegistry,
    observed_at: Instant,
) -> Result<Vec<u32>, RateLimitError> {
    let registered_processes = owned_processes
        .read()
        .map_err(|_| RateLimitError::RegistryUnavailable)?
        .clone();
    let window_start = observed_at
        .checked_sub(BREAKOUT_RATE_WINDOW)
        .unwrap_or(observed_at);
    let mut histories = breakout_history
        .lock()
        .map_err(|_| RateLimitError::HistoryUnavailable)?;

    histories.retain(|target_pid, history| {
        while history
            .front()
            .is_some_and(|timestamp| *timestamp < window_start)
        {
            history.pop_front();
        }

        registered_processes.contains(target_pid) && !history.is_empty()
    });

    let mut rate_limited_processes = Vec::new();

    for target_pid in registered_processes {
        let history = histories.entry(target_pid).or_default();
        history.push_back(observed_at);

        if history.len() > BREAKOUT_RATE_LIMIT {
            rate_limited_processes.push(target_pid);
        }
    }

    Ok(rate_limited_processes)
}

/// Removes one isolated process's event history after successful enforcement.
///
/// # Arguments
///
/// * `breakout_history` - The thread-safe per-PID sliding event histories.
/// * `target_pid` - The successfully isolated registered process identifier.
fn clear_breakout_history(breakout_history: &BreakoutHistory, target_pid: u32) {
    match breakout_history.lock() {
        Ok(mut histories) => {
            histories.remove(&target_pid);
        }
        Err(_) => {
            eprintln!("[ERROR] Breakout history is unavailable after isolating PID {target_pid}.")
        }
    }
}

/// Enforces the breakout-rate policy against verified registered child PIDs.
///
/// # Arguments
///
/// * `breakout_history` - The thread-safe per-PID sliding event histories.
/// * `owned_processes` - The native least-privilege process ownership registry.
/// * `alert_sender` - The non-blocking telemetry queue sender.
/// * `event_path` - The denied path associated with this breakout event.
/// * `observed_at` - The monotonic time at which the breakout was observed.
/// * `signal_process` - The injected native signal operation.
fn enforce_breakout_rate_limit<F>(
    breakout_history: &BreakoutHistory,
    owned_processes: &OwnedProcessRegistry,
    alert_sender: &SyncSender<SecurityAlert>,
    event_path: &Path,
    observed_at: Instant,
    mut signal_process: F,
) where
    F: FnMut(u32) -> Result<(), String>,
{
    let rate_limited_processes =
        match record_registered_breakout(breakout_history, owned_processes, observed_at) {
            Ok(rate_limited_processes) => rate_limited_processes,
            Err(error) => {
                eprintln!("[ERROR] Breakout rate evaluation failed closed: {error:?}");
                return;
            }
        };

    for target_pid in rate_limited_processes {
        let isolation_result = isolate_registered_process(
            owned_processes,
            target_pid,
            |verified_target_pid| {
                println!(
                    "[AUTOMATED ENFORCEMENT] Rate limit exceeded. Executing immediate quarantine isolation for PID: {}",
                    verified_target_pid
                );
                signal_process(verified_target_pid)
            },
        );

        match isolation_result {
            Ok(()) => {
                clear_breakout_history(breakout_history, target_pid);
                try_enqueue_security_alert(
                    alert_sender,
                    SecurityAlert::automated_quarantine(event_path, target_pid),
                );
            }
            Err(error) => eprintln!(
                "[AUTOMATED ENFORCEMENT] Could not isolate registered PID {target_pid}: {error:?}"
            ),
        }
    }
}

/// Parses one strict force-isolation IPC command.
///
/// # Arguments
///
/// * `payload` - The complete UTF-8 command payload received over loopback TCP.
///
/// # Returns
///
/// Returns the positive unsigned 32-bit PID from `ISOLATE:<PID>` or a
/// validation error for malformed and zero-valued commands.
///
/// # Complexity
///
/// Runs in O(L) time for payload length L and uses O(1) additional space.
///
/// # Examples
///
/// ```ignore
/// assert_eq!(parse_isolate_command("ISOLATE:4242"), Ok(4242));
/// ```
fn parse_isolate_command(payload: &str) -> Result<u32, &'static str> {
    let target_pid = payload
        .trim()
        .strip_prefix("ISOLATE:")
        .ok_or("the IPC command must use ISOLATE:<PID>")?
        .parse::<u32>()
        .map_err(|_| "the IPC target PID must be an unsigned 32-bit integer")?;

    if target_pid == 0 {
        return Err("the IPC target PID must be greater than zero");
    }

    Ok(target_pid)
}

/// Sends `SIGKILL` to one validated native process identifier.
///
/// # Arguments
///
/// * `target_pid` - The positive owned child PID authorized for isolation.
///
/// # Returns
///
/// Returns `Ok(())` when the operating system accepts the signal or a readable
/// error when the PID exceeds the platform range or signal delivery fails.
///
/// # Complexity
///
/// Runs in O(1) time and uses O(1) additional space.
///
/// # Examples
///
/// ```ignore
/// terminate_native_process(4242)?;
/// ```
fn terminate_native_process(target_pid: u32) -> Result<(), String> {
    let platform_pid = i32::try_from(target_pid)
        .map_err(|_| "the target PID exceeds the native platform range".to_owned())?;

    kill(Pid::from_raw(platform_pid), Signal::SIGKILL)
        .map_err(|error| format!("native SIGKILL delivery failed: {error}"))
}

/// Isolates one process only when it is registered as a Krypton-owned child.
///
/// # Arguments
///
/// * `owned_processes` - The native least-privilege process ownership registry.
/// * `target_pid` - The positive PID requested by the IPC client.
/// * `signal_process` - The injected native signal operation.
///
/// # Returns
///
/// Returns `Ok(())` after a registered PID is signaled and consumed, or a
/// fail-closed error without invoking the signal operation.
///
/// # Complexity
///
/// Uses an average O(1) hash-set lookup and removal with O(1) additional space.
///
/// # Examples
///
/// ```ignore
/// isolate_registered_process(&registry, 4242, terminate_native_process)?;
/// ```
fn isolate_registered_process<F>(
    owned_processes: &OwnedProcessRegistry,
    target_pid: u32,
    signal_process: F,
) -> Result<(), IsolationError>
where
    F: FnOnce(u32) -> Result<(), String>,
{
    if target_pid == std::process::id() {
        return Err(IsolationError::DaemonSelfTarget);
    }

    let mut registered_processes = owned_processes
        .write()
        .map_err(|_| IsolationError::RegistryUnavailable)?;

    if !registered_processes.contains(&target_pid) {
        return Err(IsolationError::TargetNotOwned);
    }

    signal_process(target_pid).map_err(IsolationError::SignalFailed)?;
    registered_processes.remove(&target_pid);

    Ok(())
}

/// Writes and flushes one bounded IPC execution receipt.
///
/// # Arguments
///
/// * `writer` - The connected IPC stream or deterministic test buffer.
/// * `receipt` - The protocol status line returned to the dashboard.
///
/// # Returns
///
/// Returns `Ok(())` after every receipt byte is written and flushed, or an I/O
/// error when the client connection cannot accept the status message.
///
/// # Complexity
///
/// Runs in O(L) time for receipt length L and uses O(1) additional space.
///
/// # Examples
///
/// ```ignore
/// write_ipc_receipt(&mut stream, "SUCCESS: PID_ISOLATED\n")?;
/// ```
fn write_ipc_receipt<W>(writer: &mut W, receipt: &str) -> Result<(), io::Error>
where
    W: Write,
{
    writer.write_all(receipt.as_bytes())?;
    writer.flush()
}

/// Reads and handles one bounded IPC connection without touching the watcher.
///
/// # Arguments
///
/// * `stream` - The accepted loopback TCP client stream.
/// * `owned_processes` - The shared native process ownership registry.
///
/// # Returns
///
/// Returns no value; all validation and isolation outcomes are logged locally.
///
/// # Complexity
///
/// Runs in O(L) time for the bounded payload and uses O(L) temporary space.
///
/// # Examples
///
/// ```ignore
/// handle_ipc_connection(stream, registry);
/// ```
fn handle_ipc_connection(mut stream: TcpStream, owned_processes: &OwnedProcessRegistry) {
    if let Err(error) = stream.set_read_timeout(Some(IPC_READ_TIMEOUT)) {
        eprintln!("[IPC ERROR] Could not configure the client read timeout: {error}");
        return;
    }
    if let Err(error) = stream.set_write_timeout(Some(IPC_READ_TIMEOUT)) {
        eprintln!("[IPC ERROR] Could not configure the client write timeout: {error}");
        return;
    }

    let mut payload = String::new();
    let read_result = {
        let bounded_stream = (&mut stream).take(IPC_MAX_PAYLOAD_BYTES + 1);
        BufReader::new(bounded_stream).read_line(&mut payload)
    };

    let bytes_read = match read_result {
        Ok(bytes_read) => bytes_read,
        Err(error) => {
            eprintln!("[IPC ERROR] Could not read the isolation command: {error}");
            if let Err(write_error) = write_ipc_receipt(&mut stream, IPC_ERROR_INVALID_COMMAND) {
                eprintln!(
                    "[IPC ERROR] Could not return the invalid-command receipt: {write_error}"
                );
            }
            return;
        }
    };

    if bytes_read as u64 > IPC_MAX_PAYLOAD_BYTES {
        eprintln!("[IPC ERROR] Rejected an oversized isolation command.");
        if let Err(error) = write_ipc_receipt(&mut stream, IPC_ERROR_INVALID_COMMAND) {
            eprintln!("[IPC ERROR] Could not return the invalid-command receipt: {error}");
        }
        return;
    }

    let target_pid = match parse_isolate_command(&payload) {
        Ok(target_pid) => target_pid,
        Err(error) => {
            eprintln!("[IPC ERROR] Rejected isolation command: {error}");
            if let Err(write_error) = write_ipc_receipt(&mut stream, IPC_ERROR_INVALID_COMMAND) {
                eprintln!(
                    "[IPC ERROR] Could not return the invalid-command receipt: {write_error}"
                );
            }
            return;
        }
    };

    println!(
        "[IPC COMMAND] Received Force Isolate request for PID: {}",
        target_pid
    );

    match isolate_registered_process(owned_processes, target_pid, terminate_native_process) {
        Ok(()) => {
            println!("[IPC ISOLATED] Successfully isolated owned PID: {target_pid}");
            if let Err(error) = write_ipc_receipt(&mut stream, IPC_SUCCESS_PID_ISOLATED) {
                eprintln!("[IPC ERROR] Could not return the isolation receipt: {error}");
            }
        }
        Err(IsolationError::TargetNotOwned) => {
            println!(
                "[SECURITY AUDIT] Unauthorized isolation request rejected for untracked PID: {}",
                target_pid
            );
            if let Err(error) = write_ipc_receipt(&mut stream, IPC_ERROR_PID_NOT_OWNED) {
                eprintln!("[IPC ERROR] Could not return the ownership rejection receipt: {error}");
            }
        }
        Err(error) => {
            eprintln!("[IPC REJECTED] Could not isolate PID {target_pid}: {error:?}");
            if let Err(write_error) = write_ipc_receipt(&mut stream, IPC_ERROR_ISOLATION_FAILED) {
                eprintln!(
                    "[IPC ERROR] Could not return the isolation failure receipt: {write_error}"
                );
            }
        }
    }
}

/// Starts the loopback-only IPC listener on a dedicated worker thread.
///
/// # Arguments
///
/// * `owned_processes` - The shared native process ownership registry.
///
/// # Returns
///
/// Returns the IPC worker handle after `127.0.0.1:9000` binds successfully.
///
/// # Errors
///
/// Returns an I/O error when the loopback address cannot be bound.
///
/// # Complexity
///
/// Startup uses O(1) time and space; each bounded connection uses O(L) time and
/// O(L) temporary space for payload length L.
///
/// # Examples
///
/// ```ignore
/// let worker = start_ipc_listener(registry)?;
/// ```
fn start_ipc_listener(owned_processes: OwnedProcessRegistry) -> Result<JoinHandle<()>, io::Error> {
    let listener = TcpListener::bind(IPC_BIND_ADDRESS)?;
    let worker_handle = thread::spawn(move || {
        for connection_result in listener.incoming() {
            match connection_result {
                Ok(stream) => handle_ipc_connection(stream, &owned_processes),
                Err(error) => eprintln!("[IPC ERROR] Could not accept a connection: {error}"),
            }
        }
    });

    Ok(worker_handle)
}

/// Starts the native Krypton filesystem monitor and processes kernel events.
///
/// The watcher resolves the project root from the process working directory,
/// monitors that canonical root recursively, and evaluates every event path
/// against the canonical repository-local sandbox boundary. It then blocks on
/// a thread-safe channel until the operating system or watcher backend closes
/// the event stream.
///
/// # Errors
///
/// Returns an error when the project root or sandbox cannot be resolved, the
/// platform watcher cannot be initialized, or the project root cannot be
/// registered for monitoring.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let current_dir = std::env::current_dir()?;
    let project_root = resolve_project_root(&current_dir)?;
    let alerts_ledger_path = project_root.join("alerts.json");
    let canonical_sandbox_root = ensure_sandbox_root(&project_root)?;
    let (alert_sender, alert_writer) = start_alert_writer(alerts_ledger_path.clone());
    let owned_processes = Arc::new(RwLock::new(HashSet::new()));
    let breakout_history = Arc::new(Mutex::new(HashMap::new()));
    let _ipc_worker = start_ipc_listener(Arc::clone(&owned_processes))?;
    let (event_sender, event_receiver) = channel::<notify::Result<Event>>();
    let sandbox_root_string = canonical_sandbox_root.to_string_lossy().into_owned();
    let mut watcher = notify::recommended_watcher(event_sender)?;

    watcher.watch(&project_root, RecursiveMode::Recursive)?;

    println!("[KRYPTON NATIVE] krypton-core-native startup verification successful.");
    println!("[KRYPTON NATIVE] IPC listener active at {IPC_BIND_ADDRESS}.");
    println!(
        "[KRYPTON NATIVE] Monitoring canonical project root path: {}",
        project_root.display()
    );

    for event_result in event_receiver {
        match event_result {
            Ok(event) => {
                let event_kind = event.kind;

                for event_path in event.paths {
                    let target_path = event_path.to_string_lossy();

                    if is_ignored_event_path(target_path.as_ref()) {
                        continue;
                    }

                    if event_path == alerts_ledger_path {
                        continue;
                    }

                    println!(
                        "[DEBUG] Raw kernel event caught: kind={event_kind:?}, path={}",
                        event_path.display()
                    );

                    match is_path_safe(&sandbox_root_string, target_path.as_ref()) {
                        Ok(true) => {}
                        Ok(false) => {
                            println!(
                                "[CRITICAL] PROJECT ROOT BREAKOUT EVENT INTERCEPTED AT: {}",
                                event_path.display()
                            );
                            enqueue_security_alert(&alert_sender, &event_path);
                            enforce_breakout_rate_limit(
                                &breakout_history,
                                &owned_processes,
                                &alert_sender,
                                &event_path,
                                Instant::now(),
                                terminate_native_process,
                            );
                        }
                        Err(error) => {
                            eprintln!(
                                "[CRITICAL] PROJECT ROOT EVENT FAILED CLOSED AT: {} ({error})",
                                event_path.display()
                            );
                            enqueue_security_alert(&alert_sender, &event_path);
                            enforce_breakout_rate_limit(
                                &breakout_history,
                                &owned_processes,
                                &alert_sender,
                                &event_path,
                                Instant::now(),
                                terminate_native_process,
                            );
                        }
                    }
                }
            }
            Err(error) => eprintln!("[ERROR] Native filesystem watcher event failed: {error}"),
        }
    }

    drop(alert_sender);

    if alert_writer.join().is_err() {
        return Err(io::Error::other("the native alert writer thread panicked").into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        append_security_alert, enforce_breakout_rate_limit, enqueue_security_alert,
        ensure_sandbox_root, is_ignored_event_path, is_path_safe, isolate_registered_process,
        parse_isolate_command, record_registered_breakout, resolve_project_root, write_ipc_receipt,
        IsolationError, SecurityAlert, IPC_ERROR_PID_NOT_OWNED, IPC_SUCCESS_PID_ISOLATED,
    };
    use serde_json::json;
    use std::cell::Cell;
    use std::collections::{HashMap, HashSet};
    use std::fs;
    use std::path::Path;
    use std::sync::mpsc::{sync_channel, TrySendError};
    use std::sync::{Arc, Mutex, RwLock};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    /// Builds one deterministic alert fixture for serialization and I/O tests.
    fn alert_fixture() -> SecurityAlert {
        SecurityAlert {
            id: "native:4242:2026-07-14T15:30:00.000Z:1".to_owned(),
            timestamp: "2026-07-14T15:30:00.000Z".to_owned(),
            target_process_id: 4242,
            attempted_action: "filesystem_boundary_breakout".to_owned(),
            attempted_path: "/tmp/escape".to_owned(),
            enforcement_status: "INTERCEPTED".to_owned(),
            trigger_signature: "NATIVE_FS_WATCH".to_owned(),
        }
    }

    /// Produces a unique temporary filesystem path owned by the current test run.
    fn temporary_test_path(test_name: &str) -> std::path::PathBuf {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock must be after the Unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "krypton-{test_name}-{}-{unique_suffix}.json",
            std::process::id()
        ))
    }

    #[test]
    fn test_is_path_safe_valid() {
        let project_root = temporary_test_path("safe-path-valid");
        let sandbox_root = project_root.join("sandbox_workspace");
        let safe_path = sandbox_root.join("agent-output.txt");
        fs::create_dir_all(&sandbox_root).expect("the temporary sandbox must be created");
        fs::write(&safe_path, "safe").expect("the in-sandbox fixture must be written");

        let is_safe = is_path_safe(
            sandbox_root
                .to_str()
                .expect("the sandbox fixture path must be valid UTF-8"),
            safe_path
                .to_str()
                .expect("the safe fixture path must be valid UTF-8"),
        )
        .expect("existing safe paths must be canonicalizable");

        fs::remove_dir_all(&project_root).expect("the safe-path fixture must be removable");
        assert!(is_safe);
    }

    #[test]
    fn test_is_path_safe_breakout() {
        let project_root = temporary_test_path("safe-path-breakout");
        let sandbox_root = project_root.join("sandbox_workspace");
        let outside_path = project_root.join("outside.txt");
        let traversal_path = sandbox_root.join("../outside.txt");
        fs::create_dir_all(&sandbox_root).expect("the temporary sandbox must be created");
        fs::write(&outside_path, "outside").expect("the breakout fixture must be written");

        let is_safe = is_path_safe(
            sandbox_root
                .to_str()
                .expect("the sandbox fixture path must be valid UTF-8"),
            traversal_path
                .to_str()
                .expect("the breakout fixture path must be valid UTF-8"),
        )
        .expect("existing breakout paths must be canonicalizable");

        fs::remove_dir_all(&project_root).expect("the breakout fixture must be removable");
        assert!(!is_safe);
    }

    #[test]
    fn test_process_registry_validation() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));
        let unauthorized_pid = 7331;

        let is_tracked = owned_processes
            .read()
            .expect("the ownership registry must remain readable")
            .contains(&unauthorized_pid);

        assert!(!is_tracked);
    }

    #[test]
    fn serializes_the_exact_camel_case_alert_schema() {
        let serialized = serde_json::to_value(alert_fixture())
            .expect("the alert fixture must serialize successfully");

        assert_eq!(
            serialized,
            json!({
                "id": "native:4242:2026-07-14T15:30:00.000Z:1",
                "timestamp": "2026-07-14T15:30:00.000Z",
                "targetProcessId": 4242,
                "attemptedAction": "filesystem_boundary_breakout",
                "attemptedPath": "/tmp/escape",
                "enforcementStatus": "INTERCEPTED",
                "triggerSignature": "NATIVE_FS_WATCH"
            })
        );
    }

    #[test]
    fn serializes_automated_quarantine_in_the_seven_field_schema() {
        let alert = SecurityAlert::automated_quarantine(Path::new("/tmp/escape"), 4242);
        let serialized = serde_json::to_value(alert)
            .expect("the automated quarantine alert must serialize successfully");

        assert_eq!(serialized.as_object().map(serde_json::Map::len), Some(7));
        assert_eq!(serialized["targetProcessId"], 4242);
        assert_eq!(serialized["enforcementStatus"], "AUTOMATED_QUARANTINE");
    }

    #[test]
    fn exceeds_the_rate_limit_on_the_fourth_breakout_within_five_seconds() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));
        let breakout_history = Arc::new(Mutex::new(HashMap::new()));
        let started_at = Instant::now();

        for offset_seconds in 0..3 {
            let exceeded = record_registered_breakout(
                &breakout_history,
                &owned_processes,
                started_at + Duration::from_secs(offset_seconds),
            )
            .expect("the breakout history must remain available");

            assert!(exceeded.is_empty());
        }

        let exceeded = record_registered_breakout(
            &breakout_history,
            &owned_processes,
            started_at + Duration::from_secs(3),
        )
        .expect("the breakout history must remain available");

        assert_eq!(exceeded, vec![4242]);
    }

    #[test]
    fn removes_breakouts_older_than_the_five_second_window() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));
        let breakout_history = Arc::new(Mutex::new(HashMap::new()));
        let started_at = Instant::now();

        for offset_seconds in [0, 1, 2, 6] {
            let exceeded = record_registered_breakout(
                &breakout_history,
                &owned_processes,
                started_at + Duration::from_secs(offset_seconds),
            )
            .expect("the breakout history must remain available");

            assert!(exceeded.is_empty());
        }

        let retained_event_count = breakout_history
            .lock()
            .expect("the breakout history must remain readable")
            .get(&4242)
            .map_or(0, std::collections::VecDeque::len);

        assert_eq!(retained_event_count, 3);
    }

    #[test]
    fn automatically_isolates_only_a_registered_rate_limited_process() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));
        let breakout_history = Arc::new(Mutex::new(HashMap::new()));
        let (sender, receiver) = sync_channel(1);
        let signaled_pid = Cell::new(0);
        let started_at = Instant::now();

        for offset_milliseconds in [0, 100, 200, 300] {
            enforce_breakout_rate_limit(
                &breakout_history,
                &owned_processes,
                &sender,
                Path::new("/tmp/escape"),
                started_at + Duration::from_millis(offset_milliseconds),
                |target_pid| {
                    signaled_pid.set(target_pid);
                    Ok(())
                },
            );
        }

        let alert = receiver
            .try_recv()
            .expect("automated quarantine telemetry must be queued");

        assert_eq!(signaled_pid.get(), 4242);
        assert_eq!(alert.enforcement_status, "AUTOMATED_QUARANTINE");
        assert!(!owned_processes
            .read()
            .expect("the ownership registry must remain readable")
            .contains(&4242));
    }

    #[test]
    fn never_tracks_or_signals_an_unregistered_process() {
        let owned_processes = Arc::new(RwLock::new(HashSet::new()));
        let breakout_history = Arc::new(Mutex::new(HashMap::new()));
        let (sender, receiver) = sync_channel(1);

        for _ in 0..4 {
            enforce_breakout_rate_limit(
                &breakout_history,
                &owned_processes,
                &sender,
                Path::new("/tmp/escape"),
                Instant::now(),
                |_| panic!("an unregistered PID must never reach native signal delivery"),
            );
        }

        assert!(breakout_history
            .lock()
            .expect("the breakout history must remain readable")
            .is_empty());
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn bounded_alert_queue_reports_saturation_without_blocking() {
        let (sender, _receiver) = sync_channel(1);

        assert!(sender.try_send(alert_fixture()).is_ok());
        assert!(matches!(
            sender.try_send(alert_fixture()),
            Err(TrySendError::Full(_))
        ));
    }

    #[test]
    fn queues_the_denied_event_path_for_non_blocking_persistence() {
        let (sender, receiver) = sync_channel(1);

        enqueue_security_alert(&sender, Path::new("/tmp/outside-sandbox.txt"));
        let alert = receiver
            .try_recv()
            .expect("the denied path alert must be queued immediately");

        assert_eq!(alert.attempted_path, "/tmp/outside-sandbox.txt");
    }

    #[test]
    fn ignores_generated_and_repository_metadata_paths() {
        for event_path in [
            "/project/.next/cache/trace",
            "/project/node_modules/notify/index.js",
            "/project/.git/index",
        ] {
            assert!(is_ignored_event_path(event_path));
        }
    }

    #[test]
    fn keeps_normal_project_paths_for_policy_evaluation() {
        assert!(!is_ignored_event_path(
            "/project/sandbox_workspace/agent-output.txt"
        ));
    }

    #[test]
    fn parses_a_valid_force_isolate_command() {
        assert_eq!(parse_isolate_command("ISOLATE:4242\n"), Ok(4242));
    }

    #[test]
    fn rejects_malformed_force_isolate_commands() {
        for payload in [
            "",
            "KILL:4242",
            "ISOLATE:",
            "ISOLATE:-1",
            "ISOLATE:0",
            "ISOLATE:42:43",
        ] {
            assert!(parse_isolate_command(payload).is_err());
        }
    }

    #[test]
    fn rejects_an_unregistered_pid_without_signaling_it() {
        let owned_processes = Arc::new(RwLock::new(HashSet::new()));

        let result = isolate_registered_process(&owned_processes, 4242, |_| {
            panic!("an unregistered PID must never reach native signal delivery")
        });

        assert_eq!(result, Err(IsolationError::TargetNotOwned));
    }

    #[test]
    fn signals_and_consumes_a_registered_owned_pid() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));
        let signaled_pid = Cell::new(0);

        let result = isolate_registered_process(&owned_processes, 4242, |target_pid| {
            signaled_pid.set(target_pid);
            Ok(())
        });

        assert!(result.is_ok());
        assert_eq!(signaled_pid.get(), 4242);
        assert!(!owned_processes
            .read()
            .expect("the test registry must remain readable")
            .contains(&4242));
    }

    #[test]
    fn preserves_registration_when_native_signal_delivery_fails() {
        let owned_processes = Arc::new(RwLock::new(HashSet::from([4242])));

        let result = isolate_registered_process(&owned_processes, 4242, |_| {
            Err("simulated signal failure".to_owned())
        });

        assert_eq!(
            result,
            Err(IsolationError::SignalFailed(
                "simulated signal failure".to_owned()
            ))
        );
        assert!(owned_processes
            .read()
            .expect("the test registry must remain readable")
            .contains(&4242));
    }

    #[test]
    fn flushes_the_exact_unowned_pid_receipt() {
        let mut receipt_buffer = Vec::new();

        write_ipc_receipt(&mut receipt_buffer, IPC_ERROR_PID_NOT_OWNED)
            .expect("the receipt buffer must accept the error status");

        assert_eq!(receipt_buffer, b"ERROR: PID_NOT_OWNED\n");
    }

    #[test]
    fn flushes_the_exact_successful_isolation_receipt() {
        let mut receipt_buffer = Vec::new();

        write_ipc_receipt(&mut receipt_buffer, IPC_SUCCESS_PID_ISOLATED)
            .expect("the receipt buffer must accept the success status");

        assert_eq!(receipt_buffer, b"SUCCESS: PID_ISOLATED\n");
    }

    #[test]
    fn appends_one_newline_delimited_alert() {
        let ledger_path = temporary_test_path("append");

        append_security_alert(&ledger_path, &alert_fixture())
            .expect("the temporary alert ledger must accept an append");
        let ledger_contents =
            fs::read_to_string(&ledger_path).expect("the temporary ledger must be readable");
        fs::remove_file(&ledger_path).expect("the temporary ledger must be removable");

        assert!(ledger_contents.ends_with("}\n"));
    }

    #[test]
    fn replaces_an_empty_array_before_the_first_native_alert() {
        let ledger_path = temporary_test_path("empty-array-reset");
        fs::write(&ledger_path, "[]\n").expect("the reset ledger must be initialized");

        append_security_alert(&ledger_path, &alert_fixture())
            .expect("the reset ledger must accept the first native alert");
        let ledger_contents =
            fs::read_to_string(&ledger_path).expect("the native ledger must be readable");
        fs::remove_file(&ledger_path).expect("the temporary ledger must be removable");

        assert!(ledger_contents.starts_with('{'));
    }

    #[test]
    fn returns_an_error_when_the_ledger_parent_is_missing() {
        let missing_parent = temporary_test_path("missing-parent");
        let ledger_path = missing_parent.join("alerts.json");

        let result = append_security_alert(&ledger_path, &alert_fixture());

        assert!(result.is_err());
    }

    #[test]
    fn creates_a_missing_project_root_sandbox_directory() {
        let project_root = temporary_test_path("sandbox-project");
        fs::create_dir_all(&project_root).expect("the temporary project root must be created");

        let sandbox_root = ensure_sandbox_root(&project_root)
            .expect("the missing sandbox directory must be initialized");
        let expected_sandbox_root = fs::canonicalize(project_root.join("sandbox_workspace"))
            .expect("the initialized sandbox must be canonicalizable");
        fs::remove_dir_all(&project_root).expect("the temporary project root must be removable");

        assert_eq!(sandbox_root, expected_sandbox_root);
    }

    #[test]
    fn resolves_the_project_root_from_the_nested_native_crate() {
        let project_root = temporary_test_path("root-resolution");
        let native_crate = project_root.join("src/core-native");
        fs::create_dir_all(&native_crate).expect("the temporary native crate must be created");
        fs::write(project_root.join("package.json"), "{}")
            .expect("the temporary Node.js manifest must be created");
        fs::write(native_crate.join("Cargo.toml"), "[package]")
            .expect("the temporary Cargo manifest must be created");

        let resolved_project_root = resolve_project_root(&native_crate)
            .expect("the project root must resolve from the nested crate");
        let expected_project_root =
            fs::canonicalize(&project_root).expect("the project root must be canonicalizable");
        fs::remove_dir_all(&project_root).expect("the temporary project root must be removable");

        assert_eq!(resolved_project_root, expected_project_root);
    }
}
