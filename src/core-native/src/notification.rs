use crate::process_identity::ProcessIdentity;
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};

#[cfg(target_os = "macos")]
use std::{io, process::Command};

const NOTIFICATION_QUEUE_CAPACITY: usize = 32;
const NOTIFICATION_TITLE: &str = "Krypton quarantine confirmed";
const AGENT_NAME_MAX_CHARS: usize = 48;

#[cfg(target_os = "macos")]
const MACOS_NOTIFICATION_SCRIPT: &str = r#"on run argv
display notification (item 2 of argv) with title (item 1 of argv)
end run"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopNotification {
    pub title: String,
    pub body: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationFailure {
    DeliveryFailed,
    PermissionDenied,
    QueueFull,
    QueueUnavailable,
    Unavailable,
}

impl NotificationFailure {
    fn code(self) -> &'static str {
        match self {
            Self::DeliveryFailed => "delivery_failed",
            Self::PermissionDenied => "permission_denied",
            Self::QueueFull => "queue_full",
            Self::QueueUnavailable => "queue_unavailable",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationHealth {
    Ready,
    Degraded(NotificationFailure),
}

pub trait NotificationDelivery: Send + Sync + 'static {
    fn deliver(&self, notification: &DesktopNotification) -> Result<(), NotificationFailure>;
}

pub trait QuarantineNotifier: Send + Sync {
    fn notify_confirmed_quarantine(&self, process: &ProcessIdentity);
}

#[derive(Clone)]
pub struct NotificationDispatcher {
    sender: SyncSender<DesktopNotification>,
    health: Arc<RwLock<NotificationHealth>>,
}

impl QuarantineNotifier for NotificationDispatcher {
    fn notify_confirmed_quarantine(&self, process: &ProcessIdentity) {
        let notification = DesktopNotification::for_confirmed_quarantine(process);
        match self.sender.try_send(notification) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                mark_degraded(&self.health, NotificationFailure::QueueFull);
            }
            Err(TrySendError::Disconnected(_)) => {
                mark_degraded(&self.health, NotificationFailure::QueueUnavailable);
            }
        }
    }
}

impl DesktopNotification {
    fn for_confirmed_quarantine(process: &ProcessIdentity) -> Self {
        let agent_name = sanitized_agent_name(process);
        Self {
            title: NOTIFICATION_TITLE.to_owned(),
            body: format!(
                "{agent_name} (PID {}) was quarantined. Open AegisAgent for details.",
                process.pid
            ),
        }
    }
}

fn sanitized_agent_name(process: &ProcessIdentity) -> String {
    let candidate = process
        .executable_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown-agent");
    let sanitized = candidate
        .chars()
        .take(AGENT_NAME_MAX_CHARS)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized
        .chars()
        .any(|character| character.is_ascii_alphanumeric())
    {
        sanitized
    } else {
        "unknown-agent".to_owned()
    }
}

fn mark_degraded(health: &RwLock<NotificationHealth>, failure: NotificationFailure) {
    if let Ok(mut current) = health.write() {
        *current = NotificationHealth::Degraded(failure);
    }
    eprintln!(
        "[NOTIFICATION DEGRADED] desktop alert unavailable: {}",
        failure.code()
    );
}

pub fn start_notification_dispatcher<D>(
    delivery: D,
) -> (
    NotificationDispatcher,
    Arc<RwLock<NotificationHealth>>,
    JoinHandle<()>,
)
where
    D: NotificationDelivery,
{
    let (sender, receiver) = sync_channel(NOTIFICATION_QUEUE_CAPACITY);
    let health = Arc::new(RwLock::new(NotificationHealth::Ready));
    let worker_health = Arc::clone(&health);
    let worker = thread::spawn(move || {
        for notification in receiver {
            match delivery.deliver(&notification) {
                Ok(()) => {
                    if let Ok(mut current) = worker_health.write() {
                        *current = NotificationHealth::Ready;
                    }
                }
                Err(failure) => mark_degraded(&worker_health, failure),
            }
        }
    });
    (
        NotificationDispatcher {
            sender,
            health: Arc::clone(&health),
        },
        health,
        worker,
    )
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsNotificationDelivery;

impl NotificationDelivery for MacOsNotificationDelivery {
    fn deliver(&self, notification: &DesktopNotification) -> Result<(), NotificationFailure> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(MACOS_NOTIFICATION_SCRIPT)
                .arg(&notification.title)
                .arg(&notification.body)
                .output()
                .map_err(classify_spawn_error)?;
            if output.status.success() {
                return Ok(());
            }
            let diagnostic = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            if diagnostic.contains("not authorized")
                || diagnostic.contains("permission")
                || diagnostic.contains("-1743")
            {
                Err(NotificationFailure::PermissionDenied)
            } else {
                Err(NotificationFailure::DeliveryFailed)
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = notification;
            Err(NotificationFailure::Unavailable)
        }
    }
}

#[cfg(target_os = "macos")]
fn classify_spawn_error(error: io::Error) -> NotificationFailure {
    if error.kind() == io::ErrorKind::NotFound {
        NotificationFailure::Unavailable
    } else if error.kind() == io::ErrorKind::PermissionDenied {
        NotificationFailure::PermissionDenied
    } else {
        NotificationFailure::DeliveryFailed
    }
}

#[cfg(test)]
mod tests {
    use super::{
        start_notification_dispatcher, DesktopNotification, NotificationDelivery,
        NotificationFailure, NotificationHealth, QuarantineNotifier,
    };
    use crate::process_identity::ProcessIdentity;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    struct RecordingDelivery {
        notifications: Arc<Mutex<Vec<DesktopNotification>>>,
        result: Result<(), NotificationFailure>,
    }

    impl NotificationDelivery for RecordingDelivery {
        fn deliver(&self, notification: &DesktopNotification) -> Result<(), NotificationFailure> {
            self.notifications
                .lock()
                .expect("notification records")
                .push(notification.clone());
            self.result
        }
    }

    fn identity() -> ProcessIdentity {
        ProcessIdentity {
            pid: 4242,
            start_time: 10,
            executable_path: PathBuf::from("/Users/example/.aws/credentials/claude"),
            parent_pid: Some(4000),
        }
    }

    fn dispatch(
        result: Result<(), NotificationFailure>,
    ) -> (NotificationHealth, Vec<DesktopNotification>) {
        let notifications = Arc::new(Mutex::new(Vec::new()));
        let delivery = RecordingDelivery {
            notifications: Arc::clone(&notifications),
            result,
        };
        let (notifier, health, worker) = start_notification_dispatcher(delivery);
        notifier.notify_confirmed_quarantine(&identity());
        drop(notifier);
        worker.join().expect("notification worker");
        let health = *health.read().expect("notification health");
        let notifications = notifications.lock().expect("notification records").clone();
        (health, notifications)
    }

    #[test]
    fn delivers_a_redacted_notification_for_a_confirmed_quarantine() {
        let (health, notifications) = dispatch(Ok(()));

        assert_eq!(health, NotificationHealth::Ready);
        assert_eq!(notifications.len(), 1);
        assert_eq!(
            notifications[0].body,
            "claude (PID 4242) was quarantined. Open AegisAgent for details."
        );
    }

    #[test]
    fn records_permission_denial_without_panicking() {
        let (health, _) = dispatch(Err(NotificationFailure::PermissionDenied));

        assert_eq!(
            health,
            NotificationHealth::Degraded(NotificationFailure::PermissionDenied)
        );
    }

    #[test]
    fn records_unavailable_delivery_without_panicking() {
        let (health, _) = dispatch(Err(NotificationFailure::Unavailable));

        assert_eq!(
            health,
            NotificationHealth::Degraded(NotificationFailure::Unavailable)
        );
    }
}
