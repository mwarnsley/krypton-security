use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::fs;
use std::io;
use std::path::Path;
use std::sync::mpsc::channel;

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

/// Starts the native Krypton filesystem monitor and processes kernel events.
///
/// The watcher resolves the repository-local sandbox independently of the
/// process working directory, then blocks on a thread-safe channel until the
/// operating system or watcher backend closes the event stream.
///
/// # Errors
///
/// Returns an error when the sandbox cannot be resolved, the platform watcher
/// cannot be initialized, or the sandbox cannot be registered for monitoring.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sandbox_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("sandbox_workspace");
    let canonical_sandbox_root = fs::canonicalize(&sandbox_root)?;
    let sandbox_root_string = canonical_sandbox_root.to_string_lossy().into_owned();
    let (event_sender, event_receiver) = channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(event_sender)?;

    watcher.watch(&canonical_sandbox_root, RecursiveMode::Recursive)?;

    println!("[KRYPTON NATIVE] krypton-core-native startup verification successful.");

    for event_result in event_receiver {
        match event_result {
            Ok(event) if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) => {
                for event_path in event.paths {
                    let target_path = event_path.to_string_lossy();

                    match is_path_safe(&sandbox_root_string, target_path.as_ref()) {
                        Ok(true) => {}
                        Ok(false) => println!(
                            "[CRITICAL] Sandbox breakout event intercepted at: {}",
                            event_path.display()
                        ),
                        Err(error) => eprintln!(
                            "[CRITICAL] Sandbox event failed closed at: {} ({error})",
                            event_path.display()
                        ),
                    }
                }
            }
            Ok(_) => {}
            Err(error) => eprintln!("[ERROR] Native filesystem watcher event failed: {error}"),
        }
    }

    Ok(())
}
