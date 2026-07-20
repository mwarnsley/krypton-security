mod config;
mod ipc;
mod path_policy;
mod process_identity;
mod process_registry;
mod telemetry;
mod watcher;

#[cfg(not(unix))]
compile_error!(
    "Krypton native enforcement currently supports Unix platforms only because authenticated control requires Unix-domain sockets and peer credentials"
);

use config::{load_runtime_config, resolve_repository_root, CONFIG_FILE_NAME};
use ipc::{start_ipc, ControlState, EnforcementMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use path_policy::{is_ignored_path, resolve_path};
use process_identity::SystemProcessInspector;
use process_registry::ProcessRegistry;
use std::fs;
use std::io;
use std::sync::mpsc::channel;
use std::sync::{Arc, RwLock};
use telemetry::{start_writer, TelemetryLedger};
use watcher::{
    record_portable_boundary_event, FilesystemEvent, PortableAttributionAdapter,
    ProcessEventAttributionAdapter,
};

fn ensure_directory(path: &std::path::Path) -> Result<std::path::PathBuf, io::Error> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    let (telemetry_sender, _telemetry_worker) = start_writer(Arc::clone(&ledger));
    let control_state = Arc::new(ControlState {
        registry: Arc::new(ProcessRegistry::default()),
        mode: Arc::new(RwLock::new(EnforcementMode::default())),
        ledger_health: ledger.health(),
        inspector: Arc::new(SystemProcessInspector),
    });
    let ipc = start_ipc(&config.runtime_root(&repository_root), control_state)?;
    let ignored_components = config.ignored_components();
    let (event_sender, event_receiver) = channel::<notify::Result<Event>>();
    let mut native_watcher = notify::recommended_watcher(event_sender)?;
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

    println!("[KRYPTON NATIVE] startup verification successful.");
    println!(
        "[KRYPTON NATIVE] authenticated IPC endpoint: {}",
        ipc.endpoint.display()
    );
    println!(
        "[KRYPTON NATIVE] capability file secured at: {}",
        ipc.capability_file.display()
    );
    println!("[KRYPTON NATIVE] loaded {CONFIG_FILE_NAME}.");
    println!("[KRYPTON NATIVE] project root: {}", project_root.display());
    println!(
        "[KRYPTON NATIVE] protected workspace: {}",
        protected_root.display()
    );
    println!("[KRYPTON NATIVE] additional observed roots: {observed_root_count}");

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
                            eprintln!(
                                "[SECURITY] path evaluation failed closed for {}: {error}",
                                event_path.display()
                            );
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
                        eprintln!("[WATCHER ERROR] attribution adapter failed: {error:?}");
                    }
                    record_portable_boundary_event(
                        &filesystem_event,
                        ledger.next_sequence(),
                        &telemetry_sender,
                    );
                    println!(
                            "[SECURITY] unattributed workspace-boundary event: kind={:?}, path={}, missing={}",
                            event.kind,
                            filesystem_event.path.display(),
                            is_rename_or_remove(&event.kind)
                        );
                }
            }
            Err(error) => eprintln!("[WATCHER ERROR] {error}"),
        }
    }

    drop(telemetry_sender);
    let _ = ipc.worker.join();
    Ok(())
}
