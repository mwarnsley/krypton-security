# Krypton run implementation plan

> Execute the user-approved design in this session with test-driven development;
> native receipt work is delegated while the supervisor is implemented locally.

**Goal:** Expose an authenticated execution supervisor without weakening compound
process identity or fabricating termination attribution.

**Architecture:** A CommonJS executable calls a core supervisor that reuses the
existing launcher and IPC transport. The launcher captures exit events before
registration awaits, waits for bounded native cleanup, and queries authenticated
receipts after SIGKILL. Rust retains bounded, expiring receipts keyed by complete
identity, atomically with successful isolation.

**Tech stack:** Node 20.19.4, npm 10.x, existing CommonJS core and typed declarations,
Vitest, Rust 1.97.0. No new dependencies.

**Spec:** User-approved design and seven implementation requirements in this thread.

## Constraints

- Preserve version 1 nested commands, capability authentication, discovery metadata,
  compound process identity, two-second IPC deadlines and 16 KiB frames.
- Preserve arguments and inherited stdio; supervisor diagnostics use stderr only.
- Never attribute SIGKILL without authenticated positive evidence.
- Native receipts: at most 1,024 complete identities, 60-second monotonic TTL.
- Publish only after repository verification; use the user's exact commit message.

## Tasks

- [x] Native receipt API: extend `process_registry.rs`, `process_identity.rs`, and
      `ipc.rs`; first test rejected authentication, failed signals, exact-identity
      matching, expiration, and capacity. Expose `termination_receipt` returning
      `process_isolated` or `termination_unconfirmed`, with existing envelope checks.
- [x] Launcher lifecycle: update `processIsolation.cjs` and `.d.cts`; first test
      early exit, spawn errors, registration rejection, once-only cleanup, and
      confirmed versus unknown SIGKILL. Add `startProtectedProcess` returning
      `{ child, registered, completed }`; preserve `spawnProtectedProcess` API.
- [x] Supervisor: add `src/core/supervisor.cjs`, `.d.cts`, `src/cli.cjs`, mirrored
      tests, and package bin metadata. Test exact `run -- command` parsing, health
      failure before spawn, inherited streams, forwarding, and exit status.
      `daemon:start` runs Cargo in the discovered checkout without a shell.
- [x] Integration and docs: exercise the executable against the disposable native
      fixture in `tests_simulation/test_injection.ts`. Synchronize README, FEATURES,
      ROADMAP, drawer and its tests; distinguish initial-child supervision from
      future descendant containment and OS-level pre-access protection.
- [ ] Verify: focused tests, formatting, lint, both TypeScript projects, all Vitest,
      Rust fmt/clippy/test, design-system, build, native simulation. Review diff,
      commit the requested message, run preflight and push origin/main.
