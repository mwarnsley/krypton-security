# Krypton product backlog

This backlog records strategic product work that remains intentionally outside
the current hardened runtime and dashboard scope.

## Storage and telemetry durability

- [ ] Transition the local flat-file storage layer (`alerts.json`) to a highly
      performant embedded secure database such as SQLite or RocksDB, or to a
      centralized secure logging endpoint with authenticated transport, retention,
      and integrity controls.

## Privilege containment

- [ ] Refine system privilege containment boundaries so native monitoring,
      policy evaluation, telemetry persistence, and process isolation operate with
      separately minimized operating-system capabilities.

## Runtime policy configuration

- [ ] Build granular runtime policy rule configurations for workspace scopes,
      sensitive targets, process permissions, enforcement actions, and auditable
      per-agent exceptions.

## HackerNoon / Public Release Roadmap

- [ ] Cross-Platform Watchdog Core: Abstract the file monitoring loop using a
      cross-platform engine (like the Rust `notify` crate) and replace
      platform-specific kill signals with unified abstraction layers supporting
      Windows (`taskkill`) and Linux systems.
- [ ] Dynamic Multi-Tenant Sandbox Profiling: Design and implement a
      `krypton.config.json` ingestion pipeline so users can declare distinct
      security boundaries, custom exclusion rules, and unique rate-limiting
      parameters without hardcoding project directories.
- [ ] Application Compilation & Desktop Packaging: Integrate Tauri to bundle the
      Next.js frontend dashboard and the native Rust daemon background service
      into a single, high-performance, lightweight installer executable.
- [ ] Secure Loopback Handshake Hardening: Strengthen the synchronous IPC
      transaction on port 9000 by implementing a rotating, pre-shared
      cryptographic handshake token to guarantee that only the official
      dashboard server can dispatch isolation commands.
- [ ] Kernel-Level Telemetry Evolution: Research and architect optional platform
      extensions transitioning user-space watchers to low-level kernel auditing
      systems (e.g., eBPF on Linux or the Endpoint Security framework on macOS)
      for deep process monitoring.
