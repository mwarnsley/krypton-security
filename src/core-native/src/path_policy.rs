use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PathDecision {
    pub resolved_path: PathBuf,
    pub target_existed: bool,
    pub within_protected_root: bool,
}

fn normalized_platform_path(path: &Path) -> PathBuf {
    if cfg!(windows) {
        path.to_path_buf()
    } else {
        PathBuf::from(path.to_string_lossy().replace('\\', "/"))
    }
}

pub fn is_ignored_path(path: &Path, ignored_components: &HashSet<OsString>) -> bool {
    normalized_platform_path(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value),
            _ => None,
        })
        .any(|component| ignored_components.contains(component))
}

fn validated_components(path: &Path) -> Result<Vec<OsString>, io::Error> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value.to_os_string()),
            Component::CurDir => Ok(OsString::from(".")),
            Component::ParentDir => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "parent traversal is not permitted",
            )),
            Component::RootDir | Component::Prefix(_) => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "remaining path components must be relative",
            )),
        })
        .collect()
}

pub fn resolve_path(protected_root: &Path, target: &Path) -> Result<PathDecision, io::Error> {
    let canonical_root = fs::canonicalize(protected_root)?;
    let normalized_target = normalized_platform_path(target);
    if normalized_target
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "parent traversal is not permitted",
        ));
    }

    if normalized_target.exists() {
        let resolved_path = fs::canonicalize(&normalized_target)?;
        return Ok(PathDecision {
            within_protected_root: resolved_path.starts_with(&canonical_root),
            resolved_path,
            target_existed: true,
        });
    }

    let mut ancestor = normalized_target.as_path();
    let mut missing_names = Vec::new();

    while !ancestor.exists() {
        let name = ancestor.file_name().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "no existing ancestor could be resolved",
            )
        })?;
        missing_names.push(name.to_os_string());
        ancestor = ancestor.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "no existing ancestor could be resolved",
            )
        })?;
    }

    let canonical_ancestor = fs::canonicalize(ancestor)?;
    missing_names.reverse();
    let relative_tail = missing_names.iter().collect::<PathBuf>();
    let validated_tail = validated_components(&relative_tail)?;
    let mut resolved_path = canonical_ancestor;

    for component in validated_tail {
        if component != "." {
            resolved_path.push(component);
        }
    }

    Ok(PathDecision {
        within_protected_root: resolved_path.starts_with(&canonical_root),
        resolved_path,
        target_existed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_ignored_path, resolve_path};
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_root(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("krypton-path-{name}-{suffix}"))
    }

    #[test]
    fn ignores_only_exact_components_with_either_separator() {
        let ignored = HashSet::from([OsString::from("node_modules")]);
        assert!(is_ignored_path(
            Path::new(r"C:\project\node_modules\pkg"),
            &ignored
        ));
        assert!(!is_ignored_path(
            Path::new("/project/not_node_modules/pkg"),
            &ignored
        ));
    }

    #[test]
    fn resolves_a_deleted_target_through_its_existing_ancestor() {
        let root = fixture_root("deleted");
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");
        let decision = resolve_path(&workspace, &workspace.join("gone/file.txt")).expect("resolve");
        fs::remove_dir_all(&root).expect("cleanup");
        assert!(decision.within_protected_root);
        assert!(!decision.target_existed);
    }

    #[test]
    fn rejects_sibling_prefix_confusion() {
        let root = fixture_root("sibling");
        let workspace = root.join("workspace");
        let sibling = root.join("workspace-safe");
        fs::create_dir_all(&workspace).expect("workspace");
        fs::create_dir_all(&sibling).expect("sibling");
        let decision = resolve_path(&workspace, &sibling.join("file.txt")).expect("resolve");
        fs::remove_dir_all(&root).expect("cleanup");
        assert!(!decision.within_protected_root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_workspace() {
        use std::os::unix::fs::symlink;
        let root = fixture_root("symlink");
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        fs::create_dir_all(&workspace).expect("workspace");
        fs::create_dir_all(&outside).expect("outside");
        symlink(&outside, workspace.join("escape")).expect("symlink");
        let decision = resolve_path(&workspace, &workspace.join("escape")).expect("resolve");
        fs::remove_dir_all(&root).expect("cleanup");
        assert!(!decision.within_protected_root);
    }
}
