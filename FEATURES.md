# Krypton feature ledger

This ledger describes implemented behavior. Planned work remains in `ROADMAP.md`.

## Phase 1: Local policy reference engine

- **Status:** Implemented
- Resolves paths against an explicit sandbox boundary and denies sensitive
  target segments.
- Provides controlled disposable-child simulation coverage.
- Keeps local reference tracking separate from the native daemon authority.

## Phase 2: Native workspace telemetry and ownership

- **Status:** Implemented on macOS and Linux
- Loads separate `projectRoot` and `protectedWorkspaceRoot` configuration.
- Resolves existing, deleted, renamed, and symlinked paths through
  component-aware policy checks.
- Records portable watcher events as explicitly `unattributed`; it never assigns
  the same event to every registered child or claims that `notify` supplied a PID.
- Registers exact compound process identities containing PID, start time,
  executable path, and parent PID.
- Re-inspects a live process before isolation and rejects PID reuse, stale
  generations, unregistered identities, and daemon self-targeting.

## Phase 3: AegisAgent Dashboard Command Center

- **Status:** Implemented
- Returns one typed native/mock telemetry envelope with source, daemon
  reachability, fallback reason, generation time, health, and cursor metadata.
- Shows an accessible persistent demonstration banner; degraded native telemetry
  uses distinct wording from an unreachable daemon.
- Cycles through deterministic demonstration scenarios with slot-specific event
  IDs and never labels those scenarios as native evidence.
- Polls incrementally with one request in flight, abort-on-unmount, hidden-tab
  pause, immediate visibility refresh, stale-response rejection, Map-based
  deduplication, and a 500-row client bound.
- Uses bounded table pagination options `10, 25, 50, 75, 100`; unbounded `ALL`
  rendering is removed.
- Requires compound process identity for Force Isolate actions.
- Keeps Timeline Rewind signature downloads and dependency/process labels for
  events that carry reliable attribution.

## Phase 4: Public-release hardening

- **Status:** Implemented in repository; external settings remain owner-managed
- Uses an authenticated, versioned Unix-domain control socket with a private
  per-daemon capability, peer-user checks, timeouts, bounded payloads, four
  workers, and a 32-connection queue.
- Persists native events as one crash-safe bounded JSONL format with monotonic
  sequence IDs, a 10,000-event/8 MiB retention policy, corruption handling, and
  degraded ledger health.
- Enables strict dashboard TypeScript including unchecked-index, implicit-return,
  catch-variable, and exact-optional-property checks.
- Moves the composite data table into patterns and enforces semantic primitive
  tokens with a static compliance gate.
- Pins Node and Rust versions, exposes one `verify` command, SHA-pins GitHub
  Actions, and adds CODEOWNERS, Dependabot, CodeQL, audit, license, and SBOM
  workflows.
- Adds clean archive/preflight scripts plus repository ignore and line-ending
  policy.

## How to verify

```sh
npm ci
npm run verify
npm run test:coverage
npm run security:audit
npm run benchmark:telemetry
```

Manual native checks are listed in `README.md` and `THREAT_MODEL.md`.
