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

use config::{load_runtime_config, resolve_repository_root, CONFIG_FILE_NAME};
use ipc::{start_ipc, ControlState, EnforcementMode};
use notification::{start_notification_dispatcher, MacOsNotificationDelivery};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use path_policy::{is_ignored_path, resolve_path};
use process_identity::SystemProcessInspector;
use process_registry::ProcessRegistry;
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

fn ensure_directory(path: &std::path::Path) -> Result<std::path::PathBuf, io::Error> {
    fs::create_dir_all(path)?;
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotADirectory,
            "configured protected workspace is not a directory",
        ));
    }
    Ok(canonical)
}

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
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            if report_runtime_failure(&mut io::stderr(), error.as_ref()).is_err() {
                // Failed diagnostics remain operational failure. Do not retry
                // a broken stderr or use default Result termination formatting.
                return std::process::ExitCode::FAILURE;
            }
            std::process::ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let repository_root = resolve_repository_root(&std::env::current_dir()?)?;
    let config = load_runtime_config(&repository_root)?;
    let project_root = fs::canonicalize(repository_root.join(&config.project_root))?;
    let protected_root = ensure_directory(&config.protected_root(&repository_root))?;
    if protected_root == project_root {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "protected workspace must be narrower than project root",
        )
        .into());
    }
    let ledger = Arc::new(TelemetryLedger::open(
        config.telemetry_file(&repository_root),
        config.telemetry_max_events,
        config.telemetry_max_bytes,
    )?);
    let (telemetry_sender, _telemetry_worker) = start_writer(Arc::clone(&ledger))?;
    let (notification_dispatcher, notification_health, _notification_worker) =
        start_notification_dispatcher(MacOsNotificationDelivery)?;
    let components = Arc::new(health::RuntimeHealth::default());
    let control_state = Arc::new(ControlState {
        mcp: Some(mcp::McpBoundary::new(
            &protected_root,
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
    let ipc = start_ipc(&config.runtime_root(&repository_root), control_state)?;
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
    native_watcher.watch(&protected_root, RecursiveMode::Recursive)?;
    let mut observed_root_count = 0_usize;
    for configured_root in &config.observed_roots {
        let observed_root = fs::canonicalize(project_root.join(configured_root))?;
        if observed_root == protected_root {
            continue;
        }
        native_watcher.watch(&observed_root, RecursiveMode::Recursive)?;
        observed_root_count += 1;
    }

    components.watcher_ready.store(true, Ordering::Relaxed);
    writeln!(
        io::stdout(),
        "[KRYPTON NATIVE] startup verification successful."
    )?;
    writeln!(io::stdout(), "[KRYPTON NATIVE] loaded {CONFIG_FILE_NAME}.")?;
    writeln!(
        io::stdout(),
        "[KRYPTON NATIVE] project root: {}",
        project_root.display()
    )?;
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
                        || event_path.starts_with(config.runtime_root(&repository_root))
                        || event_path.starts_with(
                            config
                                .telemetry_file(&repository_root)
                                .parent()
                                .unwrap_or(&project_root),
                        )
                    {
                        continue;
                    }
                    let decision = match resolve_path(&protected_root, &event_path) {
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
