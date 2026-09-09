use crate::process_identity::{ProcessIdentity, ProcessIdentityError, ProcessInspector};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

const RECEIPT_CAPACITY: usize = 1024;
const RECEIPT_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Eq, PartialEq)]
pub enum RegistryError {
    AlreadyRegistered,
    IdentityMismatch,
    Inspector(ProcessIdentityError),
    InvalidPid,
    NotRegistered,
    RegistryUnavailable,
    SignalFailed(String),
    StaleProcess,
}

/// A fixed-size insertion-order ring with average O(1) identity indexing.
/// Hashing a complete identity remains O(L) in executable-path length.
#[derive(Debug)]
struct TerminationReceipts {
    index: HashMap<ProcessIdentity, usize>,
    slots: Vec<Option<(ProcessIdentity, Instant)>>,
    next: usize,
}

impl Default for TerminationReceipts {
    fn default() -> Self {
        Self {
            index: HashMap::with_capacity(RECEIPT_CAPACITY),
            slots: vec![None; RECEIPT_CAPACITY],
            next: 0,
        }
    }
}

impl TerminationReceipts {
    fn remove(&mut self, identity: &ProcessIdentity) {
        if let Some(slot) = self.index.remove(identity) {
            self.slots[slot] = None;
        }
    }

    fn record(&mut self, identity: ProcessIdentity, now: Instant) {
        self.remove(&identity);
        if let Some((evicted, _)) = self.slots[self.next].take() {
            self.index.remove(&evicted);
        }
        self.index.insert(identity.clone(), self.next);
        self.slots[self.next] = Some((identity, now));
        self.next = (self.next + 1) % RECEIPT_CAPACITY;
    }

    fn contains(&self, identity: &ProcessIdentity, now: Instant) -> bool {
        self.index
            .get(identity)
            .and_then(|slot| self.slots[*slot].as_ref())
            .and_then(|(_, recorded)| now.checked_duration_since(*recorded))
            .is_some_and(|age| age < RECEIPT_TTL)
    }
}

#[derive(Debug, Default)]
struct RegistryState {
    processes: HashMap<u32, ProcessIdentity>,
    receipts: TerminationReceipts,
}

#[derive(Debug, Default)]
pub struct ProcessRegistry {
    state: RwLock<RegistryState>,
}

impl ProcessRegistry {
    pub fn active_count(&self) -> Result<usize, RegistryError> {
        self.state
            .try_read()
            .map(|state| state.processes.len())
            .map_err(|_| RegistryError::RegistryUnavailable)
    }

    /// Confirms only a successful native signal for this full identity within
    /// the last 60 seconds. Lock contention denies attribution immediately.
    pub fn termination_receipt(&self, supplied: &ProcessIdentity) -> Result<bool, RegistryError> {
        self.state
            .try_read()
            .map(|state| state.receipts.contains(supplied, Instant::now()))
            .map_err(|_| RegistryError::RegistryUnavailable)
    }

    pub fn register(
        &self,
        supplied: ProcessIdentity,
        inspector: &dyn ProcessInspector,
    ) -> Result<(), RegistryError> {
        if supplied.pid == 0 || supplied.pid > i32::MAX as u32 {
            return Err(RegistryError::InvalidPid);
        }
        let live = inspector
            .inspect(supplied.pid)
            .map_err(RegistryError::Inspector)?;
        if live != supplied {
            return Err(RegistryError::IdentityMismatch);
        }
        let mut state = self
            .state
            .try_write()
            .map_err(|_| RegistryError::RegistryUnavailable)?;
        if state.processes.contains_key(&supplied.pid) {
            return Err(RegistryError::AlreadyRegistered);
        }
        state.receipts.remove(&supplied);
        state.processes.insert(supplied.pid, supplied);
        Ok(())
    }

    pub fn unregister(&self, supplied: &ProcessIdentity) -> Result<(), RegistryError> {
        let mut state = self
            .state
            .try_write()
            .map_err(|_| RegistryError::RegistryUnavailable)?;
        match state.processes.get(&supplied.pid) {
            Some(registered) if registered == supplied => {
                state.processes.remove(&supplied.pid);
                Ok(())
            }
            Some(_) => Err(RegistryError::IdentityMismatch),
            None => Err(RegistryError::NotRegistered),
        }
    }

    pub fn isolate_with<F>(
        &self,
        supplied: &ProcessIdentity,
        inspector: &dyn ProcessInspector,
        signal: F,
    ) -> Result<(), RegistryError>
    where
        F: FnOnce(u32) -> Result<(), String>,
    {
        if supplied.pid == std::process::id() {
            return Err(RegistryError::InvalidPid);
        }
        // One non-blocking lock serializes identity revalidation, signal delivery,
        // receipt publication, and removal. Lookups cannot see partial success.
        let mut state = self
            .state
            .try_write()
            .map_err(|_| RegistryError::RegistryUnavailable)?;
        let registered = state
            .processes
            .get(&supplied.pid)
            .cloned()
            .ok_or(RegistryError::NotRegistered)?;
        if &registered != supplied {
            return Err(RegistryError::IdentityMismatch);
        }
        let live = match inspector.inspect(supplied.pid) {
            Ok(identity) => identity,
            Err(ProcessIdentityError::NotRunning) => {
                state.processes.remove(&registered.pid);
                return Err(RegistryError::StaleProcess);
            }
            Err(error) => return Err(RegistryError::Inspector(error)),
        };
        if live != registered {
            state.processes.remove(&registered.pid);
            return Err(RegistryError::StaleProcess);
        }
        signal(supplied.pid).map_err(RegistryError::SignalFailed)?;
        state.receipts.record(registered, Instant::now());
        state.processes.remove(&supplied.pid);
        Ok(())
    }
}

pub fn terminate_process(pid: u32) -> Result<(), String> {
    let platform_pid = i32::try_from(pid).map_err(|_| "PID exceeds platform range".to_owned())?;
    kill(Pid::from_raw(platform_pid), Signal::SIGKILL)
        .map_err(|error| format!("native SIGKILL delivery failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{ProcessRegistry, RegistryError};
    use crate::process_identity::{ProcessIdentity, ProcessIdentityError, ProcessInspector};
    use std::path::PathBuf;

    struct Inspector(Result<ProcessIdentity, ProcessIdentityError>);
    impl ProcessInspector for Inspector {
        fn inspect(&self, _pid: u32) -> Result<ProcessIdentity, ProcessIdentityError> {
            self.0.clone()
        }
    }

    fn identity(start_time: u64) -> ProcessIdentity {
        ProcessIdentity {
            pid: 4242,
            start_time,
            executable_path: PathBuf::from("/usr/bin/node"),
            parent_pid: Some(4000),
        }
    }

    #[test]
    fn receipts_require_every_identity_field() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        registry
            .register(process.clone(), &Inspector(Ok(process.clone())))
            .unwrap();
        registry
            .isolate_with(&process, &Inspector(Ok(process.clone())), |_| Ok(()))
            .unwrap();
        let mut variants = vec![
            identity(11),
            process.clone(),
            process.clone(),
            process.clone(),
        ];
        variants[1].pid += 1;
        variants[2].parent_pid = None;
        variants[3].executable_path = PathBuf::from("/usr/bin/other");
        for variant in variants {
            assert_eq!(registry.termination_receipt(&variant), Ok(false));
        }
        assert_eq!(registry.termination_receipt(&process), Ok(true));
    }

    #[test]
    fn receipt_expiration_is_exact_and_bounded() {
        let mut receipts = super::TerminationReceipts::default();
        let now = std::time::Instant::now();
        receipts.record(identity(10), now);
        assert!(receipts.contains(
            &identity(10),
            now + super::RECEIPT_TTL - std::time::Duration::from_nanos(1)
        ));
        assert!(!receipts.contains(&identity(10), now + super::RECEIPT_TTL));
        assert!(!receipts.contains(
            &identity(10),
            now + super::RECEIPT_TTL + std::time::Duration::from_nanos(1)
        ));
    }

    #[test]
    fn receipt_capacity_evicts_oldest_without_unbounded_growth() {
        let mut receipts = super::TerminationReceipts::default();
        let now = std::time::Instant::now();
        for generation in 0..=super::RECEIPT_CAPACITY {
            receipts.record(identity(generation as u64), now);
        }
        assert!(!receipts.contains(&identity(0), now));
        assert!(receipts.contains(&identity(super::RECEIPT_CAPACITY as u64), now));
        assert_eq!(receipts.index.len(), super::RECEIPT_CAPACITY);
    }

    #[test]
    fn a_new_registration_clears_an_old_receipt_for_the_same_identity() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        let inspector = Inspector(Ok(process.clone()));
        registry.register(process.clone(), &inspector).unwrap();
        registry
            .isolate_with(&process, &inspector, |_| Ok(()))
            .unwrap();
        registry.register(process.clone(), &inspector).unwrap();
        assert_eq!(registry.termination_receipt(&process), Ok(false));
    }

    #[test]
    fn receipt_lookup_during_signal_cannot_observe_uncommitted_success() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        let inspector = Inspector(Ok(process.clone()));
        registry.register(process.clone(), &inspector).unwrap();
        registry
            .isolate_with(&process, &inspector, |_| {
                assert_eq!(
                    registry.termination_receipt(&process),
                    Err(RegistryError::RegistryUnavailable)
                );
                Ok(())
            })
            .unwrap();
        assert_eq!(registry.termination_receipt(&process), Ok(true));
        assert_eq!(registry.active_count(), Ok(0));
    }

    #[test]
    fn normal_unregistration_never_creates_an_enforcement_receipt() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        registry
            .register(process.clone(), &Inspector(Ok(process.clone())))
            .unwrap();
        registry.unregister(&process).unwrap();
        assert_eq!(registry.termination_receipt(&process), Ok(false));
    }

    #[test]
    fn failed_signal_preserves_registration_without_publishing_a_receipt() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        let inspector = Inspector(Ok(process.clone()));
        registry.register(process.clone(), &inspector).unwrap();
        assert_eq!(
            registry.isolate_with(&process, &inspector, |_| Err("denied".to_owned())),
            Err(RegistryError::SignalFailed("denied".to_owned()))
        );
        assert_eq!(registry.active_count(), Ok(1));
        assert_eq!(registry.termination_receipt(&process), Ok(false));
    }

    #[test]
    fn pid_reuse_never_publishes_a_receipt() {
        let registry = ProcessRegistry::default();
        let process = identity(10);
        registry
            .register(process.clone(), &Inspector(Ok(process.clone())))
            .unwrap();
        registry
            .isolate_with(&process, &Inspector(Ok(identity(11))), |_| {
                panic!("must not signal")
            })
            .unwrap_err();
        assert_eq!(registry.termination_receipt(&process), Ok(false));
        assert_eq!(registry.termination_receipt(&identity(11)), Ok(false));
    }

    #[test]
    fn replacing_a_receipt_does_not_leave_a_stale_ring_entry() {
        let mut receipts = super::TerminationReceipts::default();
        let now = std::time::Instant::now();
        receipts.record(identity(10), now);
        receipts.record(identity(10), now);
        for generation in 100..100 + super::RECEIPT_CAPACITY - 1 {
            receipts.record(identity(generation as u64), now);
        }
        assert!(receipts.contains(&identity(10), now));
        assert_eq!(receipts.index.len(), super::RECEIPT_CAPACITY);
    }

    #[test]
    fn registers_a_matching_live_identity() {
        let registry = ProcessRegistry::default();
        let supplied = identity(10);
        assert_eq!(
            registry.register(supplied.clone(), &Inspector(Ok(supplied))),
            Ok(())
        );
        assert_eq!(registry.active_count(), Ok(1));
    }

    #[test]
    fn rejects_a_process_generation_mismatch() {
        let registry = ProcessRegistry::default();
        assert_eq!(
            registry.register(identity(10), &Inspector(Ok(identity(11)))),
            Err(RegistryError::IdentityMismatch)
        );
    }

    #[test]
    fn unregisters_only_the_exact_generation() {
        let registry = ProcessRegistry::default();
        let registered = identity(10);
        registry
            .register(registered.clone(), &Inspector(Ok(registered.clone())))
            .expect("register");
        assert_eq!(
            registry.unregister(&identity(11)),
            Err(RegistryError::IdentityMismatch)
        );
        assert_eq!(registry.active_count(), Ok(1));
    }

    #[test]
    fn refuses_isolation_after_pid_reuse() {
        let registry = ProcessRegistry::default();
        let registered = identity(10);
        registry
            .register(registered.clone(), &Inspector(Ok(registered.clone())))
            .expect("register");
        assert_eq!(
            registry.isolate_with(&registered, &Inspector(Ok(identity(11))), |_| Ok(())),
            Err(RegistryError::StaleProcess)
        );
    }

    #[test]
    fn refuses_an_unregistered_process_without_signaling() {
        let registry = ProcessRegistry::default();
        assert_eq!(
            registry.isolate_with(&identity(10), &Inspector(Ok(identity(10))), |_| {
                panic!("must not signal")
            }),
            Err(RegistryError::NotRegistered)
        );
    }

    #[test]
    fn unavailable_registry_count_is_not_zero() {
        let registry = ProcessRegistry::default();
        let _guard = registry.state.write().unwrap();
        assert_eq!(
            registry.active_count(),
            Err(RegistryError::RegistryUnavailable)
        );
    }
}
