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
- Queues a redacted macOS Notification Center alert after a confirmed native
  quarantine without blocking the enforcement request.

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

- macOS: Native Daemon Mode is actively supported and tested. It provides
  Unix-domain socket control, live process identity validation, and Unix signal
  isolation, plus redacted OS-level alerts for confirmed quarantines.
- Linux: native support is planned and currently experimental. The native daemon
  may build on compatible distributions, but it is not part of the actively
  supported and tested rollout yet.
- Windows: strictly dashboard-only demonstration mode. Native control and native
  isolation are unsupported until a restrictive named-pipe ACL and
  process-generation adapter are implemented.

## Architecture

```text
[Protected launcher]
      │ spawn → inspect PID/start/executable/parent → authenticated register
      ▼
[Rust daemon process registry] ◄──── authenticated Unix socket ──── [Next API]
      │ exact-generation revalidation                                 │
      ├─ isolate only registered identity                             ▼
      └─ confirmed SIGKILL → bounded alert queue → macOS Notification Center
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
- Experimental Linux native builds require a working C compiler and linker
  appropriate to the distribution.
- Windows is strictly dashboard-only demonstration mode and does not require
  Rust.

## Setup

### macOS Native Daemon Mode (actively supported and tested)

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security
npm ci
npm run dev:full
```

`dev:full` starts both the Rust daemon and Next.js dashboard. Open
`http://localhost:3000`. After a confirmed native quarantine, the daemon queues
a macOS Notification Center banner outside the browser. The banner identifies
only the sanitized agent executable name and PID; it never includes an event
path or credential detail. macOS may suppress delivery when notifications are
denied or no interactive desktop session is available, but that does not alter
the quarantine result.

Linux native support is planned and currently experimental; it is not yet part
of the actively supported and tested Native Daemon Mode rollout. Windows must
use the dashboard-only demonstration setup below.

## Running Your First Live Simulation

> **LIVE END-TO-END CHECK:** Keep `npm run dev:full` running while you launch
> the simulation from a second terminal window.

This live simulation requires a Mac. The current macOS Native Daemon Mode is
required to intercept the local mock agent breakout event; Linux is still
experimental, and Windows dashboard-only demonstration mode cannot perform this
interception.

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
   recorded in the telemetry ledger. In an interactive macOS session where
   notifications are permitted, Krypton also queues an OS-level quarantine
   banner.
4. Return to the dashboard. The Next.js UI instantly streams the new
   **CRITICAL** alert row into its live ledger, giving you visible confirmation
   that the complete path from attack detection and blocking through telemetry
   persistence and dashboard delivery is fully operational.

### Dashboard-only demonstration mode

This is the only supported Windows onboarding path. It is also useful on macOS
or experimental Linux environments when Rust or native mode is unavailable.

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

The static GitHub Pages demo begins with an empty simulated ledger. A threat row
is created only when you select **Simulate Threat Event**. In that static
demonstration, the Audit-Only Mode toggle changes local UI state only: it does
not contact the native daemon or represent real containment. Native local mode
continues to require authenticated daemon confirmation and rolls the toggle back
when confirmation fails.

To run only the actively supported native daemon on macOS:

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
- Desktop alerts are downstream, non-authoritative effects emitted only after
  authenticated isolation of a revalidated owned child succeeds. They contain
  no path or secret data, and delivery failure cannot reverse enforcement.
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
  toolchain. macOS requires Apple command-line developer tools. Experimental
  Linux builds require the compiler and linker supported by that distribution.
- **Unsupported Windows native mode:** use `npm run dev:dashboard`. Windows is
  strictly dashboard-only demonstration mode; native isolation is intentionally
  unavailable today.
- **Port 3000 already in use:** stop the process using the port or start the
  demonstration dashboard with `npm run dev:dashboard -- -p 3001`.
- **Stale Unix socket:** stop old daemon processes. Startup removes a socket only
  after a connection check proves it is stale; never delete a socket belonging
  to a running daemon.
- **Daemon endpoint missing:** start `npm run dev:daemon` and confirm
  `.krypton/runtime/daemon.json` is created with private permissions.
- **macOS quarantine banner missing:** confirm the daemon is running in an
  interactive macOS desktop session and review Notification settings for the
  process hosting `/usr/bin/osascript`. Headless sessions and denied
  notifications can suppress the banner; inspect daemon diagnostics and the
  native telemetry ledger for the authoritative quarantine result.
- **Mock mode versus degraded native mode:** `source: "mock"` with an unreachable
  daemon is demonstration mode. If the daemon is reachable, inspect
  `fallbackReason`; an invalid or unavailable native ledger is a degraded native
  state, not normal demonstration evidence.
- **`npm ci` lock mismatch:** release users should not normally encounter this.
  Use `npm ci` for clean setup. `npm install` is a maintainer recovery step: run
  it only to regenerate an intentionally changed lockfile, review the dependency
  diff, remove `node_modules`, and confirm `npm ci` succeeds afterward.

## Frequently Asked Questions (FAQ)

<details>
<summary>1. What is Krypton in simple terms?</summary>

Krypton is a lightweight local runtime boundary for developers using AI tools,
package scripts, and automated commands. Integrations that use Krypton's policy
and protected launcher can keep approved file mutations within the configured
workspace; actions outside those integration points are not automatically
contained.

</details>

<details>
<summary>2. Is Krypton an antivirus program?</summary>

No. Antivirus software typically scans files for known or suspicious malware.
Krypton makes deterministic path-policy and registered-process decisions.
Portable filesystem notifications remain post-event telemetry and do not
identify or automatically stop the actor that caused them.

</details>

<details>
<summary>3. Does Krypton slow down my computer or development workflow?</summary>

Krypton is designed for bounded, low-overhead local checks rather than full-disk
indexing. Repeated policy membership uses native `Set` or `Map` lookups with
average O(1) cost, while path normalization remains O(L) in path length.
Telemetry persistence is asynchronous and core security loops make no remote
calls.

</details>

<details>
<summary>4. Does Krypton send my code, files, or telemetry to the cloud?</summary>

Core security decisions do not send source code, files, or telemetry to cloud
services. Native events stay in the bounded local
`.krypton/telemetry/alerts.jsonl` ledger. The dashboard includes an external
GitHub link that opens only when selected, and demonstration rows are explicitly
mock data.

</details>

<details>
<summary>5. What is the difference between Audit-Only Mode and Enforcement Mode?</summary>

Audit-Only Mode records integrated policy violations without requesting process
termination. Enforcement Mode denies integrated out-of-bounds actions and may
quarantine only an owned, registered child after its PID, start time, executable
path, and parent PID are revalidated. Portable watcher events alone never
authorize arbitrary PID isolation.

</details>

<details>
<summary>6. How does Krypton reduce the risk of indirect prompt injection?</summary>

Krypton reduces risk without trying to classify natural-language prompts. When
a tool integrates with the policy layer or protected launcher, a request such as
`cat ~/.ssh/id_rsa` can be rejected before the action proceeds. The portable
filesystem watcher alone is post-event evidence, so Krypton does not claim
universal pre-access prevention.

</details>

<details>
<summary>7. Which operating systems are currently supported?</summary>

macOS is the actively supported and tested native runtime. Linux native control
currently remains experimental. Windows supports dashboard-only demonstration
mode, not native isolation. Phase 3 plans a Windows Tauri shell with simulation
and demo behavior only; true Windows containment requires the Phase 4 Named Pipe
and Job Object runtime. Linux Landlock and seccomp-bpf adapters are also planned
for Phase 4. None of those future controls are available today.

</details>

<details>
<summary>8. Can host malware disable or manipulate Krypton?</summary>

A same-user or administrator-level attacker may still disable or tamper with
Krypton; it is not a root security boundary. Krypton reduces local attack
surface with a `0700` runtime directory, `0600` socket and capability files,
authenticated local commands, peer-user checks, and compound process identity
validation. Dashboard audit-mode and termination requests require JSON and
matching loopback Host and Origin headers (localhost or 127.0.0.1); daemon
capabilities remain server-side. These browser request guards are not caller
authentication: keep the dashboard bound to loopback, because non-browser clients
can forge headers.

</details>

<details>
<summary>9. How does Krypton handle path traversal and symlinks?</summary>

Existing targets are canonicalized. Missing or deleted targets resolve through
the nearest existing canonical ancestor plus a validated lexical tail. Parent
traversal, escaping symlinks, and sibling-prefix confusion fail closed rather
than being silently stripped. A documented time-of-check/time-of-use risk
remains between validation and the operating-system action.

</details>

<details>
<summary>10. How do I run the project locally?</summary>

Clone the repository, enter `krypton-security`, run `npm ci`, and use
`npm run dev:full` for the actively supported macOS native daemon and dashboard.
In a second terminal, run `npm run test:sim`. For a cross-platform mock dashboard
without native isolation, run `npm run dev:dashboard`.

</details>

<details>
<summary>11. What happens if I set my AI agent to 'Auto', 'Bypass Permissions', or YOLO mode?</summary>

Krypton operates independently of an AI agent's internal approval settings.
Auto, Bypass Permissions, and YOLO modes remove the agent's own prompts, but
they do not bypass controls for actions routed through Krypton's policy layer
and protected launcher. In Enforcement Mode, an integrated out-of-bounds file
request is denied, and Krypton may quarantine only an explicitly registered
child after revalidating its PID, start time, executable path, and parent PID;
the current Unix native runtime uses SIGKILL. Portable filesystem events remain
post-event and unattributed, tools outside Krypton's integration are not
automatically contained, and outbound-network enforcement remains planned.
These agent modes therefore increase the importance of launching the agent
through Krypton rather than providing universal protection by themselves.

</details>

## Release roadmap

The authoritative milestones and security acceptance criteria live in
[ROADMAP.md](ROADMAP.md). Planned features below do not expand Krypton's current
enforcement boundary.

1. **Phase 1 — Native macOS Hardening & Public Launch (v1.0):** the native
   daemon, `.krypton/runtime/daemon.sock` IPC, bounded local telemetry dashboard,
   offline policy loop, GitHub Pages demonstration, and redacted OS-level macOS
   quarantine alerts are implemented. Phase 1 is complete and launch-ready.
2. **Phase 2 — Transparent Developer Experience & Zero-Config CLI (v1.1):**
   planned `krypton exec -- <command>` protected launching and capability-aware
   Safe Auto-Pilot host integrations, plus standalone Homebrew and verified
   shell-script distribution with a sub-30-second time-to-first-containment
   target. `brew install krypton-security/tap/krypton` and
   `curl -fsSL https://get.krypton.dev | sh` are planned commands and are not
   available installation paths today.
3. **Phase 3 — Native Desktop Application & Developer Convenience
   (v1.2–v1.3):** planned Tauri packaging for macOS and Windows, system-tray
   status, richer application-owned notifications, validated `.kryptonrc` and
   session exceptions, evidence-labeled agent tagging, and a sanitized **Export
   Incident Brief / Share Kill-Cam** action. The initial Windows application is
   a shell and simulation/demo experience, not native containment.
4. **Phase 4 — Enterprise Cross-Platform Containment & Fleet Systems (v2.0):**
   planned Windows Named Pipes and Job Objects, Linux Landlock and seccomp-bpf
   adapters, and opt-in enterprise fleet governance. Only this phase activates
   true Windows native containment.

The planned companion `krypton-vulnerable-agent-demo` repository will provide a
disposable vulnerable-agent playground for demonstrating prompt-injection and
path-traversal behavior in Audit-Only and Enforcement modes. It is not currently
published or included in this repository.

### Commercial direction (target state)

Krypton's open-core plan keeps unlimited individual workstation containment
free, private, and unrestricted. Planned paid tiers monetize power-user
recovery and incident explanation or enterprise fleet visibility, organization
policy, identity, and compliance evidence. The target entitlement matrix and
directional pricing—Free at $0, Pro at approximately $10–$15 per user per month,
and Enterprise at approximately $25–$40 per seat per month—are documented in
[ROADMAP.md](ROADMAP.md). They are planning guidance, not current product
availability or a published commercial offer.

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
