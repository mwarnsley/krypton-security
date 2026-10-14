#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::todo,
        clippy::unimplemented,
        clippy::indexing_slicing,
        clippy::print_stdout,
        clippy::print_stderr
    )
)]

mod config;
mod health;
mod ipc;
mod mcp;
mod notification;
mod path_policy;
mod process_identity;
mod process_registry;
#[cfg(test)]
mod simulation;
mod telemetry;
mod watcher;

#[cfg(not(unix))]
compile_error!(
    "Krypton native enforcement currently supports Unix platforms only because authenticated control requires Unix-domain sockets and peer credentials"
);

use config::{load_runtime_paths, parse_startup_mode, StartupMode, CONFIG_FILE_NAME};
use ipc::{start_ipc, ControlState, EnforcementMode};
use notification::{start_notification_dispatcher, MacOsNotificationDelivery};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use path_policy::{is_ignored_path, resolve_path};
use process_identity::SystemProcessInspector;
use process_registry::ProcessRegistry;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::sync::atomic::Ordering;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, RwLock};
use telemetry::{start_writer, TelemetryLedger};
use watcher::{
    record_portable_boundary_event, FilesystemEvent, PortableAttributionAdapter,
    ProcessEventAttributionAdapter,
};

fn is_rename_or_remove(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
    )
}

/// Emits only a fixed category: configuration/deserialization errors may include
/// caller-controlled or sensitive values and must never reach daemon diagnostics.
fn report_runtime_failure(
    writer: &mut impl Write,
    error: &(dyn std::error::Error + 'static),
) -> io::Result<()> {
    let category = error
        .downcast_ref::<io::Error>()
        .map_or("native component failure", |error| match error.kind() {
            io::ErrorKind::NotFound => "required local resource missing",
            io::ErrorKind::PermissionDenied => "local resource access denied",
            io::ErrorKind::InvalidData | io::ErrorKind::InvalidInput => {
                "invalid runtime configuration or data"
            }
            io::ErrorKind::TimedOut => "local operation timed out",
            io::ErrorKind::BrokenPipe | io::ErrorKind::UnexpectedEof => {
                "local component disconnected"
            }
            io::ErrorKind::AddrInUse | io::ErrorKind::WouldBlock => "local runtime resource busy",
            _ => "local operation failed",
        });
    writeln!(writer, "[KRYPTON] Native startup/runtime failed: {category}. Inspect configuration and local health.")
}

fn main() -> std::process::ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    run_with_args(&args, &mut io::stderr())
}

/// Owns terminal diagnostics and exit codes; invalid arguments are rejected
/// before looking up configuration or starting any native component.
fn run_with_args(args: &[OsString], diagnostics: &mut impl Write) -> std::process::ExitCode {
    let mode = match parse_startup_mode(args) {
        Ok(mode) => mode,
        Err(_) => {
            if writeln!(diagnostics, "[KRYPTON] Usage: krypton-core-native [--standalone-config <absolute-private-config-path>]").is_err() {
                return std::process::ExitCode::FAILURE;
            }
            return std::process::ExitCode::from(2);
        }
    };
    match run(&mode) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            if report_runtime_failure(diagnostics, error.as_ref()).is_err() {
                // A broken diagnostic stream is a failure; never retry it.
                return std::process::ExitCode::FAILURE;
            }
            std::process::ExitCode::FAILURE
        }
    }
}

fn run(mode: &StartupMode) -> Result<(), Box<dyn std::error::Error>> {
    let current_dir = std::env::current_dir()?;
    let config = load_runtime_paths(mode, &current_dir)?;
    // Own the persistent standalone instance before ledger open/repair or any
    // worker startup. Keep this inode locked until the daemon returns/exits.
    let instance_lock = config.acquire_instance_lock()?;
    // Preserve the checkout-only project-root startup diagnostic at this
    // boundary. All long-lived native components consume resolved paths.
    let project_root = config.project_root.clone();
    let protected_root = &config.protected_root;
    let telemetry_parent = config.telemetry_file.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "telemetry destination has no parent",
        )
    })?;
    let writer_instance_lock = instance_lock
        .as_ref()
        .map(fs::File::try_clone)
        .transpose()?;
    let ledger = Arc::new(TelemetryLedger::open_with_instance_lock(
        config.telemetry_file.clone(),
        config.telemetry_max_events,
        config.telemetry_max_bytes,
        writer_instance_lock,
    )?);
    let (telemetry_sender, _telemetry_worker) = start_writer(Arc::clone(&ledger))?;
    let (notification_dispatcher, notification_health, _notification_worker) =
        start_notification_dispatcher(MacOsNotificationDelivery)?;
    let components = Arc::new(health::RuntimeHealth::default());
    let control_state = Arc::new(ControlState {
        mcp: Some(mcp::McpBoundary::new(
            protected_root,
            telemetry_sender.clone(),
        )?),
        registry: Arc::new(ProcessRegistry::default()),
        mode: Arc::new(RwLock::new(EnforcementMode::default())),
        ledger_health: ledger.health(),
        inspector: Arc::new(SystemProcessInspector),
        notifier: Arc::new(notification_dispatcher),
        notification_health,
        components: Arc::clone(&components),
    });
    let ipc = start_ipc(&config.runtime_directory, control_state)?;
    let ignored_components = config.ignored_components();
    let (event_sender, event_receiver) = sync_channel::<notify::Result<Event>>(1024);
    let callback_health = Arc::clone(&components);
    let mut native_watcher = notify::recommended_watcher(move |event| {
        if event_sender.try_send(event).is_err() {
            callback_health
                .telemetry_dropped
                .store(true, Ordering::Relaxed);
        }
    })?;
    native_watcher.watch(protected_root, RecursiveMode::Recursive)?;
    let mut observed_root_count = 0_usize;
    for observed_root in &config.observed_roots {
        if observed_root == protected_root {
            continue;
        }
        native_watcher.watch(observed_root, RecursiveMode::Recursive)?;
        observed_root_count += 1;
    }

    components.watcher_ready.store(true, Ordering::Relaxed);
    writeln!(
        io::stdout(),
        "[KRYPTON NATIVE] startup verification successful."
    )?;
    if let Some(project_root) = project_root {
        writeln!(io::stdout(), "[KRYPTON NATIVE] loaded {CONFIG_FILE_NAME}.")?;
        writeln!(
            io::stdout(),
            "[KRYPTON NATIVE] project root: {}",
            project_root.display()
        )?;
    } else {
        writeln!(
            io::stdout(),
            "[KRYPTON NATIVE] loaded standalone configuration."
        )?;
    }
    writeln!(
        io::stdout(),
        "[KRYPTON NATIVE] protected workspace: {}",
        protected_root.display()
    )?;
    writeln!(
        io::stdout(),
        "[KRYPTON NATIVE] additional observed roots: {observed_root_count}"
    )?;

    for result in event_receiver {
        match result {
            Ok(event) => {
                for event_path in event.paths {
                    if is_ignored_path(&event_path, &ignored_components)
                        || event_path.starts_with(&config.runtime_directory)
                        || event_path.starts_with(telemetry_parent)
                    {
                        continue;
                    }
                    let decision = match resolve_path(protected_root, &event_path) {
                        Ok(decision) => decision,
                        Err(error) => {
                            components.watcher_failed.store(true, Ordering::Relaxed);
                            writeln!(
                                io::stderr(),
                                "[SECURITY] path evaluation failed closed for {}: {error}",
                                event_path.display()
                            )?;
                            continue;
                        }
                    };
                    if decision.within_protected_root {
                        continue;
                    }
                    let filesystem_event = FilesystemEvent {
                        path: event_path.clone(),
                        decision,
                    };
                    if let Err(error) =
                        PortableAttributionAdapter.attribution_for_event(&filesystem_event)
                    {
                        writeln!(
                            io::stderr(),
                            "[WATCHER ERROR] attribution adapter failed: {error:?}"
                        )?;
                        components.watcher_failed.store(true, Ordering::Relaxed);
                    }
                    if !record_portable_boundary_event(
                        &filesystem_event,
                        ledger.next_sequence(),
                        &telemetry_sender,
                    ) {
                        components.telemetry_dropped.store(true, Ordering::Relaxed);
                    }
                    writeln!(io::stdout(),
                            "[SECURITY] unattributed workspace-boundary event: kind={:?}, path={}, missing={}",
                            event.kind,
                            filesystem_event.path.display(),
                            is_rename_or_remove(&event.kind)
                        )?;
                }
            }
            Err(error) => {
                components.watcher_failed.store(true, Ordering::Relaxed);
                writeln!(io::stderr(), "[WATCHER ERROR] {error}")?;
            }
        }
    }

    drop(telemetry_sender);
    components.watcher_failed.store(true, Ordering::Relaxed);
    // A disconnected watcher is a terminal degraded state, never a join on the
    // intentionally long-running listener. Process exit closes its owned sockets.
    drop(ipc);
    Err(io::Error::new(
        io::ErrorKind::BrokenPipe,
        "native watcher event channel disconnected",
    )
    .into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn standalone_instance_contention_denies_before_ledger_open() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "krypton-instance-lock-order-{}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let instance = root.join("instance");
        let runtime = instance.join(".krypton/runtime");
        let config_directory = instance.join("config");
        let protected = root.join("protected");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::create_dir(&config_directory).unwrap();
        std::fs::create_dir(&protected).unwrap();
        for directory in [
            &instance,
            &instance.join(".krypton"),
            &runtime,
            &config_directory,
        ] {
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let config_path = config_directory.join("runtime.json");
        let telemetry = instance.join(".krypton/telemetry/alerts.jsonl");
        std::fs::write(
            &config_path,
            serde_json::json!({
                "schemaVersion": 1,
                "protectedWorkspaceRoot": protected,
                "runtimeDirectory": runtime,
                "telemetryPath": telemetry,
                "ignoredPaths": ["node_modules", ".git", ".krypton"],
                "telemetryMaxEvents": 10000,
                "telemetryMaxBytes": 8388608,
                "rateLimitWindowSeconds": 10,
                "rateLimitMaxBreakouts": 3
            })
            .to_string(),
        )
        .unwrap();
        std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let mode = super::config::StartupMode::Standalone(config_path.clone());
        let paths = super::config::load_runtime_paths(&mode, &root).unwrap();
        let guard = paths.acquire_instance_lock().unwrap();
        // Stop a regressed caller at IPC startup rather than entering its service
        // loop: opening this directory as the runtime lock always fails closed.
        std::fs::create_dir(runtime.join("startup.lock")).unwrap();
        let mut output = Vec::new();
        let status = super::run_with_args(
            &[
                std::ffi::OsString::from("--standalone-config"),
                config_path.into_os_string(),
            ],
            &mut output,
        );
        let ledger_opened = telemetry.exists();
        drop(guard);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(status, std::process::ExitCode::FAILURE);
        assert!(
            !ledger_opened,
            "ledger was opened before persistent ownership"
        );
        let diagnostic = String::from_utf8(output).unwrap();
        assert!(diagnostic.contains("local runtime resource busy"));
        assert!(!diagnostic.contains(&root.to_string_lossy().into_owned()));
    }

    #[test]
    fn invalid_startup_invocation_exits_two_without_starting_runtime() {
        let mut output = Vec::new();
        assert_eq!(
            super::run_with_args(
                &[std::ffi::OsString::from("--unknown-fake-secret")],
                &mut output
            ),
            std::process::ExitCode::from(2)
        );
        assert!(!String::from_utf8(output).unwrap().contains("fake-secret"));
    }

    #[test]
    fn unavailable_standalone_configuration_is_operational_failure() {
        let mut output = Vec::new();
        assert_eq!(
            super::run_with_args(
                &[
                    std::ffi::OsString::from("--standalone-config"),
                    std::ffi::OsString::from("/nonexistent-fake-private-config.json")
                ],
                &mut output
            ),
            std::process::ExitCode::FAILURE
        );
        assert!(!String::from_utf8(output).unwrap().contains("fake-private"));
    }

    #[test]
    fn terminal_failure_diagnostic_redacts_untrusted_error_details() {
        let error = std::io::Error::other("fake-sensitive-config-value");
        let mut output = Vec::new();
        super::report_runtime_failure(&mut output, &error).unwrap();
        let message = String::from_utf8(output).unwrap();
        assert!(message.contains("Native startup/runtime failed"));
        assert!(!message.contains("fake-sensitive-config-value"));
    }

    #[test]
    fn terminal_failure_preserves_a_broken_diagnostic_writer_as_an_error() {
        struct Broken;
        impl std::io::Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "closed",
                ))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let error = std::io::Error::other("fake-sensitive-config-value");
        assert_eq!(
            super::report_runtime_failure(&mut Broken, &error)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::BrokenPipe
        );
    }
}
