//! Test-only daemon fixture driven by tests_simulation/test_injection.ts.
//! Real IPC, peer credentials, process inspection, signals, watcher and ledger;
//! only desktop delivery is replaced. This module is absent from production builds.
use crate::ipc::{start_ipc, ControlState, EnforcementMode};
use crate::notification::{
    start_notification_dispatcher, DesktopNotification, NotificationDelivery, NotificationFailure,
};
use crate::path_policy::resolve_path;
use crate::process_identity::SystemProcessInspector;
use crate::process_registry::ProcessRegistry;
use crate::telemetry::{start_writer, write_private_atomic, TelemetryLedger};
use crate::watcher::{record_portable_boundary_event, FilesystemEvent};
use notify::{RecursiveMode, Watcher};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

struct ReceiptDelivery(PathBuf);
impl NotificationDelivery for ReceiptDelivery {
    fn deliver(&self, notification: &DesktopNotification) -> Result<(), NotificationFailure> {
        write_private_atomic(&self.0, |file| {
            serde_json::to_writer(
                &mut *file,
                &serde_json::json!({
                    "source": "mock_notification_delivery",
                    "title": notification.title,
                    "body": notification.body,
                }),
            )?;
            file.write_all(b"\n")
        })
        .map_err(|_| NotificationFailure::DeliveryFailed)
    }
}

#[test]
#[ignore = "test-only daemon fixture; run npm run test:sim"]
fn daemon_fixture() {
    let root = PathBuf::from(std::env::var_os("KRYPTON_SIMULATION_ROOT").expect("simulation root"));
    assert!(
        root.join("simulation-owned").is_file(),
        "disposable fixture marker required"
    );
    let ledger = Arc::new(
        TelemetryLedger::open(root.join(".krypton/telemetry/alerts.jsonl"), 100, 1_048_576)
            .expect("ledger"),
    );
    let (sender, writer) = start_writer(Arc::clone(&ledger));
    let (notifier, notification_health, _notification_worker) =
        start_notification_dispatcher(ReceiptDelivery(root.join("notification-receipt.jsonl")));
    let components = Arc::new(crate::health::RuntimeHealth::default());
    let state = Arc::new(ControlState {
        registry: Arc::new(ProcessRegistry::default()),
        mode: Arc::new(RwLock::new(EnforcementMode::AuditOnly)),
        ledger_health: ledger.health(),
        inspector: Arc::new(SystemProcessInspector),
        notifier: Arc::new(notifier),
        notification_health,
        components: Arc::clone(&components),
    });
    let _ipc = start_ipc(&root.join(".krypton/runtime"), state).expect("authenticated IPC");
    let protected = root.join("sandbox_workspace");
    let events = sender.clone();
    let watcher_health = Arc::clone(&components);
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let event = result.expect("native watcher event");
        for path in event.paths {
            let decision = resolve_path(&protected, &path).expect("canonical policy");
            if !decision.within_protected_root
                && !record_portable_boundary_event(
                    &FilesystemEvent { path, decision },
                    ledger.next_sequence(),
                    &events,
                )
            {
                watcher_health
                    .telemetry_dropped
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    })
    .expect("watcher");
    watcher
        .watch(&root.join("outside"), RecursiveMode::NonRecursive)
        .expect("watch fixture");
    components
        .watcher_ready
        .store(true, std::sync::atomic::Ordering::Relaxed);
    println!("KRYPTON_SIMULATION_READY");
    std::io::stdout().flush().expect("ready output");
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .expect("driver shutdown");
    drop(watcher);
    drop(sender);
    writer.join().expect("flush durable writer");
}
