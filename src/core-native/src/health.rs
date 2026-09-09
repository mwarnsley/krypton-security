//! Sticky, non-blocking component health. Loss/errors remain visible until restart.
use std::sync::atomic::AtomicBool;

#[derive(Default)]
pub struct RuntimeHealth {
    pub watcher_ready: AtomicBool,
    pub watcher_failed: AtomicBool,
    pub ipc_failed: AtomicBool,
    pub telemetry_dropped: AtomicBool,
}
