use crate::process_identity::ProcessIdentity;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, RwLock};
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
}

impl From<&ProcessIdentity> for ProcessIdentitySummary {
    fn from(value: &ProcessIdentity) -> Self {
        Self {
            pid: value.pid,
            start_time: value.start_time,
            executable_path: value.executable_path.clone(),
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
        let events = read_events(&path)?;
        let next_sequence = events.last().map_or(1, |event| event.sequence + 1);
        Ok(Self {
            path,
            max_events,
            max_bytes,
            next_sequence: AtomicU64::new(next_sequence),
            event_count: AtomicUsize::new(events.len()),
            health: Arc::new(RwLock::new(LedgerHealth::Ready)),
        })
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence.fetch_add(1, Ordering::Relaxed)
    }

    pub fn health(&self) -> Arc<RwLock<LedgerHealth>> {
        Arc::clone(&self.health)
    }

    pub fn append(&self, event: &PersistedSecurityEvent) -> Result<(), io::Error> {
        let mut line = serde_json::to_vec(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        line.push(b'\n');
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(&line)?;
        file.sync_data()?;
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
        let temporary = self.path.with_extension("jsonl.tmp");
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)?;
        for event in &events {
            serde_json::to_writer(&mut file, event)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            file.write_all(b"\n")?;
        }
        file.sync_all()?;
        fs::rename(&temporary, &self.path)?;
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

pub fn read_events(path: &Path) -> Result<Vec<PersistedSecurityEvent>, io::Error> {
    let file = match OpenOptions::new().read(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut events = Vec::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<PersistedSecurityEvent>(&line) {
            Ok(event) => events.push(event),
            Err(_) => break,
        }
    }
    Ok(events)
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

pub fn try_enqueue(sender: &SyncSender<PersistedSecurityEvent>, event: PersistedSecurityEvent) {
    match sender.try_send(event) {
        Ok(()) => {}
        Err(TrySendError::Full(event)) => {
            eprintln!("[TELEMETRY ERROR] queue full; dropped {}", event.id)
        }
        Err(TrySendError::Disconnected(event)) => {
            eprintln!("[TELEMETRY ERROR] writer unavailable; dropped {}", event.id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{read_events, PersistedSecurityEvent, TelemetryLedger};
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

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
    fn ignores_a_corrupt_final_jsonl_line() {
        let ledger_path = path("corrupt-final");
        let ledger = TelemetryLedger::open(ledger_path.clone(), 10, 100_000).expect("ledger");
        ledger.append(&event(1)).expect("append");
        fs::OpenOptions::new()
            .append(true)
            .open(&ledger_path)
            .expect("open")
            .write_all(b"{interrupted")
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
