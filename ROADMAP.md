# Krypton Product Roadmap

This roadmap defines Krypton's prioritized release sequence. Status labels
separate repository implementation from remaining or proposed work; a planned
milestone or target entitlement is not a claim that the protection exists today.

## Roadmap-wide Architectural Invariants

Every phase and commercial tier must preserve these boundaries:

- Core policy, process-identity, enforcement, and telemetry-validation loops
  remain local, deterministic, bounded, and free of remote calls.
- Unknown policy states and unsupported enforcement paths fail closed. Krypton
  never signals an arbitrary PID: isolation remains limited to an explicitly
  registered child whose PID, start time, executable path, and parent PID match
  live operating-system evidence.
- Portable watcher events remain explicitly unattributed unless an OS adapter
  supplies trustworthy actor evidence. Inferred agent labels are explanatory
  telemetry, not process-control authority.
- Native telemetry remains distinct from static or mock demonstration data and
  retains at most 10,000 events or 8 MiB in `.krypton/telemetry/alerts.jsonl`.
- Platform, desktop, host, and fleet integrations must advertise their actual
  enforcement capability. A missing or degraded adapter must never silently
  downgrade a requested enforcing workflow to observation-only behavior.
- Licensing or subscription state must never weaken, delay, or remotely gate the
  individual workstation containment boundary. Paid capabilities operate around
  local enforcement rather than inside its decision loop.

### Universal Agent Bypass Containment

Krypton treats **Bypass Permissions**, **Auto**, **Full Access**, and **YOLO**
modes in clients such as Claude Code, Cursor Composer, Codex CLI, and Aider as
application-layer prompt suppressors, not operating-system authorization tokens.
When an agent is launched through Krypton's protected runner, its initial registered
child remains subject to the enabled controls regardless of the client's approval
configuration. The MCP file tools enforce native path checks; descendant and
syscall containment remain planned and other host tools are not intercepted.

---

## Phase 1: Local Developer Verification & Containment Core (HackerNoon Target / v1.0)

**Status:** In Progress (Active Release Milestone).

**Release Objective:** Deliver a bulletproof, 1-command local evaluation experience. Any engineer cloning the repository must be able to verify native containment against real LLM tool calls (such as Claude Desktop) within 60 seconds, with zero manual JSON hacking and zero ambiguous failure modes.

The 60-second experience is an unverified release target. Source setup still
requires dependencies and a running native daemon; client restart and native
macOS desktop QA remain release gates.

### 1. Local Frictionless Onboarding (Must-Have for HackerNoon)

- [x] **Mandatory Error-Handling Audit Gate:** Document the three-tier contract, audit all native/core/CLI entry points, remediate failures and record fresh verification in `AGENTS.md` before further Phase 1 features.
- [x] **Universal Single-Command Client Config (`krypton setup`):** Detect existing Claude Desktop, Cursor, Claude Code, and Cline storage on macOS/Linux; atomically back up existing JSON, preserve other servers, and install `krypton-protected-fs` with canonical supervisor paths and `KRYPTON_PROJECT_ROOT`. Malformed files and conflicting entries fail closed. `npm run setup` works without global linking.
- [ ] **Bundled Local `.mcpb` Generator:** A packaging task (`npm run build:mcpb`) that outputs a self-contained local extension for drag-and-drop loading in Claude Desktop.
- [x] **Deterministic Local Test Harness (`npm run test:e2e`):** Boots a disposable native daemon fixture, exercises production MCP stdio read/write and traversal denial, verifies durable native receipts mapped to `INTERCEPTED`, fail-closed socket loss and owned-child `SIGKILL`, then cleans up and prints a pass/fail terminal report. Desktop notification delivery is mocked; live client and dashboard QA remain separate.

### 2. Containment Engine & Native IPC (Must-Have)

- [x] **Native macOS Watchdog Daemon:** Rust core maintaining compound identities, revalidating registered children before isolation, and exposing authenticated local IPC via `.krypton/runtime/daemon.sock`.
- [x] **Fail-Closed Path Policy:** Strict lexical traversal rejection (`..`) and workspace canonicalization via `path_policy.rs`.
- [x] **Production Native MCP Server:** `src/core/mcp/server.cjs` serves bounded stdio `krypton_read_file` and `krypton_write_file` calls with local JSON Schema 2020-12 validation. `dispatchNativeControl` sends authenticated `mcp_file` requests to the Rust daemon, which evaluates paths and performs descriptor-relative file access. Denials return `isError: true` inside `result` with native receipts. Missing or incompatible daemons fail closed. Calls support up to 2 KiB of UTF-8 content and 1 KiB paths; only these tools are contained.
- [x] **Live Telemetry Emission:** Native MCP denials queue structured receipts to `.krypton/telemetry/alerts.jsonl`, retaining tool, requested path, timestamp, and denial action. Queue admission is distinct from durable persistence; write/queue failures degrade health. Dashboard rows show `INTERCEPTED`, with no invented actor PID or SIGKILL claim.

### 3. AegisAgent Dashboard & Telemetry Verification (Must-Have)

- [x] **Live Local Telemetry Stream:** Next.js dashboard parsing `.krypton/telemetry/alerts.jsonl` with clear distinctions between confirmed native receipts and unconfirmed observations.
- [ ] **Intercepted Breach Visualizer:** Verify that whenever Claude Desktop or an agent attempts a path escape, the exact timestamp, blocked path, weaponized tool name, and enforcement action immediately render on the dashboard UI.
- [x] **Desktop OS Notification Integration:** Trigger macOS Notification Center alerts via `/usr/bin/osascript` upon confirmed child process isolation.

---

## Phase 2: Transparent Developer Experience & Distribution (v1.1)

**Status:** Planned.

**Release Objective:** Expand beyond source checkouts to system-wide developer adoption via native package managers and prebuilt binaries.

- [ ] **Homebrew Tap:** Package prebuilt native binaries at `krypton-security/tap/krypton`.
- [ ] **Shell One-Liner:** Host a hardened shell installer at `https://get.krypton.dev`.
- [ ] **Process Tree & Descendant Containment:** Track agent child processes recursively through process generations.
- [ ] **Network Egress Isolation:** Process-level macOS Seatbelt profiles and domain allowlisting.

---

## Phase 3: Desktop App & Power-User Features (v1.2–v1.3)

**Status:** Planned.

**Release Objective:** Package the dashboard and daemon into a menu-bar application for non-terminal workflows.

- [ ] **Tauri Desktop Shell:** Bundle the React UI and Rust daemon into a lightweight (<10 MB) `.dmg`/`.app`.
- [ ] **Interactive Allowlisting:** 1-click rules from intercepted alert notifications.
- [ ] **Incident Export & Kill-Cam:** Exportable forensic summaries for security compliance.

---

## Phase 4: Enterprise Cross-Platform & Fleet Systems (v2.0)

**Status:** Planned.

- [ ] Windows Named Pipes and Job Object containment.
- [ ] Linux Landlock LSM and seccomp-bpf sandboxing.
- [ ] Multi-seat fleet console and SOC 2 / EU AI Act compliance evidence exports.

---

## Commercialization Matrix (Open-Core)

Target entitlements and pricing below are planned, not current availability.
macOS is supported; Linux native execution remains experimental and Windows
remains dashboard-only until the Phase 4 runtime ships.

| Capability                             |  Free (Community & Solo)  | Pro ($10–$15/mo) | Enterprise ($25–$40/seat/mo) |
| :------------------------------------- | :-----------------------: | :--------------: | :--------------------------: |
| **Local Containment Engine**           |   Full (macOS & Linux)    |       Full       |             Full             |
| **Single-Command Client Integrations** |         Included          |     Included     |           Included           |
| **Local Dashboard & Telemetry**        | Included (`alerts.jsonl`) |     Included     |           Included           |
| **CLI Wrapper (`krypton run`)**        |         Included          |     Included     |           Included           |
| **Desktop App & System Tray (Tauri)**  |         Included          |     Included     |           Included           |
| **File Snapshot & Rollback**           |       Not included        | Included (APFS)  |     Included (APFS/VSS)      |
| **Dynamic Threat Feeds**               |       Static local        |   Cloud-synced   |         Cloud-synced         |
| **Centralized Fleet Console**          |       Not included        |   Not included   |           Included           |
| **Compliance Export (SOC 2 / AI Act)** |       Not included        |   Not included   |           Included           |
