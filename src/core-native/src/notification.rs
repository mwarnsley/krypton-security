use crate::process_identity::ProcessIdentity;
use std::io;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

#[cfg(any(target_os = "macos", test))]
use std::time::Duration;
#[cfg(target_os = "macos")]
use std::{
    process::{Command, Stdio},
    time::Instant,
};

const NOTIFICATION_QUEUE_CAPACITY: usize = 32;
const NOTIFICATION_TITLE: &str = "Krypton quarantine confirmed";

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
#[repr(u8)]
// macOS delivery failures remain part of the shared status model on other platforms.
#[allow(dead_code)]
pub enum NotificationFailure {
    DeliveryFailed = 1,
    PermissionDenied,
    QueueFull,
    QueueUnavailable,
    Unavailable,
    TimedOut,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationHealth {
    Ready,
    Degraded(NotificationFailure),
}

/// Atomic status updates never wait on locks or stderr from an IPC caller.
#[derive(Default)]
pub struct NotificationStatus(AtomicU8);

impl NotificationStatus {
    pub fn is_degraded(&self) -> bool {
        self.0.load(Ordering::Relaxed) != 0
    }
    fn degraded(&self, failure: NotificationFailure) {
        self.0.store(failure as u8, Ordering::Relaxed);
    }

    #[cfg(test)]
    fn read(&self) -> NotificationHealth {
        match self.0.load(Ordering::Relaxed) {
            0 => NotificationHealth::Ready,
            1 => NotificationHealth::Degraded(NotificationFailure::DeliveryFailed),
            2 => NotificationHealth::Degraded(NotificationFailure::PermissionDenied),
            3 => NotificationHealth::Degraded(NotificationFailure::QueueFull),
            4 => NotificationHealth::Degraded(NotificationFailure::QueueUnavailable),
            5 => NotificationHealth::Degraded(NotificationFailure::Unavailable),
            _ => NotificationHealth::Degraded(NotificationFailure::TimedOut),
        }
    }
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
    health: Arc<NotificationStatus>,
}

impl QuarantineNotifier for NotificationDispatcher {
    fn notify_confirmed_quarantine(&self, process: &ProcessIdentity) {
        let notification = DesktopNotification::for_confirmed_quarantine(process);
        match self.sender.try_send(notification) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.health.degraded(NotificationFailure::QueueFull);
            }
            Err(TrySendError::Disconnected(_)) => {
                self.health.degraded(NotificationFailure::QueueUnavailable);
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

fn sanitized_agent_name(process: &ProcessIdentity) -> &'static str {
    let candidate = process
        .executable_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown-agent");
    // These are display hints, never executable authenticity or signal authority.
    match candidate {
        "claude" => "Claude Code",
        "codex" => "Codex CLI",
        "cursor" | "Cursor" => "Cursor",
        "aider" => "Aider",
        _ => "Unknown Agent Process",
    }
}

pub fn start_notification_dispatcher<D>(
    delivery: D,
) -> io::Result<(
    NotificationDispatcher,
    Arc<NotificationStatus>,
    JoinHandle<()>,
)>
where
    D: NotificationDelivery,
{
    let (sender, receiver) = sync_channel(NOTIFICATION_QUEUE_CAPACITY);
    let health = Arc::new(NotificationStatus::default());
    let worker_health = Arc::clone(&health);
    let worker = thread::Builder::new()
        .name("krypton-notifications".to_owned())
        .spawn(move || {
            for notification in receiver {
                match delivery.deliver(&notification) {
                    Ok(()) => {
                        // Keep failures sticky so queue saturation is not hidden by
                        // an older successful delivery racing with the caller.
                    }
                    Err(failure) => worker_health.degraded(failure),
                }
            }
        })?;
    Ok((
        NotificationDispatcher {
            sender,
            health: Arc::clone(&health),
        },
        health,
        worker,
    ))
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsNotificationDelivery;

impl NotificationDelivery for MacOsNotificationDelivery {
    fn deliver(&self, notification: &DesktopNotification) -> Result<(), NotificationFailure> {
        #[cfg(target_os = "macos")]
        {
            let mut child = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(MACOS_NOTIFICATION_SCRIPT)
                .arg(&notification.title)
                .arg(&notification.body)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(classify_spawn_error)?;
            let started = Instant::now();
            wait_for_delivery(&mut child, || started.elapsed(), thread::sleep)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = notification;
            Err(NotificationFailure::Unavailable)
        }
    }
}

#[cfg(any(target_os = "macos", test))]
trait DeliveryProcess {
    fn poll(&mut self) -> io::Result<Option<bool>>;
    fn kill_and_reap(&mut self) -> io::Result<()>;
}

#[cfg(target_os = "macos")]
impl DeliveryProcess for std::process::Child {
    fn poll(&mut self) -> io::Result<Option<bool>> {
        self.try_wait().map(|status| status.map(|s| s.success()))
    }
    fn kill_and_reap(&mut self) -> io::Result<()> {
        // Polling still reaps if kill races with natural exit; never block
        // indefinitely in wait() after a failed delivery.
        if let Err(error) = self.kill() {
            return match self.try_wait()? {
                Some(_) => Ok(()),
                None => Err(error),
            };
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if self.try_wait()?.is_some() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "notification process reap deadline exceeded",
                ));
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

/// Polls only on the delivery worker; no pipes can fill or retain untrusted output.
#[cfg(any(target_os = "macos", test))]
fn wait_for_delivery(
    process: &mut impl DeliveryProcess,
    mut elapsed: impl FnMut() -> Duration,
    mut pause: impl FnMut(Duration),
) -> Result<(), NotificationFailure> {
    let deadline = Duration::from_secs(2);
    loop {
        match process.poll() {
            Ok(Some(true)) => return Ok(()),
            Ok(Some(false)) => return Err(NotificationFailure::DeliveryFailed),
            Err(_) => {
                process
                    .kill_and_reap()
                    .map_err(|_| NotificationFailure::DeliveryFailed)?;
                return Err(NotificationFailure::DeliveryFailed);
            }
            Ok(None) => {}
        }
        let remaining = deadline.saturating_sub(elapsed());
        if remaining.is_zero() {
            process
                .kill_and_reap()
                .map_err(|_| NotificationFailure::DeliveryFailed)?;
            return Err(NotificationFailure::TimedOut);
        }
        pause(remaining.min(Duration::from_millis(20)));
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

    struct FakeProcess {
        state: std::io::Result<Option<bool>>,
        cleaned: bool,
    }

    impl super::DeliveryProcess for FakeProcess {
        fn poll(&mut self) -> std::io::Result<Option<bool>> {
            match &self.state {
                Ok(status) => Ok(*status),
                Err(_) => Err(std::io::Error::other("poll failed")),
            }
        }
        fn kill_and_reap(&mut self) -> std::io::Result<()> {
            self.cleaned = true;
            Ok(())
        }
    }

    #[test]
    fn delivery_deadline_kills_and_reaps_without_real_time_or_signals() {
        use std::{cell::Cell, time::Duration};
        let now = Cell::new(Duration::ZERO);
        let mut child = FakeProcess {
            state: Ok(None),
            cleaned: false,
        };
        let result =
            super::wait_for_delivery(&mut child, || now.get(), |delay| now.set(now.get() + delay));
        assert_eq!(result, Err(NotificationFailure::TimedOut));
        assert!(child.cleaned);
        assert_eq!(now.get(), Duration::from_secs(2));
    }

    #[test]
    fn successful_delivery_does_not_kill_completed_process() {
        let mut child = FakeProcess {
            state: Ok(Some(true)),
            cleaned: false,
        };
        let result = super::wait_for_delivery(
            &mut child,
            || panic!("clock unnecessary"),
            |_| panic!("no sleep"),
        );
        assert_eq!(result, Ok(()));
        assert!(!child.cleaned);
    }

    #[test]
    fn poll_failure_cleans_up_and_degrades() {
        let mut child = FakeProcess {
            state: Err(std::io::Error::other("poll failed")),
            cleaned: false,
        };
        let result =
            super::wait_for_delivery(&mut child, || panic!("no clock"), |_| panic!("no sleep"));
        assert_eq!(result, Err(NotificationFailure::DeliveryFailed));
        assert!(child.cleaned);
    }

    #[test]
    fn full_or_disconnected_queue_reports_atomic_degradation() {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let health = Arc::new(super::NotificationStatus::default());
        let notifier = super::NotificationDispatcher {
            sender,
            health: Arc::clone(&health),
        };
        notifier.notify_confirmed_quarantine(&identity());
        notifier.notify_confirmed_quarantine(&identity());
        assert_eq!(
            health.read(),
            NotificationHealth::Degraded(NotificationFailure::QueueFull)
        );
        drop(receiver);
        notifier.notify_confirmed_quarantine(&identity());
        assert_eq!(
            health.read(),
            NotificationHealth::Degraded(NotificationFailure::QueueUnavailable)
        );
    }

    #[test]
    fn trusted_agent_labels_never_echo_unknown_metadata() {
        for (name, label) in [
            ("claude", "Claude Code"),
            ("codex", "Codex CLI"),
            ("Cursor", "Cursor"),
            ("aider", "Aider"),
            ("claude-private-key", "Unknown Agent Process"),
            ("password\nsecret", "Unknown Agent Process"),
        ] {
            let mut process = identity();
            process.executable_path = PathBuf::from("/tmp").join(name);
            assert_eq!(super::sanitized_agent_name(&process), label);
        }
    }

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
        let (notifier, health, worker) =
            start_notification_dispatcher(delivery).expect("notification worker startup");
        notifier.notify_confirmed_quarantine(&identity());
        drop(notifier);
        worker.join().expect("notification worker");
        let health = health.read();
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
            "Claude Code (PID 4242) was quarantined. Open AegisAgent for details."
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

    #[test]
    fn confidential_basename_never_reaches_banner() {
        let mut process = identity();
        process.executable_path = "/tmp/customer-secret-acquisition.exe".into();
        assert_eq!(
            DesktopNotification::for_confirmed_quarantine(&process).body,
            "Unknown Agent Process (PID 4242) was quarantined. Open AegisAgent for details."
        );
    }
}
