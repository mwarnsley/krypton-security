# Krypton feature ledger

This ledger tracks active Krypton capabilities and completed architectural
milestones. Add each future phase using the same status, objectives, and
verification structure.

## User Onboarding & Learning Strategy

Krypton begins with a **Krypton Training Phase** in Audit-Only Mode. In plain
terms, it watches and maps how your normal tools read, create, rename, and update
files inside the current workspace without terminating those tools while you are
still establishing a safe baseline. If a process reaches outside that folder,
Krypton records the event and explains it as a warning so developers can
separate expected project behavior from a genuine escape attempt without having
their work interrupted.

Once the normal file activity is understood, the operator can enable Active
Enforcement. Krypton then uses the same local boundary signals to isolate
registered malicious child processes before they can access other areas of the
computer. This gradual path reduces setup frustration while keeping the move to
strong protection visible and intentional.

## Milestone status

| Phase   | Status       | Feature                                                                                                                                                                               |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | Active       | **Local Directory Watchdog & Process Isolation** — Intercepts unauthorized path traversal and terminates registered rogue agent child processes through OS-level `SIGKILL` execution. |
| Phase 2 | Active       | **Live Filesystem Hardening & Event Monitoring** — Dispatches native asynchronous workspace events through the sandbox policy and owned-process quarantine registry.                  |
| Phase 3 | **Complete** | **AegisAgent Dashboard Command Center** — Delivers live telemetry visibility and secure operator-triggered containment through a local Next.js control plane.                         |

## Phase 1: Local Directory Watchdog & Process Isolation

- **Status:** Active
- **User value:** Keeps an agent focused on the approved project folder and
  provides a controlled way to stop an owned malicious child process before it
  reaches private files elsewhere on the computer.
- Resolves requested paths to absolute paths before evaluating access.
- Permits only paths contained by `/sandbox_workspace`.
- Denies sensitive endpoints including `.ssh`, `.aws`, `.env`, and `.env.*`.
- Restricts `SIGKILL` enforcement to explicitly registered child processes.
- Appends structured quarantine events to the local `alerts.json` ledger through
  a retained non-blocking stream.

## Phase 2: Live Filesystem Hardening & Event Monitoring

- **Status:** Active
- **User value:** Watches file activity as it happens, so protection follows
  real edits and tool operations instead of depending on a one-time scan.
- Tracks `/sandbox_workspace` through native `fs.watch` event loops.
- Intercepts asynchronous file creation, rename, and modification events.
- Routes denied or indeterminate events through the path-policy engine and
  quarantines associated registered child processes.
- Maintains constant-time average registry operations while keeping filesystem
  dispatch asynchronous.

## Phase 3: AegisAgent Dashboard Command Center

- **Status:** **Complete**
- **User value:** Turns low-level security events into a readable control panel
  where developers can understand what happened and act without leaving their
  normal workflow.
- Delivers a Next.js App Router command center with live firewall state,
  registered-process counts, and newest-first security telemetry.
- Integrates **TanStack Table** for performant, data-dense alert-grid state,
  explicit column definitions, and stable row iteration.
- Applies **Tailwind CSS** utilities for a responsive, high-contrast,
  cyber-minimalist dark interface with clear intercepted and quarantined states.
- Deploys a per-alert **Force Isolate** containment action with disabled and busy
  states to prevent duplicate dispatches.
- Connects that control to `POST /api/telemetry/terminate`, which validates
  positive safe-integer PIDs, rejects dashboard self-termination, and permits
  quarantine only for processes registered to the active workspace.
- Returns explicit success and error payloads so containment outcomes remain
  visible without blocking or destabilizing the interface.
- Deploys a **"Timeline Rewind" (One-Click Exploit Reproduction)** capability.
  Next to each intercepted alert, developers can use a dropdown option to
  instantly download a perfectly formatted Markdown signature report. This
  packages confusing, technical system logs (like Process IDs and absolute
  folder pathways) into a clean, human-readable summary that a developer can
  immediately pass to a security team or use to patch their code repository on
  the spot.
- Integrates an **Automated Dependency Attestation Engine**. Instead of forcing
  a developer to stare at a meaningless raw process identification number (PID)
  like 51384 during an alert event, Krypton automatically traces that number
  back to its root execution path or parent task in real time. It renders a
  high-contrast mini-badge directly inside the data row showing exactly which
  software script or third-party bundle (like a background shell script or a
  package running inside `node_modules`) is responsible for triggering the
  directory escape attempt.

## Future milestones

```markdown
## Phase N: Milestone name

- **Status:** Planned | Active | Complete
- **Objectives:** Concise architectural outcomes.
- **Verification:** Observable evidence that the milestone works.
```

## Absolute status checklist

- [x] Native macOS Kernel Stream Integration via FSEvents
- [x] Thread-Safe Canonical Absolute Path Resolution
- [x] Secure Synchronous IPC Transaction Verification Loop (Port 9000)
- [x] High-Fidelity Shadcn Data Grid (Sorted, Paginated, & Human-Readable)
- [x] Live Stack-Limited Real-Time Warning Toasts (Sonner)
- [x] Rolling-Window Autonomous Process Quarantine Mitigation Engine
