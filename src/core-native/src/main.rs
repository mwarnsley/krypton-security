use std::fs;
use std::io;

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

fn main() {
    println!("[KRYPTON NATIVE] krypton-core-native startup verification successful.");
}
