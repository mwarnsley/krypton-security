use crate::path_policy::PathDecision;
use crate::process_identity::ProcessIdentity;
use crate::telemetry::{try_enqueue, PersistedSecurityEvent};
use std::path::PathBuf;
use std::sync::mpsc::SyncSender;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilesystemEvent {
    pub path: PathBuf,
    pub decision: PathDecision,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttributionError;

pub trait ProcessEventAttributionAdapter: Send + Sync {
    fn attribution_for_event(
        &self,
        event: &FilesystemEvent,
    ) -> Result<Option<ProcessIdentity>, AttributionError>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PortableAttributionAdapter;

impl ProcessEventAttributionAdapter for PortableAttributionAdapter {
    fn attribution_for_event(
        &self,
        event: &FilesystemEvent,
    ) -> Result<Option<ProcessIdentity>, AttributionError> {
        if event.path.as_os_str().is_empty() {
            return Err(AttributionError);
        }
        Ok(None)
    }
}

pub fn record_portable_boundary_event(
    event: &FilesystemEvent,
    sequence: u64,
    sender: &SyncSender<PersistedSecurityEvent>,
) {
    try_enqueue(
        sender,
        PersistedSecurityEvent::unattributed_filesystem(
            sequence,
            &event.decision.resolved_path,
            event.decision.target_existed,
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::{
        record_portable_boundary_event, FilesystemEvent, PortableAttributionAdapter,
        ProcessEventAttributionAdapter,
    };
    use crate::path_policy::PathDecision;
    use crate::telemetry::TelemetryAttribution;
    use std::path::PathBuf;
    use std::sync::mpsc::sync_channel;

    fn event() -> FilesystemEvent {
        FilesystemEvent {
            path: PathBuf::from("/tmp/outside"),
            decision: PathDecision {
                resolved_path: PathBuf::from("/tmp/outside"),
                target_existed: false,
                within_protected_root: false,
            },
        }
    }

    #[test]
    fn portable_adapter_never_fabricates_process_attribution() {
        assert_eq!(
            PortableAttributionAdapter.attribution_for_event(&event()),
            Ok(None)
        );
    }

    #[test]
    fn portable_events_are_persisted_as_unattributed() {
        let (sender, receiver) = sync_channel(1);
        record_portable_boundary_event(&event(), 1, &sender);
        let alert = receiver.try_recv().expect("alert");
        assert_eq!(alert.attribution, TelemetryAttribution::Unattributed);
        assert!(alert.process.is_none());
    }
}
