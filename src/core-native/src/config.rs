use serde::Deserialize;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = "krypton.config.json";
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_PATH_BYTES: usize = 4096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StartupMode {
    Checkout,
    Standalone(PathBuf),
}

#[derive(Debug)]
pub struct UsageError;

impl std::fmt::Display for UsageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("invalid native startup arguments")
    }
}

impl std::error::Error for UsageError {}

/// Parses arguments without lossy Unicode conversion or filesystem side effects.
pub fn parse_startup_mode(args: &[OsString]) -> Result<StartupMode, UsageError> {
    match args {
        [] => Ok(StartupMode::Checkout),
        [flag, path] if flag == "--standalone-config" && valid_absolute_path(Path::new(path)) => {
            Ok(StartupMode::Standalone(PathBuf::from(path)))
        }
        _ => Err(UsageError),
    }
}

#[derive(Debug)]
pub struct RuntimePaths {
    /// Canonical checkout project root retained from the single validated load.
    /// Standalone startup has no checkout root.
    pub project_root: Option<PathBuf>,
    pub protected_root: PathBuf,
    pub runtime_directory: PathBuf,
    pub telemetry_file: PathBuf,
    pub instance_lock_file: Option<PathBuf>,
    pub ignored_paths: Vec<String>,
    pub observed_roots: Vec<PathBuf>,
    pub sensitive_paths: Vec<PathBuf>,
    pub telemetry_max_events: usize,
    pub telemetry_max_bytes: u64,
    pub rate_limit_window_seconds: u64,
    pub rate_limit_max_breakouts: usize,
}

impl RuntimePaths {
    pub fn ignored_components(&self) -> HashSet<OsString> {
        self.ignored_paths.iter().map(OsString::from).collect()
    }

    /// Checkout retains its existing runtime lock; standalone also owns the
    /// persistent instance before any telemetry file is opened or modified.
    pub fn acquire_instance_lock(&self) -> io::Result<Option<fs::File>> {
        self.instance_lock_file
            .as_ref()
            .map(|path| acquire_instance_lock(path, nix::unistd::geteuid().as_raw()))
            .transpose()
    }

    fn validated(self) -> io::Result<Self> {
        if self
            .project_root
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
            || !self.protected_root.is_absolute()
            || !self.runtime_directory.is_absolute()
            || !self.telemetry_file.is_absolute()
            || self
                .instance_lock_file
                .as_ref()
                .is_some_and(|path| !path.is_absolute())
            || self
                .observed_roots
                .iter()
                .chain(&self.sensitive_paths)
                .any(|path| !path.is_absolute())
            || self.telemetry_max_events == 0
            || self.telemetry_max_bytes == 0
            || self.rate_limit_window_seconds == 0
            || self.rate_limit_max_breakouts == 0
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid resolved runtime paths",
            ));
        }
        Ok(self)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StandaloneRuntimeConfig {
    schema_version: u32,
    protected_workspace_root: PathBuf,
    runtime_directory: PathBuf,
    telemetry_path: PathBuf,
    ignored_paths: Vec<String>,
    telemetry_max_events: usize,
    telemetry_max_bytes: u64,
    rate_limit_window_seconds: u64,
    rate_limit_max_breakouts: usize,
}

fn valid_absolute_path(path: &Path) -> bool {
    let bytes = path.as_os_str().as_bytes();
    path.is_absolute()
        && bytes.len() <= MAX_PATH_BYTES
        && !bytes.contains(&0)
        && path.to_str().is_some()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn invalid_standalone_config() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "invalid standalone configuration",
    )
}

fn valid_instance_lock(metadata: &fs::Metadata, current_user: u32) -> bool {
    metadata.is_file()
        && metadata.nlink() == 1
        && metadata.uid() == current_user
        && metadata.mode() & 0o7777 == 0o600
}

/// Nonblocking ownership of the stable persistent inode protects a shared ledger
/// even when launchers choose different temporary socket directories. Never
/// unlink, replace, truncate or repair this lock, including after contention.
fn acquire_instance_lock(path: &Path, current_user: u32) -> io::Result<fs::File> {
    let parent = path.parent().ok_or_else(invalid_standalone_config)?;
    verify_private_directory(parent)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let opened = file.metadata()?;
    if !valid_instance_lock(&opened, current_user) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "invalid persistent instance lock",
        ));
    }
    file.try_lock().map_err(|error| {
        io::Error::new(
            io::Error::from(error).kind(),
            "persistent instance ownership unavailable",
        )
    })?;
    let published = fs::symlink_metadata(path)?;
    if !valid_instance_lock(&published, current_user)
        || published.dev() != opened.dev()
        || published.ino() != opened.ino()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "persistent instance lock identity changed",
        ));
    }
    Ok(file)
}

fn verify_private_directory(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.uid() != nix::unistd::geteuid().as_raw()
        || metadata.mode() & 0o077 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe private instance directory",
        ));
    }
    Ok(())
}

/// Normalizes destinations without following redirects. Missing leaf components
/// are allowed; every existing component below the instance must remain private.
fn private_destination(instance: &Path, path: &Path, is_file: bool) -> io::Result<PathBuf> {
    if !valid_absolute_path(path) || path == instance || !path.starts_with(instance) {
        return Err(invalid_standalone_config());
    }
    let relative = path
        .strip_prefix(instance)
        .map_err(|_| invalid_standalone_config())?;
    let mut resolved = instance.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        if matches!(component, Component::CurDir) {
            continue;
        }
        resolved.push(component);
        match fs::symlink_metadata(&resolved) {
            Ok(metadata) if is_file && components.peek().is_none() => {
                if !metadata.is_file()
                    || metadata.uid() != nix::unistd::geteuid().as_raw()
                    || metadata.mode() & 0o7777 != 0o600
                {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "unsafe private telemetry file",
                    ));
                }
            }
            Ok(_) => verify_private_directory(&resolved)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(resolved)
}

/// Verifies the short ephemeral runtime tree without following redirects.
/// The canonical anchor above `k` is trusted; `k`, the token home, `.krypton`
/// and `runtime` remain private current-user directories. Existing persistent
/// instance-contained runtime directories retain the same privacy checks.
fn standalone_runtime_directory(
    instance: &Path,
    path: &Path,
    current_user: u32,
) -> io::Result<PathBuf> {
    if !valid_absolute_path(path) {
        return Err(invalid_standalone_config());
    }
    let normalized: PathBuf = path.components().collect();
    let anchor = if normalized.starts_with(instance) {
        instance
    } else {
        let krypton = normalized.parent().ok_or_else(invalid_standalone_config)?;
        let token = krypton.parent().ok_or_else(invalid_standalone_config)?;
        let private_root = token.parent().ok_or_else(invalid_standalone_config)?;
        if normalized.file_name() != Some(std::ffi::OsStr::new("runtime"))
            || krypton.file_name() != Some(std::ffi::OsStr::new(".krypton"))
            || private_root.file_name() != Some(std::ffi::OsStr::new("k"))
        {
            return Err(invalid_standalone_config());
        }
        private_root
    };
    let mut current = normalized.as_path();
    loop {
        let metadata = fs::symlink_metadata(current)?;
        if !metadata.is_dir()
            || metadata.uid() != current_user
            || metadata.mode() & 0o077 != 0
            || (current == normalized && metadata.mode() & 0o7777 != 0o700)
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe private runtime directory",
            ));
        }
        if current == anchor {
            break;
        }
        current = current.parent().ok_or_else(invalid_standalone_config)?;
    }
    // A trusted temp anchor is already canonical. Reject aliases or redirects
    // above the checked private components rather than authorizing their target.
    if fs::canonicalize(&normalized)? != normalized {
        return Err(invalid_standalone_config());
    }
    Ok(normalized)
}

fn load_standalone_paths(path: &Path) -> io::Result<RuntimePaths> {
    if !valid_absolute_path(path) {
        return Err(invalid_standalone_config());
    }
    let config_directory = path.parent().ok_or_else(invalid_standalone_config)?;
    let instance = config_directory
        .parent()
        .ok_or_else(invalid_standalone_config)?;
    // The config is published beneath <instance>/config. Resolve only the
    // launcher-owned instance anchor; reject redirected descendants explicitly.
    let instance = fs::canonicalize(instance)?;
    verify_private_directory(&instance)?;
    let normalized_config = private_destination(&instance, path, true)?;
    verify_private_directory(config_directory)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(&normalized_config)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != nix::unistd::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.len() > MAX_CONFIG_BYTES
    {
        return Err(invalid_standalone_config());
    }
    let mut contents = String::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_string(&mut contents)?;
    if contents.len() as u64 > MAX_CONFIG_BYTES {
        return Err(invalid_standalone_config());
    }
    let config: StandaloneRuntimeConfig =
        serde_json::from_str(&contents).map_err(|_| invalid_standalone_config())?;
    if config.schema_version != 1
        || !valid_absolute_path(&config.protected_workspace_root)
        || config.telemetry_max_events != 10000
        || config.telemetry_max_bytes != 8388608
        || config.rate_limit_window_seconds != 10
        || config.rate_limit_max_breakouts != 3
        || !valid_standalone_ignored_paths(&config.ignored_paths)
    {
        return Err(invalid_standalone_config());
    }
    let protected_root = fs::canonicalize(&config.protected_workspace_root)?;
    if !protected_root.is_dir() || instance.starts_with(&protected_root) {
        return Err(invalid_standalone_config());
    }
    let runtime_directory = standalone_runtime_directory(
        &instance,
        &config.runtime_directory,
        nix::unistd::geteuid().as_raw(),
    )?;
    let telemetry_file = private_destination(&instance, &config.telemetry_path, true)?;
    let instance_lock_file =
        private_destination(&instance, &instance.join(".krypton/instance.lock"), true)?;
    if runtime_directory.starts_with(&protected_root)
        || telemetry_file.starts_with(&protected_root)
        || normalized_config.starts_with(&runtime_directory)
        || telemetry_file.starts_with(&runtime_directory)
        || instance_lock_file.starts_with(&runtime_directory)
        || telemetry_file == instance_lock_file
        || normalized_config == instance_lock_file
    {
        return Err(invalid_standalone_config());
    }
    RuntimePaths {
        project_root: None,
        protected_root,
        runtime_directory,
        telemetry_file,
        instance_lock_file: Some(instance_lock_file),
        ignored_paths: config.ignored_paths,
        observed_roots: vec![],
        sensitive_paths: vec![],
        telemetry_max_events: config.telemetry_max_events,
        telemetry_max_bytes: config.telemetry_max_bytes,
        rate_limit_window_seconds: config.rate_limit_window_seconds,
        rate_limit_max_breakouts: config.rate_limit_max_breakouts,
    }
    .validated()
}

/// Each startup mode validates its own configuration before any watcher,
/// telemetry worker or IPC listener starts. Checkout paths preserve their
/// project-relative interpretation; standalone paths never discover a checkout.
pub fn load_runtime_paths(mode: &StartupMode, current_dir: &Path) -> io::Result<RuntimePaths> {
    if let StartupMode::Standalone(path) = mode {
        return load_standalone_paths(path);
    }
    let repository_root = resolve_repository_root(current_dir)?;
    let config = load_runtime_config(&repository_root)?;
    let project_root = fs::canonicalize(repository_root.join(&config.project_root))?;
    let configured_protected_root = config.protected_root(&repository_root);
    fs::create_dir_all(&configured_protected_root)?;
    let protected_root = fs::canonicalize(configured_protected_root)?;
    if !protected_root.is_dir() || protected_root == project_root {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "protected workspace must be narrower than project root",
        ));
    }
    let observed_roots = config
        .observed_roots
        .iter()
        .map(|root| fs::canonicalize(project_root.join(root)))
        .collect::<io::Result<Vec<_>>>()?;
    let sensitive_paths = config
        .sensitive_paths
        .iter()
        .map(|path| project_root.join(path))
        .collect();
    RuntimePaths {
        project_root: Some(project_root),
        protected_root,
        runtime_directory: config.runtime_root(&repository_root),
        telemetry_file: config.telemetry_file(&repository_root),
        instance_lock_file: None,
        ignored_paths: config.ignored_paths,
        observed_roots,
        sensitive_paths,
        telemetry_max_events: config.telemetry_max_events,
        telemetry_max_bytes: config.telemetry_max_bytes,
        rate_limit_window_seconds: config.rate_limit_window_seconds,
        rate_limit_max_breakouts: config.rate_limit_max_breakouts,
    }
    .validated()
}

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

/// Standalone watcher suppression is fixed policy, not caller configuration.
fn valid_standalone_ignored_paths(paths: &[String]) -> bool {
    paths.len() == 3
        && paths.iter().map(String::as_str).collect::<HashSet<_>>()
            == HashSet::from(["node_modules", ".git", ".krypton"])
}

fn valid_ignored_paths(paths: &[String]) -> bool {
    paths.iter().all(|value| {
        let mut components = Path::new(value).components();
        !value.as_bytes().contains(&0)
            && matches!(components.next(), Some(Component::Normal(_)))
            && components.next().is_none()
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

    if !valid_ignored_paths(&config.ignored_paths) {
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
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NONBLOCK)
        .open(repository_root.join(CONFIG_FILE_NAME))?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "configuration size limit exceeded or non-regular file",
        ));
    }
    let mut contents = String::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_string(&mut contents)?;
    if contents.len() as u64 > MAX_CONFIG_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "configuration size limit exceeded",
        ));
    }
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
    use super::{
        load_runtime_paths, parse_startup_mode, validate_runtime_config, RuntimeConfig, StartupMode,
    };
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    struct StandaloneFixture {
        root: PathBuf,
        instance: PathBuf,
        protected: PathBuf,
        config_path: PathBuf,
    }

    impl StandaloneFixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "krypton-standalone-config-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            let root = std::fs::canonicalize(root).unwrap();
            let instance = root.join("instance");
            let protected = root.join("protected");
            std::fs::create_dir_all(instance.join("config")).unwrap();
            std::fs::create_dir(&protected).unwrap();
            std::fs::create_dir_all(instance.join(".krypton/runtime")).unwrap();
            for directory in [
                &instance,
                &instance.join("config"),
                &instance.join(".krypton"),
                &instance.join(".krypton/runtime"),
            ] {
                std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
                    .unwrap();
            }
            let fixture = Self {
                config_path: instance.join("config/runtime.json"),
                root,
                instance,
                protected,
            };
            fixture.write(fixture.value());
            fixture
        }

        fn value(&self) -> serde_json::Value {
            serde_json::json!({
                "schemaVersion": 1,
                "protectedWorkspaceRoot": self.protected,
                "runtimeDirectory": self.instance.join(".krypton/runtime"),
                "telemetryPath": self.instance.join(".krypton/telemetry/alerts.jsonl"),
                "ignoredPaths": ["node_modules", ".git", ".krypton"],
                "telemetryMaxEvents": 10000,
                "telemetryMaxBytes": 8388608,
                "rateLimitWindowSeconds": 10,
                "rateLimitMaxBreakouts": 3
            })
        }

        fn write(&self, value: serde_json::Value) {
            std::fs::write(&self.config_path, serde_json::to_vec(&value).unwrap()).unwrap();
            std::fs::set_permissions(&self.config_path, std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }

        fn load(&self) -> std::io::Result<super::RuntimePaths> {
            load_runtime_paths(
                &StartupMode::Standalone(self.config_path.clone()),
                &self.root,
            )
        }

        fn external_runtime(&self) -> PathBuf {
            self.external_runtime_at("temporary")
        }

        fn external_runtime_at(&self, name: &str) -> PathBuf {
            let temporary = self.root.join(name);
            let runtime = temporary.join("k/fakeToken123/.krypton/runtime");
            std::fs::create_dir_all(&runtime).unwrap();
            for directory in [
                temporary.join("k"),
                temporary.join("k/fakeToken123"),
                temporary.join("k/fakeToken123/.krypton"),
                runtime.clone(),
            ] {
                std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
                    .unwrap();
            }
            let mut config = self.value();
            config["runtimeDirectory"] = serde_json::json!(runtime);
            self.write(config);
            runtime
        }

        fn cleanup(self) {
            std::fs::remove_dir_all(self.root).unwrap();
        }
    }

    #[test]
    fn startup_accepts_checkout_or_one_absolute_standalone_config() {
        assert_eq!(parse_startup_mode(&[]).unwrap(), StartupMode::Checkout);
        assert_eq!(
            parse_startup_mode(&[
                OsString::from("--standalone-config"),
                OsString::from("/private/runtime.json")
            ])
            .unwrap(),
            StartupMode::Standalone(PathBuf::from("/private/runtime.json"))
        );
    }

    #[test]
    fn startup_rejects_ambiguous_or_unsafe_arguments() {
        for args in [
            vec![OsString::from("--unknown")],
            vec![OsString::from("--standalone-config")],
            vec![OsString::from("--standalone-config"), OsString::from("")],
            vec![
                OsString::from("--standalone-config"),
                OsString::from("relative.json"),
            ],
            vec![
                OsString::from("--standalone-config"),
                OsString::from("/a"),
                OsString::from("--standalone-config"),
                OsString::from("/b"),
            ],
            vec![
                OsString::from("--standalone-config"),
                OsString::from_vec(b"/fake\0path".to_vec()),
            ],
            vec![
                OsString::from("--standalone-config"),
                OsString::from_vec(vec![b'/', 0xff]),
            ],
            vec![
                OsString::from("--standalone-config"),
                OsString::from(format!("/{}", "a".repeat(4096))),
            ],
        ] {
            assert!(
                parse_startup_mode(&args).is_err(),
                "accepted unsafe arguments"
            );
        }
        assert!(parse_startup_mode(&[
            OsString::from("--standalone-config"),
            OsString::from(format!("/{}", "a".repeat(4095)))
        ])
        .is_ok());
    }

    #[test]
    fn standalone_resolves_absolute_paths_without_checkout_markers() {
        let fixture = StandaloneFixture::new();
        let paths = fixture.load().unwrap();
        assert_eq!(paths.protected_root, fixture.protected);
        assert_eq!(
            paths.runtime_directory,
            fixture.instance.join(".krypton/runtime")
        );
        assert_eq!(
            paths.telemetry_file,
            fixture.instance.join(".krypton/telemetry/alerts.jsonl")
        );
        assert_eq!(paths.ignored_paths, ["node_modules", ".git", ".krypton"]);
        assert!(paths.observed_roots.is_empty());
        assert!(paths.sensitive_paths.is_empty());
        assert_eq!(paths.telemetry_max_events, 10000);
        assert_eq!(paths.telemetry_max_bytes, 8388608);
        assert_eq!(paths.rate_limit_window_seconds, 10);
        assert_eq!(paths.rate_limit_max_breakouts, 3);
        fixture.cleanup();
    }

    #[test]
    fn standalone_accepts_an_existing_external_private_runtime() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        let result = fixture.load();
        let telemetry = fixture.instance.join(".krypton/telemetry/alerts.jsonl");
        fixture.cleanup();
        let paths = result.unwrap();
        assert_eq!(paths.runtime_directory, runtime);
        assert_eq!(paths.telemetry_file, telemetry);
    }

    #[test]
    fn standalone_instance_lock_is_shared_across_different_runtime_roots() {
        let fixture = StandaloneFixture::new();
        fixture.external_runtime();
        let first = fixture.load().unwrap();
        let second_runtime = fixture.external_runtime_at("second-temporary");
        let second = fixture.load().unwrap();
        assert_ne!(first.runtime_directory, second_runtime);
        assert_eq!(first.telemetry_file, second.telemetry_file);
        assert_eq!(
            first.instance_lock_file,
            Some(fixture.instance.join(".krypton/instance.lock"))
        );
        assert_eq!(first.instance_lock_file, second.instance_lock_file);
        let first_guard = first.acquire_instance_lock().unwrap();
        let denied = second.acquire_instance_lock().unwrap_err();
        assert_eq!(denied.kind(), std::io::ErrorKind::WouldBlock);
        assert!(!denied
            .to_string()
            .contains(&fixture.root.to_string_lossy().into_owned()));
        assert!(!first.telemetry_file.exists());
        let metadata = std::fs::metadata(fixture.instance.join(".krypton/instance.lock")).unwrap();
        assert_eq!(metadata.mode() & 0o7777, 0o600);
        assert_eq!(metadata.nlink(), 1);
        drop(first_guard);
        let second_guard = second.acquire_instance_lock().unwrap();
        assert_eq!(
            std::fs::metadata(fixture.instance.join(".krypton/instance.lock"))
                .unwrap()
                .ino(),
            metadata.ino()
        );
        drop(second_guard);
        fixture.cleanup();
    }

    #[test]
    fn standalone_instance_ownership_outlives_the_startup_guard_while_writer_is_active() {
        let fixture = StandaloneFixture::new();
        let paths = fixture.load().unwrap();
        let guard = paths.acquire_instance_lock().unwrap().unwrap();
        let ledger = std::sync::Arc::new(
            crate::telemetry::TelemetryLedger::open_with_instance_lock(
                paths.telemetry_file.clone(),
                paths.telemetry_max_events,
                paths.telemetry_max_bytes,
                Some(guard.try_clone().unwrap()),
            )
            .unwrap(),
        );
        let (sender, worker) = crate::telemetry::start_writer(ledger).unwrap();
        drop(guard);
        assert_eq!(
            paths.acquire_instance_lock().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        drop(sender);
        worker.join().unwrap();
        let next_guard = paths.acquire_instance_lock().unwrap();
        drop(next_guard);
        fixture.cleanup();
    }

    #[test]
    fn standalone_instance_lock_rejects_unsafe_leaves_without_repair() {
        for kind in ["mode", "symlink", "hardlink", "fifo", "directory"] {
            let fixture = StandaloneFixture::new();
            let paths = fixture.load().unwrap();
            let lock_path = fixture.instance.join(".krypton/instance.lock");
            let target = fixture.instance.join("private-target");
            std::fs::write(&target, "unchanged").unwrap();
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
            match kind {
                "mode" => {
                    std::fs::write(&lock_path, "unchanged").unwrap();
                    std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o644))
                        .unwrap();
                }
                "symlink" => symlink(&target, &lock_path).unwrap(),
                "hardlink" => std::fs::hard_link(&target, &lock_path).unwrap(),
                "fifo" => nix::unistd::mkfifo(
                    &lock_path,
                    nix::sys::stat::Mode::S_IRUSR | nix::sys::stat::Mode::S_IWUSR,
                )
                .unwrap(),
                "directory" => std::fs::create_dir(&lock_path).unwrap(),
                _ => unreachable!(),
            }
            let denied = paths.acquire_instance_lock().is_err();
            assert_eq!(std::fs::read_to_string(target).unwrap(), "unchanged");
            if kind == "mode" {
                assert_eq!(
                    std::fs::metadata(&lock_path).unwrap().mode() & 0o7777,
                    0o644
                );
                assert_eq!(std::fs::read_to_string(&lock_path).unwrap(), "unchanged");
            }
            assert!(std::fs::symlink_metadata(&lock_path).is_ok());
            fixture.cleanup();
            assert!(denied, "accepted unsafe {kind} lock");
        }
    }

    #[test]
    fn standalone_instance_lock_rejects_foreign_ownership() {
        let fixture = StandaloneFixture::new();
        let lock_path = fixture.instance.join(".krypton/instance.lock");
        std::fs::write(&lock_path, "unchanged").unwrap();
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let other_user = nix::unistd::geteuid().as_raw().wrapping_add(1);
        let denied = super::acquire_instance_lock(&lock_path, other_user).is_err();
        assert_eq!(std::fs::read_to_string(lock_path).unwrap(), "unchanged");
        fixture.cleanup();
        assert!(denied);
    }

    #[test]
    fn standalone_configuration_cannot_use_the_ownership_lock_as_telemetry() {
        let fixture = StandaloneFixture::new();
        let mut config = fixture.value();
        config["telemetryPath"] =
            serde_json::json!(fixture.instance.join(".krypton/instance.lock"));
        fixture.write(config);
        let denied = fixture.load().is_err();
        fixture.cleanup();
        assert!(denied);
    }

    #[test]
    fn standalone_rejects_group_or_world_access_on_each_runtime_component() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        for component in runtime.ancestors().take(4) {
            for mode in [0o710, 0o701] {
                std::fs::set_permissions(component, std::fs::Permissions::from_mode(mode)).unwrap();
                assert!(
                    fixture.load().is_err(),
                    "accepted a public runtime component"
                );
            }
            std::fs::set_permissions(component, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        fixture.cleanup();
    }

    #[test]
    fn standalone_rejects_a_symlink_at_each_runtime_component() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        for component in runtime.ancestors().take(4) {
            let moved = component.with_extension("moved");
            std::fs::rename(component, &moved).unwrap();
            symlink(&moved, component).unwrap();
            let denied = fixture.load().is_err();
            std::fs::remove_file(component).unwrap();
            std::fs::rename(&moved, component).unwrap();
            assert!(denied, "accepted a redirected runtime component");
        }
        fixture.cleanup();
    }

    #[test]
    fn standalone_rejects_external_runtime_inside_the_protected_root() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        let mut config = fixture.value();
        config["runtimeDirectory"] = serde_json::json!(runtime);
        config["protectedWorkspaceRoot"] = serde_json::json!(fixture.root.join("temporary"));
        fixture.write(config);
        let denied = fixture.load().is_err();
        fixture.cleanup();
        assert!(denied);
    }

    #[test]
    fn standalone_rejects_runtime_owned_by_a_different_user() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        let other_user = nix::unistd::geteuid().as_raw().wrapping_add(1);
        let denied =
            super::standalone_runtime_directory(&fixture.instance, &runtime, other_user).is_err();
        fixture.cleanup();
        assert!(denied);
    }

    #[test]
    fn standalone_keeps_telemetry_in_the_persistent_instance() {
        let fixture = StandaloneFixture::new();
        let runtime = fixture.external_runtime();
        let mut config = fixture.value();
        config["runtimeDirectory"] = serde_json::json!(runtime);
        config["telemetryPath"] = serde_json::json!(runtime.join("alerts.jsonl"));
        fixture.write(config);
        let denied = fixture.load().is_err();
        fixture.cleanup();
        assert!(denied);
    }

    #[test]
    fn standalone_requires_an_existing_runtime_and_no_config_or_telemetry_overlap() {
        let fixture = StandaloneFixture::new();
        for runtime in [
            fixture.instance.join(".krypton/missing"),
            fixture.instance.join("config"),
            fixture.instance.join(".krypton"),
        ] {
            let mut config = fixture.value();
            config["runtimeDirectory"] = serde_json::json!(runtime);
            fixture.write(config);
            assert!(
                fixture.load().is_err(),
                "accepted a missing or overlapping runtime"
            );
        }
        fixture.cleanup();
    }

    fn assert_standalone_ignored_paths_rejected(paths: &[&str]) {
        let fixture = StandaloneFixture::new();
        let mut config = fixture.value();
        config["ignoredPaths"] = serde_json::json!(paths);
        fixture.write(config);
        let rejected = fixture.load().is_err();
        fixture.cleanup();
        assert!(rejected, "accepted a non-policy standalone ignore list");
    }

    #[test]
    fn standalone_rejects_missing_required_ignored_paths() {
        assert_standalone_ignored_paths_rejected(&["node_modules", ".git"]);
    }

    #[test]
    fn standalone_rejects_extra_ignored_paths() {
        assert_standalone_ignored_paths_rejected(&["node_modules", ".git", ".krypton", "other"]);
    }

    #[test]
    fn standalone_rejects_duplicate_ignored_paths() {
        assert_standalone_ignored_paths_rejected(&["node_modules", ".git", ".git"]);
        assert_standalone_ignored_paths_rejected(&["node_modules", ".git", ".krypton", ".git"]);
    }

    #[test]
    fn standalone_rejects_empty_ignored_paths() {
        assert_standalone_ignored_paths_rejected(&[]);
        assert_standalone_ignored_paths_rejected(&["node_modules", ".git", ""]);
    }

    #[test]
    fn standalone_accepts_the_required_ignore_set_in_any_order() {
        let fixture = StandaloneFixture::new();
        let mut config = fixture.value();
        config["ignoredPaths"] = serde_json::json!([".krypton", "node_modules", ".git"]);
        fixture.write(config);
        let paths = fixture.load().unwrap();
        fixture.cleanup();
        assert_eq!(paths.ignored_paths, [".krypton", "node_modules", ".git"]);
    }

    #[test]
    fn checkout_ignored_paths_remain_configurable() {
        let mut config = fixture();
        config.ignored_paths = vec![];
        assert!(validate_runtime_config(&config).is_ok());
        config.ignored_paths = vec!["custom".to_owned(), "custom".to_owned()];
        assert!(validate_runtime_config(&config).is_ok());
    }

    #[test]
    fn standalone_rejects_invalid_schema_paths_and_bounds() {
        let fixture = StandaloneFixture::new();
        for (field, invalid) in [
            ("schemaVersion", serde_json::json!(2)),
            ("protectedWorkspaceRoot", serde_json::json!("relative")),
            ("runtimeDirectory", serde_json::json!("relative")),
            ("telemetryPath", serde_json::json!("relative")),
            (
                "runtimeDirectory",
                serde_json::json!(fixture.instance.join(".krypton/../escape")),
            ),
            (
                "runtimeDirectory",
                serde_json::json!(fixture.root.join("outside")),
            ),
            (
                "telemetryPath",
                serde_json::json!(fixture.root.join("outside.jsonl")),
            ),
            (
                "runtimeDirectory",
                serde_json::json!(fixture.protected.join("runtime")),
            ),
            (
                "telemetryPath",
                serde_json::json!(fixture.protected.join("alerts.jsonl")),
            ),
            ("telemetryMaxEvents", serde_json::json!(0)),
            ("telemetryMaxEvents", serde_json::json!(10001)),
            ("telemetryMaxBytes", serde_json::json!(8388609)),
            ("rateLimitWindowSeconds", serde_json::json!(0)),
            ("rateLimitWindowSeconds", serde_json::json!(5)),
            ("rateLimitMaxBreakouts", serde_json::json!(0)),
            ("ignoredPaths", serde_json::json!(["../escape"])),
            ("ignoredPaths", serde_json::json!(["/"])),
            ("telemetryMaxBytes", serde_json::json!(0)),
            (
                "protectedWorkspaceRoot",
                serde_json::json!(fixture.instance),
            ),
            (
                "protectedWorkspaceRoot",
                serde_json::json!(fixture.root.join("missing")),
            ),
            ("schemaVersion", serde_json::json!(0)),
            ("unknownField", serde_json::json!(true)),
        ] {
            let mut value = fixture.value();
            value[field] = invalid;
            fixture.write(value);
            assert!(fixture.load().is_err(), "accepted invalid {field}");
        }
        fixture.cleanup();
    }

    #[test]
    fn standalone_rejects_unsafe_config_and_destination_filesystem_state() {
        let fixture = StandaloneFixture::new();
        std::fs::set_permissions(&fixture.config_path, std::fs::Permissions::from_mode(0o644))
            .unwrap();
        assert!(fixture.load().is_err());
        fixture.write(fixture.value());
        let original = fixture.instance.join("config/original.json");
        std::fs::rename(&fixture.config_path, &original).unwrap();
        symlink(&original, &fixture.config_path).unwrap();
        assert!(fixture.load().is_err());
        std::fs::remove_file(&fixture.config_path).unwrap();
        fixture.write(fixture.value());
        std::fs::remove_dir_all(fixture.instance.join(".krypton")).unwrap();
        symlink(&fixture.protected, fixture.instance.join(".krypton")).unwrap();
        assert!(fixture.load().is_err());
        std::fs::remove_file(fixture.instance.join(".krypton")).unwrap();
        std::fs::set_permissions(&fixture.instance, std::fs::Permissions::from_mode(0o755))
            .unwrap();
        assert!(fixture.load().is_err());
        fixture.cleanup();
    }

    #[test]
    fn standalone_rejects_nonregular_and_malformed_configuration() {
        let fixture = StandaloneFixture::new();
        std::fs::remove_file(&fixture.config_path).unwrap();
        nix::unistd::mkfifo(
            &fixture.config_path,
            nix::sys::stat::Mode::S_IRUSR | nix::sys::stat::Mode::S_IWUSR,
        )
        .unwrap();
        assert!(fixture.load().is_err());
        std::fs::remove_file(&fixture.config_path).unwrap();
        fixture.write(fixture.value());
        std::fs::write(&fixture.config_path, "{ fake-sensitive-value").unwrap();
        assert!(!fixture
            .load()
            .unwrap_err()
            .to_string()
            .contains("fake-sensitive-value"));
        fixture.cleanup();
    }

    #[test]
    fn standalone_rejects_oversized_json_before_parsing() {
        let fixture = StandaloneFixture::new();
        std::fs::write(&fixture.config_path, vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert!(fixture.load().is_err());
        fixture.cleanup();
    }

    #[test]
    fn checkout_paths_preserve_project_relative_observed_and_sensitive_roots() {
        let fixture = StandaloneFixture::new();
        std::fs::write(fixture.root.join("package.json"), "{}").unwrap();
        std::fs::create_dir_all(fixture.root.join("src/core-native")).unwrap();
        std::fs::write(fixture.root.join("src/core-native/Cargo.toml"), "").unwrap();
        std::fs::write(fixture.root.join("krypton.config.json"), serde_json::json!({
            "projectRoot": ".", "protectedWorkspaceRoot": "protected",
            "runtimeDirectory": ".krypton/runtime", "telemetryPath": ".krypton/telemetry/alerts.jsonl",
            "ignoredPaths": ["node_modules"], "observedRoots": ["instance"], "sensitivePaths": [".ssh"],
            "telemetryMaxEvents": 100, "telemetryMaxBytes": 4096,
            "rateLimitWindowSeconds": 5, "rateLimitMaxBreakouts": 3
        }).to_string()).unwrap();
        let paths = load_runtime_paths(&StartupMode::Checkout, &fixture.root.join("src")).unwrap();
        assert!(paths.instance_lock_file.is_none());
        assert!(paths.acquire_instance_lock().unwrap().is_none());
        assert!(!fixture.root.join(".krypton/instance.lock").exists());
        assert_eq!(
            paths.observed_roots.as_slice(),
            std::slice::from_ref(&fixture.instance)
        );
        assert_eq!(paths.sensitive_paths, [fixture.root.join(".ssh")]);
        assert_eq!(
            paths.runtime_directory,
            fixture.root.join(".krypton/runtime")
        );
        fixture.cleanup();
    }

    #[test]
    fn checkout_runtime_paths_carry_the_validated_canonical_project_root() {
        let fixture = StandaloneFixture::new();
        std::fs::write(fixture.root.join("package.json"), "{}").unwrap();
        std::fs::create_dir_all(fixture.root.join("src/core-native")).unwrap();
        std::fs::write(fixture.root.join("src/core-native/Cargo.toml"), "").unwrap();
        std::fs::write(fixture.root.join(super::CONFIG_FILE_NAME), serde_json::json!({
            "projectRoot": ".", "protectedWorkspaceRoot": "protected",
            "runtimeDirectory": ".krypton/runtime", "telemetryPath": ".krypton/telemetry/alerts.jsonl",
            "ignoredPaths": ["node_modules"], "observedRoots": [], "sensitivePaths": [],
            "telemetryMaxEvents": 100, "telemetryMaxBytes": 4096,
            "rateLimitWindowSeconds": 5, "rateLimitMaxBreakouts": 3
        }).to_string()).unwrap();
        let expected = std::fs::canonicalize(&fixture.root).unwrap();
        let paths =
            super::load_runtime_paths(&super::StartupMode::Checkout, &fixture.root.join("src"))
                .unwrap();
        assert_eq!(paths.project_root.as_deref(), Some(expected.as_path()));
        std::fs::remove_file(fixture.root.join(super::CONFIG_FILE_NAME)).unwrap();
        assert_eq!(paths.project_root.as_deref(), Some(expected.as_path()));
        fixture.cleanup();
    }

    #[test]
    fn oversized_config_is_rejected_before_json_parsing() {
        let root =
            std::env::temp_dir().join(format!("krypton-large-config-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(
            root.join(super::CONFIG_FILE_NAME),
            vec![b' '; 1024 * 1024 + 1],
        )
        .unwrap();
        let result = super::load_runtime_config(&root);
        std::fs::remove_dir_all(root).unwrap();
        assert!(result.unwrap_err().to_string().contains("size limit"));
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
