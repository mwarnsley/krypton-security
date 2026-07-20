# Krypton

Krypton is an experimental local runtime boundary for explicitly registered
child processes. It combines a Rust filesystem telemetry daemon, an authenticated
local control channel, a TypeScript launcher seam, and a Next.js dashboard.

Krypton does not claim that a portable filesystem notification identifies the
process that caused it. The `notify` watcher reports paths and event kinds. Those
events are stored as `unattributed`; process isolation is permitted only when a
caller supplies an exact child-process identity that the daemon previously
validated and registered.

## Supported platforms

- macOS and Linux: native daemon, Unix-domain socket control, live process
  identity validation, and Unix signal isolation.
- Windows: dashboard-only demonstration mode. Native control is intentionally
  unsupported until a restrictive named-pipe ACL and process-generation adapter
  are implemented.

Required versions are pinned in `.node-version` and `rust-toolchain.toml`:

- Node.js 20.19.4
- Rust 1.97.0

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

## Clean setup

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security
npm ci
npm run dev:full
```

`dev:full` starts the native daemon and dashboard together. Open
`http://localhost:3000`.

Dashboard-only mode:

```sh
npm run dev:dashboard
```

Native-only mode:

```sh
npm run dev:daemon
```

When native control is unavailable, the dashboard displays this persistent
warning: “Demonstration mode — native telemetry is unavailable. Events shown
below are simulated.” If the daemon is reachable but its ledger is degraded or
invalid, the banner explicitly says that native telemetry could not be
validated.

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
- Ledger write failures degrade daemon health.

See `THREAT_MODEL.md` for trust assumptions and limitations.

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

- `source: "mock"`, daemon unreachable: start `npm run dev:daemon` and confirm
  `.krypton/runtime/daemon.json` exists.
- `source: "mock"`, daemon reachable: inspect `fallbackReason`; ledger failures
  are not hidden as normal demonstration mode.
- `npm ci` lock mismatch: run `npm install`, review the lockfile change, then
  repeat `npm ci` from a clean dependency state.
- stale socket: stop old daemon processes. Startup removes a socket only after a
  connection check proves it is stale.
- Windows: use dashboard demonstration mode; native isolation is not supported.

## Release archive

After committing the verified tree:

```sh
npm run release:preflight
npm run release:archive
```

The preflight requires a clean tree, rejects tracked generated/secret-like
files, and runs the full verification suite. `git archive` packages tracked
files only; the generated ZIP is ignored and must not be committed.

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

The package metadata currently declares ISC. A standalone license file remains a
publication requirement.
