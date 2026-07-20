use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub pid: u32,
    pub start_time: u64,
    pub executable_path: PathBuf,
    pub parent_pid: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProcessIdentityError {
    InvalidPid,
    NotRunning,
    ExecutableUnavailable,
}

pub trait ProcessInspector: Send + Sync {
    fn inspect(&self, pid: u32) -> Result<ProcessIdentity, ProcessIdentityError>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemProcessInspector;

impl ProcessInspector for SystemProcessInspector {
    fn inspect(&self, pid: u32) -> Result<ProcessIdentity, ProcessIdentityError> {
        if pid == 0 || pid > i32::MAX as u32 {
            return Err(ProcessIdentityError::InvalidPid);
        }

        let native_pid = Pid::from_u32(pid);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[native_pid]), true);
        let process = system
            .process(native_pid)
            .ok_or(ProcessIdentityError::NotRunning)?;
        let executable_path = process
            .exe()
            .ok_or(ProcessIdentityError::ExecutableUnavailable)?
            .to_path_buf();

        Ok(ProcessIdentity {
            pid,
            start_time: process.start_time(),
            executable_path,
            parent_pid: process.parent().map(Pid::as_u32),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{ProcessIdentityError, ProcessInspector, SystemProcessInspector};

    #[test]
    fn rejects_a_zero_pid() {
        assert_eq!(
            SystemProcessInspector.inspect(0),
            Err(ProcessIdentityError::InvalidPid)
        );
    }

    #[test]
    fn inspects_the_current_process_generation() {
        let identity = SystemProcessInspector
            .inspect(std::process::id())
            .expect("current process");
        assert_eq!(identity.pid, std::process::id());
        assert!(identity.start_time > 0);
    }
}
