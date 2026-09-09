# Krypton feature ledger

This ledger describes implemented behavior. Its capability groupings are not
release phases; the versioned four-phase release plan and all planned work live
in `ROADMAP.md`.

## Capability 1: Local policy reference engine

- **Status:** Implemented
- Resolves paths against an explicit sandbox boundary and denies sensitive
  target segments.
- Provides authenticated disposable-child simulation coverage with a real native
  Unix socket, compound identity, SIGKILL, durable observational JSONL, and mocked
  desktop delivery. The simulation runs in a separate temporary runtime.
- TypeScript reference watcher events and failures remain `OBSERVED`; PID-only
  registration and watcher-triggered broadcast termination are disabled.
- Existing paths and missing-target parents are canonicalized; dangling symlinks,
  parent traversal, filesystem uncertainty, and escaping targets are denied.
- Keeps local reference tracking separate from the native daemon authority.

## Capability 1a: Authenticated execution supervisor

- **Status:** Implemented for the macOS source checkout; experimental on Linux.
- Exposes `krypton run -- <command> [args...]` through the package bin and
  `krypton daemon:start` for the foreground Cargo daemon. `npm link` exposes the
  executable; `node /absolute/path/to/src/cli.cjs` works without global linking.
- Discovers the configured checkout, checks authenticated healthy daemon status
  before spawning, and launches in its canonical protected workspace. Explicit
  `KRYPTON_PROJECT_ROOT` supports desktop hosts without working-directory control.
- Normalizes redundant discovery dot segments while requiring the exact absolute
  workspace socket/capability paths, rejecting traversal and socket symlinks.
  Rust canonicalizes its runtime directory before publishing discovery metadata.
  Local verification separates benign CLI startup, direct-read limitations, and
  the disposable authenticated-isolation simulation.
- Preserves literal arguments without a shell and inherits terminal streams;
  supervisor diagnostics use stderr, preserving MCP stdout.
- Resolves executable symlinks used by fnm/nvm/Homebrew to the same canonical
  target as the Node supervisor. Resolution failures deny native inspection.
  Registration accepts equivalent absolute client aliases with strict PID, start
  time, and parent checks, and pins the inspected canonical identity for signaling.
  Cleanup and receipt lookup retain the original registered client identity even
  if the alias disappears; a changed live target cannot inherit the registration.
- Registers complete initial-child identity, captures early exits, forwards
  SIGINT/SIGTERM, waits for bounded unregister, and preserves child exit codes.
  Rejected registration triggers owned-child cleanup; refused or timed-out cleanup
  is reported without falsely claiming termination or unregistering a live child.
- Confirms enforcement only through authenticated `termination_receipt` lookup.
  Rust records successful signals atomically with removal, using at most 1,024
  complete-identity receipts with a 60-second monotonic expiry. Unknown attribution
  remains explicit, including daemon restart, contention, eviction, and old daemons.
- Does not gate child execution until registration succeeds, automatically register
  descendant trees, attribute portable watcher events, or add kernel/network blocking.

## Capability 2: Native workspace telemetry and ownership

- **Status:** Implemented on macOS; experimental on Linux
- Loads separate `projectRoot` and `protectedWorkspaceRoot` configuration.
- Resolves existing, deleted, renamed, and symlinked paths through
  component-aware policy checks.
- Records portable watcher events as explicitly `unattributed`; it never assigns
  the same event to every registered child or claims that `notify` supplied a PID.
- Registers exact compound process identities containing PID, start time,
  executable path, and parent PID.
- Re-inspects a live process before isolation and rejects PID reuse, stale
  generations, unregistered identities, and daemon self-targeting.
- Dispatches an OS-level macOS Notification Center alert outside the browser
  only after an authenticated isolation request revalidates an owned child and
  confirms `SIGKILL` delivery. A bounded background worker invokes
  `/usr/bin/osascript` with a two-second execution deadline and kill/reap cleanup;
  banners use only trusted agent labels and PID, never raw executable basenames.
  Queue failures update atomic health without caller-side locks or stderr writes.
  Delivery denial, headless execution, and unavailable
  notification services degrade without changing the quarantine result.

## Capability 3: AegisAgent Dashboard Command Center

- **Status:** Implemented
- Returns one typed native/mock telemetry envelope with source, daemon
  reachability, fallback reason, generation time, health, and cursor metadata.
- Shows an accessible persistent demonstration banner; degraded native telemetry
  uses distinct wording from an unreachable daemon.
- Uses a compile-time static-export marker, with GitHub Pages host and local
  preview checks retained only as fallbacks, so custom-domain static builds are
  identified without depending on runtime hostname matching.
- Starts static demonstrations with an empty mock ledger, creates exactly one
  simulated threat only after explicit button activation, and never polls API
  routes that do not exist in the export.
- Keeps Audit-Only Mode local to the static demonstration while preserving
  authenticated daemon confirmation and failure notification in native local mode.
  Native toggles follow live `health.mode`; unknown mode disables the control.
- Aggregates watcher, IPC, ledger, registry, notification, and telemetry-queue
  health. Queue loss and component errors are degraded, not hardcoded readiness;
  unavailable registry counts are displayed as unavailable rather than zero.
- Labels ledger observations `OBSERVED`, never confirmed isolation based solely
  on process attribution. Successful authenticated action receipts display `ISOLATED`.
- Cycles through deterministic demonstration scenarios with slot-specific event
  IDs and never labels those scenarios as native evidence.
- Polls incrementally with one request in flight, abort-on-unmount, hidden-tab
  pause, immediate visibility refresh, stale-response rejection, Map-based
  deduplication, and a 500-row client bound.
- Uses bounded table pagination options `10, 25, 50, 75, 100`; unbounded `ALL`
  rendering is removed.
- Requires compound process identity for Force Isolate actions.
- Preserves portable watcher rows with a null PID as observed, unattributed
  evidence; attributed native identities include `parentPid` (number or null).
- Rejects mutation requests without JSON and matching loopback Host/Origin
  headers before daemon dispatch. Capabilities remain server-side; these browser
  guards do not authenticate remote clients, so loopback binding is required.
- Keeps Timeline Rewind signature downloads and dependency/process labels for
  events that carry reliable attribution.
- Provides a four-tab public Explainer Drawer whose FAQ mirrors the README,
  current platform support, registered-process boundary, and portable-watcher
  limitations.

## Capability 4: Public-release hardening

- **Status:** Implemented in repository; external settings remain owner-managed
- Uses an authenticated, versioned Unix-domain control socket with a private
  per-daemon capability, peer-user checks, timeouts, bounded payloads, four
  workers, and a 32-connection queue.
- Persists native events as one crash-safe bounded JSONL format with monotonic
  sequence IDs, a 10,000-event/8 MiB retention policy, corruption handling, and
  degraded ledger health.
- Recovery truncates only incomplete trailing JSON before append; interior
  corruption and non-monotonic sequences are rejected. Ledger compaction and IPC
  metadata publication use exclusive `0600` temporary files and sync the parent
  directory before and after atomic rename; pre-existing temporary paths are rejected.
- Enables strict dashboard TypeScript including unchecked-index, implicit-return,
  catch-variable, and exact-optional-property checks.
- Moves the composite data table into patterns and enforces semantic primitive
  tokens with a static compliance gate.
- Pins Node and Rust versions, exposes one `verify` command, SHA-pins GitHub
  Actions, and adds CODEOWNERS, Dependabot, CodeQL, dependency license-policy
  checks, and SBOM workflows.
- Publishes the actual ISC software license separately from dependency-policy
  checks and future signed-release provenance.
- Provides a clean-install lockfile verified with Node.js 20.19.4 and npm 10.8.2
  and records the exact package-manager version used to produce it.
- Documents clean-macOS Apple Silicon onboarding with Node 20 LTS v20.19.4,
  npm 10.x, and Rust 1.97.0 selected by rustup for the host architecture.
  The sequence is `npm ci`, `cargo check --manifest-path src/core-native/Cargo.toml`,
  and `npm run build`. `npm run dev:full` concurrently starts the native Unix
  socket daemon and Next.js 16 Turbopack dashboard. Keep port 3000 free or use
  `PORT=3001 npm run dev:full` after the port collision observed during QA.
  The README and public Explainer Drawer share this runtime guidance.
- Uses conventional `tests/` and `docs/CONTRIBUTION_SECURITY.md` paths so first
  contact with the repository is unambiguous.
- Packages tracked files only, runs release preflight before archive generation,
  and rejects forbidden or traversal-capable ZIP entries before distribution.

## Planned-direction boundary

The versioned plans in `ROADMAP.md` do not change this implemented-feature
ledger. In particular:

- No Tauri desktop application, installer, tray integration, paid tier, dynamic
  threat feed, snapshot rollback, AI incident explainer, or fleet control plane
  is implemented today. The implemented headless macOS notification adapter is
  daemon infrastructure, not a Tauri application or tray integration.
- Homebrew tap installation, the `get.krypton.dev` shell installer, and the
  sub-30-second time-to-first-containment objective are planned immediate Phase 2
  distribution work; those installation commands are not available today.
- The Phase 3 **Export Incident Brief / Share Kill-Cam** action and its sanitized
  Markdown, JSON, and image outputs are planned and are not implemented today.
- The separate `krypton-vulnerable-agent-demo` vulnerable-agent playground is a
  planned companion repository and is not currently published from this codebase.
- A planned Phase 3 Windows Tauri application initially provides only the desktop
  shell and explicitly simulated demonstration data. True Windows native
  containment requires the Phase 4 Named Pipe and Job Object runtime.
- The target open-core matrix keeps individual local containment equally
  available across Free, Pro, and Enterprise after each supported platform ships;
  commercial entitlements must not weaken or remotely gate the local policy loop.

## How to verify

```sh
npm ci
npm run verify
npm run test:coverage
npm run security:audit
npm run benchmark:telemetry
```

Manual native checks are listed in `README.md` and `THREAT_MODEL.md`.
