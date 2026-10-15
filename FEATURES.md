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
  before spawning, reuses a healthy daemon, or automatically starts the compiled
  binary when unavailable. Readiness is bounded to three seconds after host spawn; the initial
  1500 ms IPC probe and filesystem preparation are separate. Authentication,
  malformed discovery, degraded health, and startup failure deny target launch.
  All release candidates precede debug candidates across `CARGO_TARGET_DIR`
  (absolute or relative to the checkout), root and core-native target directories.
  A detached Node host owns the native daemon beyond MCP disconnect; each client
  still registers/unregisters its own initial child. Authentication failures and
  degraded daemons are never replaced automatically. Combined native stdout/stderr
  goes to private `.krypton/logs/daemon.log`, capped at 64 KiB then discarded, and
  atomically replaced per startup attempt without mixing existing host output.
  The visible log can describe a losing concurrent starter; the telemetry ledger
  is unaffected. Native output may contain private paths; redact before
  sharing. Launches the target
  in its canonical protected workspace. Explicit
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
- Recovers one refused/disconnected registration handshake by refreshing authenticated
  health/discovery and revalidating the exact child identity before retrying.
  Native registration is idempotent only for that same independently inspected,
  pinned identity. Stale identities, authentication failures, timeouts and degraded
  health still deny; tool writes and isolation are never replayed. Only the native
  starter under `startup.lock` removes refused orphan sockets, never live sockets.
- Registers complete initial-child identity, captures early exits, forwards
  SIGINT/SIGTERM and `beforeExit` shutdown, cancels pending registration recovery,
  waits for bounded unregister after child exit, and preserves nonzero child exit
  codes. Lifecycle failure upgrades a zero child status to 1.
  Rejected registration triggers owned-child cleanup; refused or timed-out cleanup
  is reported without falsely claiming termination or unregistering a live child.
- Confirms enforcement only through authenticated `termination_receipt` lookup.
  Rust records successful signals atomically with removal, using at most 1,024
  complete-identity receipts with a 60-second monotonic expiry. Unknown attribution
  remains explicit, including daemon restart, contention, eviction, and old daemons.
- Does not gate child execution until registration succeeds, automatically register
  descendant trees, attribute portable watcher events, or add kernel/network blocking.

## Capability 1b: Standalone bundle, source setup, and native MCP file tools

- **Status:** Standalone packaging and source-checkout paths are implemented for
  macOS arm64/x64; hosted workflow execution, Gatekeeper behavior, and clean-machine
  Claude Desktop onboarding still require manual or hosted verification. Linux
  client-path detection is supported but native Linux control remains experimental.
- `npm run setup` and `krypton setup` detect existing Claude Desktop, Cursor,
  Claude Code and Cline storage; atomically back up and merge bounded settings
  with canonical supervisor paths and `KRYPTON_PROJECT_ROOT`. Other servers
  remain intact; malformed files, symlinks and conflicting Krypton entries fail.
- `scripts/Install-Mac.command` invokes shared source setup from its checkout and
  attempts a bounded macOS completion notification only after setup succeeds.
  Node on PATH, installed source dependencies, and a release native build are
  prerequisites; the script does not install Node, Rust, dependencies, or a login
  service. Client connection triggers automatic daemon startup; the setup completion
  notice does not claim active containment. Notification
  failure returns nonzero while preserving any settings already written.
- `scripts/Install-Windows.cmd` invokes shared setup when Node is available and
  reports unsupported native containment without editing client settings.
  Windows remains demonstration-only; Linux retains experimental terminal setup.
- Claude Desktop can open the macOS `.mcpb` by double-click, with Settings >
  Extensions installation as a fallback. The generated MCPB 0.3 manifest remains
  macOS-only because the archive includes only arm64/x64 Mach-O daemons.
- The README opens with a macOS alpha quickstart: latest-release bundle import,
  optional extracted-bundle JSON configuration, and authorized-write/denied-read
  prompts. The Field Guide mirrors these verification checks. The two-minute
  onboarding target remains unverified on clean tester machines.
- The Field Guide and README separate file-denial receipts (`INTERCEPTED`) from
  process-isolation banners and installer notices, and document missing-tool,
  Gatekeeper, timeout, and workspace-permission recovery. Pages is static mock
  data and never a live workstation verification surface. The local-file bridge
  remains planned for Phase 2; the source viewer does not automatically attach to
  standalone Application Support ledgers.
- `npm run build:mcpb` generates an unsigned and unnotarized deterministic MCPB
  0.3 archive at `dist/krypton-protected-fs.mcpb`. It contains the MCP server,
  standalone launcher, verified arm64/x64 native binaries, architecture metadata,
  and only their runtime dependencies. Installed dependency versions must match
  the lockfile; checkout state, telemetry, secrets, and dev packages are excluded.
  Building requires both matching optimized native inputs. The installed bundle
  requires no checkout or Rust toolchain and does not launch the Next.js dashboard.
- The optional `protected_workspace_root` selects an existing canonical directory.
  Omitted or whitespace-only input creates
  `~/Library/Application Support/KryptonSecurity/sandbox_workspace`; invalid
  nonblank input fails. A SHA-256 workspace ID names private persistent instance
  state without exposing the raw workspace path in filenames.
- The standalone launcher selects the bundled Mach-O for the host architecture,
  verifies it before private atomic installation, publishes a private standalone
  configuration, spawns the daemon directly, requires authenticated healthy
  readiness, and supervises that exact child through MCP EOF, signals, daemon exit,
  and server failure. A separate instance lock prevents concurrent daemons for one
  workspace even when their short temporary runtime homes differ.
- Error handling follows the mandatory three-tier contract in `AGENTS.md`:
  typed native errors, 1500 ms absolute authenticated IPC deadlines, immediate
  disconnect denial, bounded stdio output waits, and redacted CLI failures on
  stderr with nonzero status. Uncertain write durability requires review.
- The stdio MCP server uses local Ajv JSON Schema 2020-12 validation, bounded
  32 KiB frames, constant session state and serialized native dispatch. It
  exposes only `krypton_read_file` and `krypton_write_file`, with 1 KiB paths and
  2 KiB UTF-8 content. There is no shell or remote policy evaluation.
- Authenticated native `mcp_file` IPC performs path checks and directory-relative
  no-follow file access in Rust. Reads reject special files, hardlinks and
  invalid UTF-8; writes atomically replace regular files with private defaults.
  Parent directories must exist; `.krypton-mcp-` basenames and case variants
  are reserved for native staging. Host tampering and concurrent directory moves
  are not covered by kernel isolation.
- Both runtime modes deny unsafe MCP file operations with `isError: true`
  inside the JSON-RPC result. Denials return native receipts and enqueue bounded
  telemetry, without terminating the server or inventing a process identity.
  Queue admission is distinct from durability; queue/write failures degrade health.
- Native MCP dashboard evidence displays `INTERCEPTED`, the requested path,
  timestamp and tool name. Portable watcher evidence remains `OBSERVED`.
- `npm run test:e2e` (also available as `npm run test:sim`) verifies production
  stdio through the supervisor, real native reads/writes, traversal denial in both
  modes, durable receipts mapped to `INTERCEPTED`, and fail-closed socket loss.
  A disposable native fixture owns all runtime files and children; desktop
  notification delivery is mocked. Client installation does not intercept
  built-in tools or provide descendant control.
- `npm run test:mcpb -- <archive>` extracts only an allowlisted archive inventory
  into bounded temporary state, isolates HOME and working directories, and verifies
  custom and fallback workspaces, traversal denial, durable standalone telemetry,
  exact-child exit, and post-exit socket nonacceptance without checkout markers.
  The private temporary runtime home may retain runtime files after shutdown. A
  local run covers only its host architecture; release automation defines separate
  arm64 and x86_64 jobs.

## Capability 2: Native workspace telemetry and ownership

- **Status:** Implemented on macOS; experimental on Linux
- Loads separate `projectRoot` and `protectedWorkspaceRoot` configuration.
- Standalone mode instead loads one bounded private absolute-path configuration,
  keeps runtime/configuration and telemetry outside the protected root, and stores
  its bounded ledger beneath
  `~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl`.
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

## Capability 3: Krypton Security Dashboard Command Center

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
  The native initial mode is `audit_only`, which preserves unsafe MCP file denials.
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
- Presents the same sorted, paginated alerts as a desktop table or mobile/tablet
  cards. Cards preserve process attribution and action permissions, wrap access
  paths, and expand complete signatures on tap or keyboard activation. Header
  controls wrap independently of the title; the wide Field Guide comparison
  remains horizontally scrollable on smaller screens.
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
  The source sequence is `npm ci`,
  `cargo build --release --manifest-path src/core-native/Cargo.toml`,
  `scripts/Install-Mac.command`, then restarting clients. `npm run dev:dashboard`
  optionally opens the source ledger viewer at localhost:3000; use
  `npm run dev:dashboard -- -p 3001` if occupied. `npm run dev:full` is optional
  foreground development only and is not required for protection.
  The README and public Explainer Drawer share this runtime guidance.
- Uses conventional `tests/` and `docs/CONTRIBUTION_SECURITY.md` paths so first
  contact with the repository is unambiguous.
- Packages tracked files only, runs release preflight before archive generation,
  and rejects forbidden or traversal-capable ZIP entries before distribution.

## Capability: Release hardening contracts

- `.github/workflows/ci.yml` defines the reusable macOS **Phase 1 verification**
  gate for main PRs/pushes: lint/typechecks, format, Clippy, Vitest/native tests,
  source simulation/E2E, the dashboard build, and a zero-vulnerability npm audit
  including dev packages.
- `.github/workflows/release.yml` validates matching SemVer tags and main ancestry,
  runs the same gates, builds optimized Intel/Apple Silicon macOS daemons, downloads
  both into one bundle job, byte-compares both embedded entries, and runs packaged
  E2E on matching arm64/x86_64 hosts. Only then may the write-scoped draft job
  create a release with the exact three primary assets, per-asset SHA-256 files,
  and `SHA256SUMS`. Existing releases are not overwritten; publication remains manual.
- `scripts/release-artifacts.cjs` bounds and verifies the exact release inventory,
  rejects redirected/modified assets and emits typed failure diagnostics.
- `docs/RELEASE.md` specifies required main checks, owner approval/signature rules
  and least-privilege fine-grained GitHub MCP/`gh` token handling. Branch protection,
  hosted runs, release signing/notarization, Gatekeeper behavior, and clean-machine
  desktop QA require separate verification.

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
