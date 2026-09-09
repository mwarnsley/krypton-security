use crate::path_policy::resolve_path;
use crate::telemetry::{PersistedSecurityEvent, TelemetryAttribution};
use chrono::{SecondsFormat, Utc};
use nix::fcntl::{openat, renameat, AtFlags, OFlag};
use nix::sys::stat::{fstatat, Mode, SFlag};
use nix::unistd::{unlinkat, UnlinkatFlags};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::SyncSender;

const MAX_CONTENT: usize = 2048;
const MAX_PATH: usize = 1024;

/// Distinguishes denied staging from a published replacement whose durability
/// could not be confirmed. Neither outcome is represented as successful IO.
#[derive(Debug)]
enum WriteFailure {
    DurabilityUnknown(io::Error),
    CleanupFailed {
        operation: io::Error,
        cleanup: io::Error,
    },
}

impl std::fmt::Display for WriteFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DurabilityUnknown(error) => write!(
                formatter,
                "MCP replacement published; durability unknown: {error}"
            ),
            Self::CleanupFailed { operation, cleanup } => write!(
                formatter,
                "MCP staging failed: {operation}; cleanup failed: {cleanup}"
            ),
        }
    }
}
impl std::error::Error for WriteFailure {}

fn access_error_code(error: &io::Error) -> &'static str {
    match error
        .get_ref()
        .and_then(|error| error.downcast_ref::<WriteFailure>())
    {
        Some(WriteFailure::DurabilityUnknown(_)) => "write_durability_unknown",
        Some(WriteFailure::CleanupFailed { .. }) => "staging_cleanup_failed",
        None => "file_access_denied",
    }
}

/// Executes the ordered publication boundary and preserves both failures if
/// pre-publication rollback fails. Cleanup never runs after successful rename.
fn publish_staged_write(
    stage: impl FnOnce() -> io::Result<()>,
    publish: impl FnOnce() -> io::Result<()>,
    sync_directory: impl FnOnce() -> io::Result<()>,
    cleanup: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    if let Err(operation) = stage().and_then(|()| publish()) {
        if let Err(cleanup) = cleanup() {
            return Err(io::Error::other(WriteFailure::CleanupFailed {
                operation,
                cleanup,
            }));
        }
        return Err(operation);
    }
    sync_directory().map_err(|error| io::Error::other(WriteFailure::DurabilityUnknown(error)))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpReceipt {
    pub tool: String,
    pub path: String,
    pub action: &'static str,
    pub telemetry: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}

pub struct McpOutcome {
    pub ok: bool,
    pub code: &'static str,
    pub content: Option<String>,
    pub receipt: McpReceipt,
}

/// Owns the startup-pinned workspace descriptor and a bounded telemetry sender.
/// No MCP-supplied PID is accepted or used as process-control authority.
pub struct McpBoundary {
    root: PathBuf,
    directory: File,
    sender: SyncSender<PersistedSecurityEvent>,
    next_temporary: AtomicU64,
}

impl McpBoundary {
    pub fn new(root: &Path, sender: SyncSender<PersistedSecurityEvent>) -> io::Result<Self> {
        let root = fs::canonicalize(root)?;
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_DIRECTORY | nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
            .open(&root)?;
        Ok(Self {
            root,
            directory,
            sender,
            next_temporary: AtomicU64::new(0),
        })
    }

    /// Evaluates and executes only bounded file tools. O(L + B) processing for
    /// path bytes L and content bytes B; no remote calls or caller-selected roots.
    /// Descriptor-relative no-follow traversal prevents symlink substitution;
    /// same-user host tampering and directory relocation remain outside isolation.
    fn access(
        &self,
        tool: &str,
        raw_path: &str,
        content: Option<&str>,
    ) -> io::Result<Option<String>> {
        let denied = || io::Error::new(io::ErrorKind::PermissionDenied, "MCP file access denied");
        if raw_path.is_empty()
            || raw_path.len() > MAX_PATH
            || raw_path.chars().any(char::is_control)
            || !matches!(tool, "krypton_read_file" | "krypton_write_file")
            || (tool == "krypton_write_file" && content.is_none())
            || (tool == "krypton_read_file" && content.is_some())
            || content.is_some_and(|value| value.len() > MAX_CONTENT)
        {
            return Err(denied());
        }
        let normalized = raw_path.replace('\\', "/");
        let target = self.root.join(&normalized);
        let relative = target.strip_prefix(&self.root).map_err(|_| denied())?;
        let names: Vec<_> = relative
            .components()
            .filter(|part| *part != Component::CurDir)
            .collect();
        if names.is_empty()
            || names
                .iter()
                .any(|part| !matches!(part, Component::Normal(_)))
            || names.last().is_some_and(|part| {
                part.as_os_str()
                    .to_string_lossy()
                    .to_lowercase()
                    .starts_with(".krypton-mcp-")
            })
        {
            return Err(denied());
        }
        if !resolve_path(&self.root, &target)?.within_protected_root {
            return Err(denied());
        }
        let current_root = fs::metadata(&self.root)?;
        let pinned_root = self.directory.metadata()?;
        if current_root.dev() != pinned_root.dev() || current_root.ino() != pinned_root.ino() {
            return Err(denied());
        }
        let mut directory = self.directory.try_clone()?;
        let (last, parents) = names.split_last().ok_or_else(denied)?;
        for name in parents {
            directory = File::from(openat(
                &directory,
                Path::new(name.as_os_str()),
                OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC,
                Mode::empty(),
            )?);
        }
        let name = Path::new(last.as_os_str());
        if tool == "krypton_read_file" {
            let file = File::from(openat(
                &directory,
                name,
                OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_NONBLOCK | OFlag::O_CLOEXEC,
                Mode::empty(),
            )?);
            let metadata = file.metadata()?;
            if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > MAX_CONTENT as u64 {
                return Err(denied());
            }
            let mut bytes = Vec::with_capacity(MAX_CONTENT + 1);
            file.take((MAX_CONTENT + 1) as u64)
                .read_to_end(&mut bytes)?;
            if bytes.len() > MAX_CONTENT {
                return Err(denied());
            }
            return String::from_utf8(bytes).map(Some).map_err(|_| denied());
        }
        match fstatat(&directory, name, AtFlags::AT_SYMLINK_NOFOLLOW) {
            Ok(stat)
                if SFlag::from_bits_truncate(stat.st_mode) == SFlag::S_IFREG
                    && stat.st_nlink == 1 => {}
            Err(nix::errno::Errno::ENOENT) => {}
            _ => return Err(denied()),
        }
        // At most two candidates: a destination can equal only one counter value.
        let temporary = loop {
            let candidate = format!(
                ".krypton-mcp-{}-{}.tmp",
                std::process::id(),
                self.next_temporary.fetch_add(1, Ordering::Relaxed)
            );
            if Path::new(&candidate) != name {
                break candidate;
            }
        };
        let mut file = File::from(openat(
            &directory,
            temporary.as_str(),
            OFlag::O_WRONLY | OFlag::O_CREAT | OFlag::O_EXCL | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC,
            Mode::S_IRUSR | Mode::S_IWUSR,
        )?);
        publish_staged_write(
            || {
                file.write_all(content.ok_or_else(denied)?.as_bytes())?;
                file.sync_all()
            },
            || renameat(&directory, temporary.as_str(), &directory, name).map_err(io::Error::from),
            || directory.sync_all(),
            || match unlinkat(&directory, temporary.as_str(), UnlinkatFlags::NoRemoveDir) {
                Ok(()) | Err(nix::errno::Errno::ENOENT) => Ok(()),
                Err(error) => Err(error.into()),
            },
        )?;
        Ok(None)
    }

    /// Returns native evidence and queues denials without blocking on persistence.
    /// The receipt's queued status is not a durable-write acknowledgment.
    pub fn execute(
        &self,
        request_id: &str,
        tool: &str,
        path: &str,
        content: Option<&str>,
        healthy: bool,
    ) -> McpOutcome {
        let result = if healthy {
            self.access(tool, path, content)
        } else {
            Err(io::Error::other("native telemetry unavailable"))
        };
        let ok = result.is_ok();
        let mut receipt = McpReceipt {
            tool: tool.to_owned(),
            path: path.to_owned(),
            action: if ok { "allowed" } else { "denied" },
            telemetry: "not_required",
            id: None,
            captured_at: None,
        };
        if !ok {
            let id = format!("native-mcp-{request_id}");
            let captured_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
            let details = Map::from_iter([
                ("tool".to_owned(), Value::String(tool.to_owned())),
                ("action".to_owned(), Value::String("denied".to_owned())),
            ]);
            let event = PersistedSecurityEvent {
                sequence: 0, // Assigned in the single writer, after concurrent queue admission.
                id: id.clone(),
                captured_at: captured_at.clone(),
                severity: "high".to_owned(),
                category: "mcp_boundary".to_owned(),
                path: Some(PathBuf::from(path)),
                process: None,
                attribution: TelemetryAttribution::Unattributed,
                source: "native".to_owned(),
                details,
            };
            receipt.telemetry = if self.sender.try_send(event).is_ok() {
                "queued"
            } else {
                "unavailable"
            };
            receipt.id = Some(id);
            receipt.captured_at = Some(captured_at);
        }
        McpOutcome {
            ok,
            code: if ok {
                if tool == "krypton_read_file" {
                    "file_read"
                } else {
                    "file_written"
                }
            } else if healthy {
                result
                    .as_ref()
                    .err()
                    .map_or("file_access_denied", access_error_code)
            } else {
                "telemetry_unavailable"
            },
            content: result.ok().flatten(),
            receipt,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::sync_channel;

    struct Fixture {
        root: std::path::PathBuf,
        boundary: McpBoundary,
    }
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "krypton-mcp-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            fs::create_dir(root.join("workspace")).unwrap();
            let (sender, _) = sync_channel(2);
            let boundary = McpBoundary::new(&root.join("workspace"), sender).unwrap();
            Self { root, boundary }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn post_publication_sync_failure_reports_uncertain_durability_without_cleanup() {
        let cleanup_called = std::cell::Cell::new(false);
        let result = publish_staged_write(
            || Ok(()),
            || Ok(()),
            || Err(io::Error::other("injected directory sync failure")),
            || {
                cleanup_called.set(true);
                Ok(())
            },
        );
        assert_eq!(
            access_error_code(&result.unwrap_err()),
            "write_durability_unknown"
        );
        assert!(!cleanup_called.get());
    }

    #[test]
    fn staging_cleanup_failure_reports_both_errors() {
        let result = publish_staged_write(
            || Err(io::Error::other("injected staging failure")),
            || panic!("must not publish"),
            || panic!("must not sync directory"),
            || Err(io::Error::other("injected cleanup failure")),
        );
        let error = result.unwrap_err();
        assert_eq!(access_error_code(&error), "staging_cleanup_failed");
        assert!(error.to_string().contains("injected staging failure"));
        assert!(error.to_string().contains("injected cleanup failure"));
    }

    #[test]
    fn reads_and_atomically_replaces_a_protected_file() {
        let fixture = Fixture::new();
        fixture
            .boundary
            .access("krypton_write_file", "note.txt", Some("hello"))
            .unwrap();
        assert_eq!(
            fixture
                .boundary
                .access("krypton_read_file", "note.txt", None)
                .unwrap(),
            Some("hello".to_owned())
        );
        fixture
            .boundary
            .access("krypton_write_file", "note.txt", Some("new"))
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.root.join("workspace/note.txt")).unwrap(),
            "new"
        );
    }

    #[test]
    fn reserves_internal_temporary_names_from_mcp_reads_and_writes() {
        let fixture = Fixture::new();
        for name in [
            format!(".krypton-mcp-{}-0.tmp", std::process::id()),
            ".KRYPTON-MCP-active.tmp".to_owned(),
        ] {
            let target = fixture.root.join("workspace").join(&name);
            fs::write(&target, "another request's temporary").unwrap();
            assert!(fixture
                .boundary
                .access("krypton_read_file", &name, None)
                .is_err());
            assert!(fixture
                .boundary
                .access("krypton_write_file", &name, Some("overwrite"))
                .is_err());
            assert_eq!(
                fs::read_to_string(target).unwrap(),
                "another request's temporary"
            );
        }
    }

    #[test]
    fn denies_traversal_absolute_escapes_and_missing_parents() {
        let fixture = Fixture::new();
        for target in [
            "../outside",
            "nested/../../outside",
            "..\\outside",
            "/etc/passwd",
            "missing/file",
            "",
            ".",
        ] {
            assert!(
                fixture
                    .boundary
                    .access("krypton_write_file", target, Some("blocked"))
                    .is_err(),
                "{target}"
            );
        }
        assert!(!fixture.root.join("outside").exists());
    }

    #[test]
    fn denies_symlinks_hardlinks_directories_and_fifos() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let workspace = fixture.root.join("workspace");
        let outside = fixture.root.join("outside");
        fs::write(&outside, "untouched").unwrap();
        symlink(&outside, workspace.join("link")).unwrap();
        symlink(&fixture.root, workspace.join("escape")).unwrap();
        fs::hard_link(&outside, workspace.join("hard")).unwrap();
        fs::create_dir(workspace.join("dir")).unwrap();
        nix::unistd::mkfifo(&workspace.join("fifo"), nix::sys::stat::Mode::S_IRUSR).unwrap();
        for target in ["link", "escape/outside", "hard", "dir", "fifo"] {
            assert!(fixture
                .boundary
                .access("krypton_read_file", target, None)
                .is_err());
            assert!(fixture
                .boundary
                .access("krypton_write_file", target, Some("blocked"))
                .is_err());
        }
        assert_eq!(fs::read_to_string(outside).unwrap(), "untouched");
    }

    #[test]
    fn bounds_content_and_rejects_non_utf8_reads() {
        let fixture = Fixture::new();
        for size in [2047, 2048, 2049] {
            let content = "a".repeat(size);
            assert_eq!(
                fixture
                    .boundary
                    .access("krypton_write_file", "sized", Some(&content))
                    .is_ok(),
                size <= 2048
            );
            fs::write(fixture.root.join("workspace/sized"), &content).unwrap();
            assert_eq!(
                fixture
                    .boundary
                    .access("krypton_read_file", "sized", None)
                    .is_ok(),
                size <= 2048
            );
        }
        fs::write(fixture.root.join("workspace/binary"), [0xff]).unwrap();
        assert!(fixture
            .boundary
            .access("krypton_read_file", "binary", None)
            .is_err());
    }

    #[test]
    fn queues_native_denial_evidence_without_inventing_a_process() {
        let fixture = Fixture::new();
        let (sender, receiver) = sync_channel(1);
        let boundary = McpBoundary::new(&fixture.root.join("workspace"), sender).unwrap();
        let outcome = boundary.execute("test", "krypton_read_file", "../outside", None, true);
        assert!(!outcome.ok);
        assert_eq!(outcome.receipt.telemetry, "queued");
        let event = receiver.try_recv().unwrap();
        assert!(event.process.is_none());
        assert_eq!(event.details["tool"], "krypton_read_file");
        assert_eq!(event.details["action"], "denied");
    }

    #[test]
    fn full_telemetry_queue_reports_unavailable() {
        let fixture = Fixture::new();
        let (sender, _receiver) = sync_channel(1);
        let boundary = McpBoundary::new(&fixture.root.join("workspace"), sender).unwrap();
        boundary.execute("first", "krypton_read_file", "../outside", None, true);
        let outcome = boundary.execute("second", "krypton_read_file", "../outside", None, true);
        assert_eq!(outcome.receipt.telemetry, "unavailable");
        assert!(!outcome.ok);
    }

    #[test]
    fn unhealthy_telemetry_denies_an_otherwise_valid_write() {
        let fixture = Fixture::new();
        let outcome =
            fixture
                .boundary
                .execute("test", "krypton_write_file", "note", Some("blocked"), false);
        assert_eq!(outcome.code, "telemetry_unavailable");
        assert!(!fixture.root.join("workspace/note").exists());
    }

    #[test]
    fn reads_nested_and_absolute_contained_paths() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.root.join("workspace/nested")).unwrap();
        fs::write(fixture.root.join("workspace/nested/note"), "ok").unwrap();
        let absolute = fs::canonicalize(fixture.root.join("workspace/nested/note")).unwrap();
        for target in ["nested/note", absolute.to_str().unwrap()] {
            assert_eq!(
                fixture
                    .boundary
                    .access("krypton_read_file", target, None)
                    .unwrap(),
                Some("ok".to_owned())
            );
        }
    }
}
