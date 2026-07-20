use crate::process_identity::{ProcessIdentity, ProcessIdentityError, ProcessInspector};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use std::collections::HashMap;
use std::sync::RwLock;

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

#[derive(Debug, Default)]
pub struct ProcessRegistry {
    processes: RwLock<HashMap<u32, ProcessIdentity>>,
}

impl ProcessRegistry {
    pub fn active_count(&self) -> usize {
        self.processes.read().map_or(0, |entries| entries.len())
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
        let mut processes = self
            .processes
            .write()
            .map_err(|_| RegistryError::RegistryUnavailable)?;
        if processes.contains_key(&supplied.pid) {
            return Err(RegistryError::AlreadyRegistered);
        }
        processes.insert(supplied.pid, supplied);
        Ok(())
    }

    pub fn unregister(&self, supplied: &ProcessIdentity) -> Result<(), RegistryError> {
        let mut processes = self
            .processes
            .write()
            .map_err(|_| RegistryError::RegistryUnavailable)?;
        match processes.get(&supplied.pid) {
            Some(registered) if registered == supplied => {
                processes.remove(&supplied.pid);
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
        let registered = self
            .processes
            .read()
            .map_err(|_| RegistryError::RegistryUnavailable)?
            .get(&supplied.pid)
            .cloned()
            .ok_or(RegistryError::NotRegistered)?;
        if &registered != supplied {
            return Err(RegistryError::IdentityMismatch);
        }
        let live = match inspector.inspect(supplied.pid) {
            Ok(identity) => identity,
            Err(ProcessIdentityError::NotRunning) => {
                let _ = self.unregister(&registered);
                return Err(RegistryError::StaleProcess);
            }
            Err(error) => return Err(RegistryError::Inspector(error)),
        };
        if live != registered {
            let _ = self.unregister(&registered);
            return Err(RegistryError::StaleProcess);
        }
        signal(supplied.pid).map_err(RegistryError::SignalFailed)?;
        self.unregister(&registered)
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
    fn registers_a_matching_live_identity() {
        let registry = ProcessRegistry::default();
        let supplied = identity(10);
        assert_eq!(
            registry.register(supplied.clone(), &Inspector(Ok(supplied))),
            Ok(())
        );
        assert_eq!(registry.active_count(), 1);
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
        assert_eq!(registry.active_count(), 1);
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
}
