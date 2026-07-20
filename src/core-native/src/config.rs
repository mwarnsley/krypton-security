use serde::Deserialize;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = "krypton.config.json";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub project_root: PathBuf,
    pub protected_workspace_root: PathBuf,
    pub telemetry_path: PathBuf,
    pub runtime_directory: PathBuf,
    pub ignored_paths: Vec<String>,
    #[serde(default)]
    pub observed_roots: Vec<PathBuf>,
    #[serde(default)]
    pub sensitive_paths: Vec<PathBuf>,
    pub telemetry_max_events: usize,
    pub telemetry_max_bytes: u64,
    pub rate_limit_window_seconds: u64,
    pub rate_limit_max_breakouts: usize,
}

impl RuntimeConfig {
    pub fn ignored_components(&self) -> HashSet<OsString> {
        self.ignored_paths.iter().map(OsString::from).collect()
    }

    pub fn protected_root(&self, repository_root: &Path) -> PathBuf {
        repository_root
            .join(&self.project_root)
            .join(&self.protected_workspace_root)
    }

    pub fn runtime_root(&self, repository_root: &Path) -> PathBuf {
        repository_root
            .join(&self.project_root)
            .join(&self.runtime_directory)
    }

    pub fn telemetry_file(&self, repository_root: &Path) -> PathBuf {
        repository_root
            .join(&self.project_root)
            .join(&self.telemetry_path)
    }
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

pub fn validate_runtime_config(config: &RuntimeConfig) -> Result<(), io::Error> {
    if !is_safe_relative_path(&config.project_root)
        || !is_safe_relative_path(&config.protected_workspace_root)
        || !is_safe_relative_path(&config.telemetry_path)
        || !is_safe_relative_path(&config.runtime_directory)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "configured roots must be non-empty relative paths without parent traversal",
        ));
    }

    if config.protected_workspace_root == Path::new(".") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "protectedWorkspaceRoot must not equal projectRoot",
        ));
    }

    if config.telemetry_max_events == 0
        || config.telemetry_max_bytes == 0
        || config.rate_limit_window_seconds == 0
        || config.rate_limit_max_breakouts == 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "telemetry and rate-limit bounds must be greater than zero",
        ));
    }

    if config.ignored_paths.iter().any(|value| {
        value.is_empty()
            || Path::new(value).components().count() != 1
            || matches!(value.as_str(), "." | "..")
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "ignoredPaths entries must be exact path components",
        ));
    }

    if config
        .observed_roots
        .iter()
        .chain(config.sensitive_paths.iter())
        .any(|path| !is_safe_relative_path(path))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "observedRoots and sensitivePaths entries must be non-empty relative paths without parent traversal",
        ));
    }

    Ok(())
}

pub fn load_runtime_config(repository_root: &Path) -> Result<RuntimeConfig, io::Error> {
    let contents = fs::read_to_string(repository_root.join(CONFIG_FILE_NAME))?;
    let config = serde_json::from_str::<RuntimeConfig>(&contents).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{CONFIG_FILE_NAME} is not valid JSON: {error}"),
        )
    })?;
    validate_runtime_config(&config)?;
    Ok(config)
}

pub fn resolve_repository_root(current_dir: &Path) -> Result<PathBuf, io::Error> {
    let root = current_dir
        .ancestors()
        .find(|candidate| {
            candidate.join("package.json").is_file()
                && candidate.join("src/core-native/Cargo.toml").is_file()
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Krypton root not found"))?;
    fs::canonicalize(root)
}

#[cfg(test)]
mod tests {
    use super::{validate_runtime_config, RuntimeConfig};
    use std::path::PathBuf;

    fn fixture() -> RuntimeConfig {
        RuntimeConfig {
            project_root: PathBuf::from("."),
            protected_workspace_root: PathBuf::from("sandbox_workspace"),
            telemetry_path: PathBuf::from(".krypton/telemetry/alerts.jsonl"),
            runtime_directory: PathBuf::from(".krypton/runtime"),
            ignored_paths: vec!["node_modules".to_owned()],
            observed_roots: vec![],
            sensitive_paths: vec![],
            telemetry_max_events: 100,
            telemetry_max_bytes: 4096,
            rate_limit_window_seconds: 5,
            rate_limit_max_breakouts: 3,
        }
    }

    #[test]
    fn accepts_a_narrow_workspace_root() {
        assert!(validate_runtime_config(&fixture()).is_ok());
    }

    #[test]
    fn rejects_project_root_as_the_protected_workspace() {
        let mut config = fixture();
        config.protected_workspace_root = PathBuf::from(".");
        assert!(validate_runtime_config(&config).is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        let mut config = fixture();
        config.protected_workspace_root = PathBuf::from("../outside");
        assert!(validate_runtime_config(&config).is_err());
    }

    #[test]
    fn rejects_parent_traversal_in_observed_roots() {
        let mut config = fixture();
        config.observed_roots = vec![PathBuf::from("../outside")];
        assert!(validate_runtime_config(&config).is_err());
    }
}
