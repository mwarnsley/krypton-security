# Krypton

Krypton is a local security workspace for untrusted package scripts, AI coding
agents, automated developer tools, and the child processes they launch through
Krypton. It combines an explicit workspace policy, a protected child-process
launcher, OS-backed filesystem telemetry, authenticated native control, and a
dashboard without claiming that portable filesystem notifications can identify
or stop the actor that caused an event.

## Why Krypton exists

A malicious package lifecycle script or an AI-generated shell command can try
to leave its assigned project directory and read local credentials such as
`.aws`, `.ssh`, or environment files. The developer may trust the tool while the
tool is acting on untrusted package content, generated code, or prompt-injected
instructions. Krypton makes the intended workspace and owned-process boundary
explicit so integrations can make local, deterministic policy decisions and
operators can see bounded evidence when filesystem activity occurs.

Krypton does not guarantee prevention of credential theft. Its portable watcher
records post-event filesystem telemetry; stronger OS-specific attribution and
permission adapters remain future work.

## What Krypton does today

- Defines a protected workspace boundary inside an explicit project root.
- Launches protected tools and registers the exact PID, start time, executable,
  and parent identity of each owned child-process generation.
- Records bounded, OS-backed filesystem telemetry without inventing an actor PID.
- Exposes clearly labeled native and demonstration states in a Next.js dashboard.
- Allows isolation only for a process identity previously registered by Krypton
  and revalidated against live operating-system state.

## What Krypton does not do

Krypton is not antivirus, a malware classifier, a complete VM or container, or
a root/admin security boundary. It does not provide universal pre-access kernel
enforcement, reliably attribute portable `notify`/FSEvents/inotify events to a
process, or automatically protect actions performed by applications that never
integrate with its policy or protected launcher.

## Quick example

1. Krypton launches an AI tool inside `sandbox_workspace`.
2. The launcher registers the exact child-process identity with the Rust daemon.
3. A filesystem event occurs outside the configured protected workspace.
4. The current portable watcher records that post-event telemetry as
   `unattributed` unless a future OS-specific adapter can identify the actor.
5. Only a process identity previously registered by Krypton can be isolated.

## Supported platforms

- macOS and Linux: native daemon, Unix-domain socket control, live process
  identity validation, and Unix signal isolation.
- Windows: dashboard-only demonstration mode. Native control is intentionally
  unsupported until a restrictive named-pipe ACL and process-generation adapter
  are implemented.

## Architecture

```text
[Protected launcher]
      │ spawn → inspect PID/start/executable/parent → authenticated register
      ▼
[Rust daemon process registry] ◄──── authenticated Unix socket ──── [Next API]
      │ exact-generation revalidation                                 │
      └─ isolate only registered identity                             ▼
                                                               [Dashboard]

[OS filesystem notifications]
      │ paths and event kinds only; no fabricated PID
      ▼
[Component-aware workspace policy] → [bounded JSONL telemetry ledger]
```

The project root contains Krypton configuration and the dashboard. The protected
workspace root is a narrower directory in which a protected child is authorized
to mutate files. They are not interchangeable.

## Prerequisites

Confirm the toolchain before setup:

```sh
node --version
npm --version
rustc --version
cargo --version
```

- Node.js 20.19.4 is pinned by `.node-version`; use the matching npm shipped
  with that runtime.
- Rust 1.97.0 is pinned by `rust-toolchain.toml`. Install Rust through
  [rustup](https://rustup.rs/) so the repository toolchain is selected correctly.
- macOS native builds require Apple command-line developer tools.
- Linux native builds require a working C compiler and linker appropriate to the
  distribution.
- Windows does not currently support native mode and does not require Rust for
  dashboard-only demonstration mode.

## Setup

### macOS and Linux native mode

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security
npm ci
npm run dev:full
```

`dev:full` starts both the Rust daemon and Next.js dashboard. Open
`http://localhost:3000`.

## Running Your First Live Simulation

> **LIVE END-TO-END CHECK:** Keep `npm run dev:full` running while you launch
> the simulation from a second terminal window.

1. Leave the first terminal running `npm run dev:full`, and keep the Next.js
   dashboard open at `http://localhost:3000`.
2. Open a second terminal window, change to the same `krypton-security`
   directory, and run:

   ```sh
   npm run test:sim
   ```

3. Watch the second terminal. The simulation creates a poisoned support ticket
   that instructs a mock agent to scrape `../.ssh/id_rsa`. Krypton intercepts
   and blocks the out-of-bounds read before the mock agent can access the key,
   quarantines the disposable mock process, and confirms that the event was
   recorded in the telemetry ledger.
4. Return to the dashboard. The Next.js UI instantly streams the new
   **CRITICAL** alert row into its live ledger, giving you visible confirmation
   that the complete path from attack detection and blocking through telemetry
   persistence and dashboard delivery is fully operational.

### Dashboard-only demonstration mode

This is the supported Windows onboarding path. It is also useful on macOS or
Linux when Rust is unavailable.

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security
npm ci
npm run dev:dashboard
```

Demonstration mode uses simulated telemetry, not native security evidence. The
dashboard displays: “Demonstration mode — native telemetry is unavailable.
Events shown below are simulated.” If the daemon is reachable but its ledger is
degraded or invalid, the banner instead says that native telemetry could not be
validated.

To run only the native daemon on macOS or Linux:

```sh
npm run dev:daemon
```

## Runtime configuration

`krypton.config.json` separates the relevant roots and bounds:

```json
{
  "projectRoot": ".",
  "protectedWorkspaceRoot": "sandbox_workspace",
  "telemetryPath": ".krypton/telemetry/alerts.jsonl",
  "runtimeDirectory": ".krypton/runtime",
  "ignoredPaths": [".git", "node_modules", ".next", "coverage", "target"],
  "observedRoots": [],
  "sensitivePaths": [".ssh", ".aws", ".env"],
  "telemetryMaxEvents": 10000,
  "telemetryMaxBytes": 8388608,
  "rateLimitWindowSeconds": 5,
  "rateLimitMaxBreakouts": 3
}
```

All roots must be relative and traversal-free. `protectedWorkspaceRoot` cannot
equal `projectRoot`; Krypton never defaults the protected boundary to a home
directory or filesystem root. `ignoredPaths` matches exact path components, not
substrings.

The daemon creates a workspace-specific socket, endpoint record, and capability
file under `.krypton/runtime/`. Directory mode is `0700`; socket, endpoint, and
capability files are `0600`. The raw capability is never returned by a dashboard
route or written to logs.

## Protected child lifecycle

Use `spawnProtectedProcess` from `src/core/processIsolation.cjs` for the native
lifecycle:

```js
const { spawnProtectedProcess } = require('./src/core/processIsolation.cjs');

const child = await spawnProtectedProcess('node', ['agent.js'], {
  cwd: 'sandbox_workspace',
  maxRuntimeMs: 60_000,
});
```

The launcher spawns the child, reads its PID/start time/executable/parent,
registers that exact generation, and unregisters it on exit, error, signal, or
timeout. If registration fails, it kills only the child it just spawned. Manual
dashboard isolation also requires the compound identity; PID-only requests are
rejected.

## Telemetry and health

`GET /api/telemetry?after=<sequence>&limit=<count>` returns one envelope for
native and demonstration states. `limit` defaults to 100 and is clamped to 250.
The ledger retains at most 10,000 events or 8 MiB, and the client retains at most
500 rows. Cursor polling reads a bounded tail window instead of parsing an
unbounded history on every poll.

With the dashboard running, inspect source and health:

```sh
curl --fail --silent http://localhost:3000/api/telemetry
```

Relevant fields are `source`, `nativeDaemonReachable`, `fallbackReason`,
`health`, `generatedAt`, `nextAfter`, and `hasMore`. Only `source: "native"`
events are native evidence.

## Security boundary

- Native control is versioned JSON Lines over a workspace-specific Unix socket.
- Every command includes a request ID and per-daemon capability.
- Peer credentials must match the daemon user where supported.
- Requests, responses, queued connections, workers, telemetry queues, API pages,
  ledger bytes/events, and client rows are bounded.
- Registration and isolation re-read live process identity to reject PID reuse.
- Deleted paths resolve through the nearest existing canonical ancestor.
- Escaping symlinks, parent traversal, and sibling-prefix confusion fail closed.
- Portable watcher events never increment a process counter or quarantine a
  process because `notify` provides no reliable actor PID.
- Pre-action denial applies only when an application explicitly asks Krypton's
  policy layer before performing an action. The portable filesystem watcher does
  not block arbitrary OS access before it occurs; OS-specific permission and
  endpoint-security adapters remain future work.
- Ledger write failures degrade daemon health.

See [THREAT_MODEL.md](THREAT_MODEL.md) for trust assumptions and limitations.

## Verification

```sh
npm run verify
npm run test:coverage
npm run security:audit
npm run benchmark:telemetry
```

Individual gates:

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run design-system:check
npm run rust:fmt
npm run rust:clippy
npm run rust:test
```

The benchmark reports serialization, cursor filtering, six polling cycles, a
100-event burst merge, bounded table projection, retained counts, and heap
growth for 100, 1,000, and 10,000 deterministic events.

## Troubleshooting

- **`cargo` or `rustc` not found:** install Rust through `rustup`, restart the
  shell if needed, and rerun the four prerequisite version checks.
- **C compiler or linker unavailable:** install the platform development
  toolchain. macOS requires Apple command-line developer tools; Linux requires
  the compiler and linker supported by that distribution.
- **Unsupported Windows native mode:** use `npm run dev:dashboard`. Windows
  native isolation is intentionally unavailable today.
- **Port 3000 already in use:** stop the process using the port or start the
  demonstration dashboard with `npm run dev:dashboard -- -p 3001`.
- **Stale Unix socket:** stop old daemon processes. Startup removes a socket only
  after a connection check proves it is stale; never delete a socket belonging
  to a running daemon.
- **Daemon endpoint missing:** start `npm run dev:daemon` and confirm
  `.krypton/runtime/daemon.json` is created with private permissions.
- **Mock mode versus degraded native mode:** `source: "mock"` with an unreachable
  daemon is demonstration mode. If the daemon is reachable, inspect
  `fallbackReason`; an invalid or unavailable native ledger is a degraded native
  state, not normal demonstration evidence.
- **`npm ci` lock mismatch:** release users should not normally encounter this.
  Use `npm ci` for clean setup. `npm install` is a maintainer recovery step: run
  it only to regenerate an intentionally changed lockfile, review the dependency
  diff, remove `node_modules`, and confirm `npm ci` succeeds afterward.

## Documentation

- [THREAT_MODEL.md](THREAT_MODEL.md) — trust boundaries and technical limitations.
- [SECURITY.md](SECURITY.md) — private vulnerability reporting and release integrity.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow and verification rules.
- [docs/CONTRIBUTION_SECURITY.md](docs/CONTRIBUTION_SECURITY.md) — contribution threat matrix and merge controls.
- [ROADMAP.md](ROADMAP.md) — planned engineering and research objectives.
- [VC.md](VC.md) — venture and product strategy material.

## Release archive

**Do not manually compress the repository folder. Use
`npm run release:package` and distribute only the generated archive.**

After committing the verified tree:

```sh
npm run release:package
```

The command runs preflight before archive generation, creates
`krypton-security.zip` with `git archive`, and inspects every ZIP entry for
forbidden paths. `git archive` intentionally contains only tracked files, so
ignored and untracked local dependencies, build output, telemetry, secrets, and
test residue are excluded. The generated ZIP is ignored and must not be
committed.

## Current limitations

- The portable watcher is post-event OS-backed telemetry, not pre-access kernel
  enforcement and not process attribution.
- No eBPF, Endpoint Security, fanotify permission, or Windows ETW adapter is
  implemented.
- A root/admin attacker or the same user with sufficient debugger/filesystem
  access can bypass local controls.
- TOCTOU remains possible between identity/path revalidation and operating-system
  action.
- Release signing, branch rules, secret scanning, and repository rulesets require
  repository-owner configuration.

## License

Krypton is distributed under the [ISC License](LICENSE).
