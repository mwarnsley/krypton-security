# Krypton feature ledger

This ledger tracks active Krypton capabilities and completed architectural
milestones. Add each future phase using the same status, objectives, and
verification structure.

## Milestone status

| Phase   | Status       | Feature                                                                                                                                                                               |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | Active       | **Local Directory Watchdog & Process Isolation** — Intercepts unauthorized path traversal and terminates registered rogue agent child processes through OS-level `SIGKILL` execution. |
| Phase 2 | Active       | **Live Filesystem Hardening & Event Monitoring** — Dispatches native asynchronous workspace events through the sandbox policy and owned-process quarantine registry.                  |
| Phase 3 | **Complete** | **AegisAgent Dashboard Command Center** — Delivers live telemetry visibility and secure operator-triggered containment through a local Next.js control plane.                         |

## Phase 1: Local Directory Watchdog & Process Isolation

- **Status:** Active
- Resolves requested paths to absolute paths before evaluating access.
- Permits only paths contained by `/sandbox_workspace`.
- Denies sensitive endpoints including `.ssh`, `.aws`, `.env`, and `.env.*`.
- Restricts `SIGKILL` enforcement to explicitly registered child processes.
- Appends structured quarantine events to the local `alerts.json` ledger through
  a retained non-blocking stream.

## Phase 2: Live Filesystem Hardening & Event Monitoring

- **Status:** Active
- Tracks `/sandbox_workspace` through native `fs.watch` event loops.
- Intercepts asynchronous file creation, rename, and modification events.
- Routes denied or indeterminate events through the path-policy engine and
  quarantines associated registered child processes.
- Maintains constant-time average registry operations while keeping filesystem
  dispatch asynchronous.

## Phase 3: AegisAgent Dashboard Command Center

- **Status:** **Complete**
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
