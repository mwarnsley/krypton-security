use crate::process_identity::ProcessIdentity;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

pub const ALERT_QUEUE_CAPACITY: usize = 1_024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryAttribution {
    Process,
    Unattributed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentitySummary {
    pub pid: u32,
    pub start_time: u64,
    pub executable_path: PathBuf,
    pub parent_pid: Option<u32>,
}

impl From<&ProcessIdentity> for ProcessIdentitySummary {
    fn from(value: &ProcessIdentity) -> Self {
        Self {
            pid: value.pid,
            start_time: value.start_time,
            executable_path: value.executable_path.clone(),
            parent_pid: value.parent_pid,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSecurityEvent {
    pub sequence: u64,
    pub id: String,
    pub captured_at: String,
    pub severity: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<ProcessIdentitySummary>,
    pub attribution: TelemetryAttribution,
    pub source: String,
    pub details: Map<String, Value>,
}

impl PersistedSecurityEvent {
    pub fn unattributed_filesystem(sequence: u64, path: &Path, target_existed: bool) -> Self {
        let mut details = Map::new();
        details.insert("targetExisted".to_owned(), Value::Bool(target_existed));
        Self {
            sequence,
            id: format!("native-unattributed-{sequence}"),
            captured_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            severity: "high".to_owned(),
            category: "workspace_boundary".to_owned(),
            path: Some(path.to_path_buf()),
            process: None,
            attribution: TelemetryAttribution::Unattributed,
            source: "native".to_owned(),
            details,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerHealth {
    Ready,
    WriteFailed,
}

#[derive(Debug)]
pub struct TelemetryLedger {
    path: PathBuf,
    max_events: usize,
    max_bytes: u64,
    next_sequence: AtomicU64,
    event_count: AtomicUsize,
    last_sequence: Mutex<u64>,
    health: Arc<RwLock<LedgerHealth>>,
}

impl TelemetryLedger {
    pub fn open(path: PathBuf, max_events: usize, max_bytes: u64) -> Result<Self, io::Error> {
        if let Some(parent) = path.parent() {
            let parent_existed = parent.exists();
            fs::create_dir_all(parent)?;
            #[cfg(unix)]
            if !parent_existed {
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
            }
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        drop(options.open(&path)?);
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        let (events, repair) = scan_events(&path)?;
        if let Some((offset, newline)) = repair {
            let mut file = OpenOptions::new().write(true).open(&path)?;
            file.set_len(offset)?;
            if newline {
                use std::io::{Seek, SeekFrom};
                file.seek(SeekFrom::End(0))?;
                file.write_all(b"\n")?;
            }
            file.sync_all()?;
        }
        let last_sequence = events.last().map_or(0, |event| event.sequence);
        let next_sequence = last_sequence
            .checked_add(1)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "sequence exhausted"))?;
        Ok(Self {
            path,
            max_events,
            max_bytes,
            next_sequence: AtomicU64::new(next_sequence),
            event_count: AtomicUsize::new(events.len()),
            last_sequence: Mutex::new(last_sequence),
            health: Arc::new(RwLock::new(LedgerHealth::Ready)),
        })
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                Some(value.saturating_add(1))
            })
            .unwrap_or(u64::MAX)
    }

    pub fn health(&self) -> Arc<RwLock<LedgerHealth>> {
        Arc::clone(&self.health)
    }

    pub fn append(&self, event: &PersistedSecurityEvent) -> Result<(), io::Error> {
        let mut last = self
            .last_sequence
            .lock()
            .map_err(|_| io::Error::other("ledger lock poisoned"))?;
        if event.sequence <= *last || event.sequence == u64::MAX {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "non-monotonic or exhausted sequence",
            ));
        }
        let mut line = serde_json::to_vec(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        line.push(b'\n');
        let mut file = OpenOptions::new().append(true).open(&self.path)?;
        file.write_all(&line)?;
        file.sync_data()?;
        *last = event.sequence;
        self.next_sequence
            .fetch_max(event.sequence + 1, Ordering::Relaxed);
        let count = self.event_count.fetch_add(1, Ordering::Relaxed) + 1;
        let bytes = file.metadata()?.len();
        if count > self.max_events || bytes > self.max_bytes {
            self.compact()?;
        }
        Ok(())
    }

    fn compact(&self) -> Result<(), io::Error> {
        let mut events = read_events(&self.path)?;
        if events.len() > self.max_events {
            events.drain(..events.len() - self.max_events);
        }
        while serialized_size(&events)? > self.max_bytes && events.len() > 1 {
            events.remove(0);
        }
        write_private_atomic(&self.path, |file| {
            for event in &events {
                serde_json::to_writer(&mut *file, event)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                file.write_all(b"\n")?;
            }
            Ok(())
        })?;
        self.event_count.store(events.len(), Ordering::Relaxed);
        Ok(())
    }
}

fn serialized_size(events: &[PersistedSecurityEvent]) -> Result<u64, io::Error> {
    events.iter().try_fold(0_u64, |size, event| {
        let bytes = serde_json::to_vec(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        Ok(size + bytes.len() as u64 + 1)
    })
}

/// Publishes a private replacement; pre-existing temporary files (including symlinks)
/// fail closed. The parent directory is durable before and after publication.
pub(crate) fn write_private_atomic(
    path: &Path,
    write: impl FnOnce(&mut fs::File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut name = path
        .file_name()
        .ok_or_else(|| io::Error::other("missing filename"))?
        .to_os_string();
    name.push(".tmp");
    let temporary = path.with_file_name(name);
    let directory = fs::File::open(parent)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temporary)?;
    let result = (|| {
        write(&mut file)?;
        file.sync_all()?;
        directory.sync_all()?;
        fs::rename(&temporary, path)?;
        directory.sync_all()
    })();
    if result.is_err() {
        // Only our exclusively created temporary file may be removed.
        let _ = fs::remove_file(&temporary);
    }
    result
}

type LedgerScan = (Vec<PersistedSecurityEvent>, Option<(u64, bool)>);

/// Scans the entire ledger before permitting repair. Only EOF-truncated JSON is
/// recoverable; complete malformed lines and non-monotonic evidence are rejected.
fn scan_events(path: &Path) -> Result<LedgerScan, io::Error> {
    let file = match OpenOptions::new().read(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok((Vec::new(), None)),
        Err(error) => return Err(error),
    };
    let mut events = Vec::new();
    let mut reader = BufReader::new(file);
    let mut offset = 0_u64;
    let mut last = 0;
    loop {
        let mut line = Vec::new();
        let count = reader.read_until(b'\n', &mut line)?;
        if count == 0 {
            return Ok((events, None));
        }
        let terminated = line.last() == Some(&b'\n');
        match serde_json::from_slice::<PersistedSecurityEvent>(&line) {
            Ok(event) => {
                if event.sequence <= last || event.sequence == u64::MAX {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "non-monotonic or exhausted sequence",
                    ));
                }
                last = event.sequence;
                events.push(event);
                offset += count as u64;
                if !terminated {
                    return Ok((events, Some((offset, true))));
                }
            }
            Err(error) if !terminated && error.is_eof() => {
                return Ok((events, Some((offset, false))))
            }
            Err(error) => return Err(io::Error::new(io::ErrorKind::InvalidData, error)),
        }
    }
}

pub fn read_events(path: &Path) -> Result<Vec<PersistedSecurityEvent>, io::Error> {
    scan_events(path).map(|(events, _)| events)
}

pub fn start_writer(
    ledger: Arc<TelemetryLedger>,
) -> (SyncSender<PersistedSecurityEvent>, JoinHandle<()>) {
    let (sender, receiver) = sync_channel(ALERT_QUEUE_CAPACITY);
    let handle = thread::spawn(move || {
        for event in receiver {
            if let Err(error) = ledger.append(&event) {
                if let Ok(mut health) = ledger.health.write() {
                    *health = LedgerHealth::WriteFailed;
                }
                eprintln!("[TELEMETRY ERROR] ledger write failed: {error}");
            }
        }
    });
    (sender, handle)
}

pub fn try_enqueue(
    sender: &SyncSender<PersistedSecurityEvent>,
    event: PersistedSecurityEvent,
) -> bool {
    sender.try_send(event).is_ok()
}

#[cfg(test)]
mod tests {
    use super::{read_events, PersistedSecurityEvent, TelemetryLedger};
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn serializes_complete_process_identity() {
        let identity = crate::process_identity::ProcessIdentity {
            pid: 4242,
            start_time: 1234,
            executable_path: "/usr/bin/node".into(),
            parent_pid: Some(4000),
        };
        let value = serde_json::to_value(super::ProcessIdentitySummary::from(&identity))
            .expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({"pid":4242,"startTime":1234,"executablePath":"/usr/bin/node","parentPid":4000})
        );
    }

    #[test]
    fn serializes_unavailable_parent_as_null() {
        let identity = crate::process_identity::ProcessIdentity {
            pid: 4242,
            start_time: 1234,
            executable_path: "/usr/bin/node".into(),
            parent_pid: None,
        };
        let value = serde_json::to_value(super::ProcessIdentitySummary::from(&identity))
            .expect("serialize");
        assert_eq!(value.get("parentPid"), Some(&serde_json::Value::Null));
    }

    fn path(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("krypton-ledger-{name}-{suffix}.jsonl"))
    }

    fn event(sequence: u64) -> PersistedSecurityEvent {
        PersistedSecurityEvent::unattributed_filesystem(sequence, Path::new("/tmp/outside"), false)
    }

    #[test]
    fn retains_only_the_configured_event_count() {
        let ledger_path = path("count");
        let ledger = TelemetryLedger::open(ledger_path.clone(), 2, 100_000).expect("ledger");
        for sequence in 1..=3 {
            ledger.append(&event(sequence)).expect("append");
        }
        let events = read_events(&ledger_path).expect("read");
        fs::remove_file(&ledger_path).expect("cleanup");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].sequence, 2);
    }

    #[test]
    fn restart_repairs_partial_tail_before_append() {
        let p = path("restart");
        let ledger = TelemetryLedger::open(p.clone(), 10, 100_000).unwrap();
        ledger.append(&event(1)).unwrap();
        fs::OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"{\"sequence\":2,")
            .unwrap();
        drop(ledger);
        let restarted = TelemetryLedger::open(p.clone(), 10, 100_000).unwrap();
        restarted.append(&event(restarted.next_sequence())).unwrap();
        let sequences: Vec<_> = read_events(&p)
            .unwrap()
            .iter()
            .map(|e| e.sequence)
            .collect();
        fs::remove_file(p).unwrap();
        assert_eq!(sequences, vec![1, 2]);
    }

    #[test]
    fn complete_final_record_without_newline_is_preserved() {
        let p = path("missing-newline");
        fs::write(&p, serde_json::to_vec(&event(1)).unwrap()).unwrap();
        let ledger = TelemetryLedger::open(p.clone(), 10, 100_000).unwrap();
        ledger.append(&event(ledger.next_sequence())).unwrap();
        let sequences: Vec<_> = read_events(&p)
            .unwrap()
            .iter()
            .map(|e| e.sequence)
            .collect();
        fs::remove_file(p).unwrap();
        assert_eq!(sequences, vec![1, 2]);
    }

    #[test]
    fn rejects_duplicate_descending_and_exhausted_sequences() {
        for sequence in [0, 1, u64::MAX] {
            let p = path("bad-sequence");
            fs::write(
                &p,
                format!(
                    "{}\n{}\n",
                    serde_json::to_string(&event(1)).unwrap(),
                    serde_json::to_string(&event(sequence)).unwrap()
                ),
            )
            .unwrap();
            let result = TelemetryLedger::open(p.clone(), 10, 100_000);
            fs::remove_file(p).unwrap();
            assert!(result.is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn compaction_rejects_existing_symlink_without_touching_target() {
        let p = path("symlink");
        let target = path("symlink-target");
        let temporary =
            p.with_file_name(format!("{}.tmp", p.file_name().unwrap().to_str().unwrap()));
        fs::write(&target, b"private original").unwrap();
        std::os::unix::fs::symlink(&target, &temporary).unwrap();
        let ledger = TelemetryLedger::open(p.clone(), 1, 100_000).unwrap();
        ledger.append(&event(1)).unwrap();
        let result = ledger.append(&event(2));
        let preserved = fs::read(&target).unwrap();
        for file in [p, temporary, target] {
            fs::remove_file(file).unwrap();
        }
        assert!(result.is_err());
        assert_eq!(preserved, b"private original");
    }

    #[test]
    fn append_rejects_duplicate_sequence_without_modifying_ledger() {
        let p = path("append-duplicate");
        let ledger = TelemetryLedger::open(p.clone(), 10, 100_000).unwrap();
        ledger.append(&event(1)).unwrap();
        let before = fs::read(&p).unwrap();
        let result = ledger.append(&event(1));
        let after = fs::read(&p).unwrap();
        fs::remove_file(p).unwrap();
        assert!(result.is_err());
        assert_eq!(after, before);
    }

    #[cfg(unix)]
    #[test]
    fn temporary_file_is_private_before_publication() {
        use std::os::unix::fs::PermissionsExt;
        let p = path("private-temp");
        let mut mode = 0;
        super::write_private_atomic(&p, |file| {
            mode = file.metadata()?.permissions().mode() & 0o777;
            file.write_all(b"private")
        })
        .unwrap();
        fs::remove_file(p).unwrap();
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn failed_replacement_preserves_previous_file_and_cleans_owned_temp() {
        let p = path("write-failure");
        fs::write(&p, b"original").unwrap();
        let result = super::write_private_atomic(&p, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("injected failure"))
        });
        let bytes = fs::read(&p).unwrap();
        let temporary =
            p.with_file_name(format!("{}.tmp", p.file_name().unwrap().to_str().unwrap()));
        fs::remove_file(p).unwrap();
        assert!(result.is_err());
        assert_eq!(bytes, b"original");
        assert!(!temporary.exists());
    }

    #[test]
    fn rejects_interior_corruption_without_rewriting_evidence() {
        let p = path("interior");
        let bytes = format!(
            "{}\ninvalid\n{}\n",
            serde_json::to_string(&event(1)).unwrap(),
            serde_json::to_string(&event(3)).unwrap()
        );
        fs::write(&p, &bytes).unwrap();
        let result = TelemetryLedger::open(p.clone(), 10, 100_000);
        let preserved = fs::read_to_string(&p).unwrap();
        fs::remove_file(p).unwrap();
        assert!(result.is_err());
        assert_eq!(preserved, bytes);
    }

    #[cfg(unix)]
    #[test]
    fn compaction_preserves_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let p = path("compact-private");
        let ledger = TelemetryLedger::open(p.clone(), 1, 100_000).unwrap();
        ledger.append(&event(1)).unwrap();
        ledger.append(&event(2)).unwrap();
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        fs::remove_file(p).unwrap();
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn ignores_a_corrupt_final_jsonl_line() {
        let ledger_path = path("corrupt-final");
        let ledger = TelemetryLedger::open(ledger_path.clone(), 10, 100_000).expect("ledger");
        ledger.append(&event(1)).expect("append");
        fs::OpenOptions::new()
            .append(true)
            .open(&ledger_path)
            .expect("open")
            .write_all(b"{\"sequence\":")
            .expect("corrupt");
        let events = read_events(&ledger_path).expect("read");
        fs::remove_file(&ledger_path).expect("cleanup");
        assert_eq!(events.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn creates_the_ledger_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let ledger_path = path("permissions");
        let _ledger = TelemetryLedger::open(ledger_path.clone(), 10, 100_000).expect("ledger");
        let mode = fs::metadata(&ledger_path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        fs::remove_file(&ledger_path).expect("cleanup");
        assert_eq!(mode, 0o600);
    }
}
