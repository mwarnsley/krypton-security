# Krypton

## Quick Start & Installation

### Method 1: Zero-Terminal Double-Click (macOS Claude Desktop — Recommended)

1. Download `krypton-protected-fs.mcpb` from
   [GitHub Releases](https://github.com/mwarnsley/krypton-security/releases).
2. Double-click the downloaded `.mcpb` to open Claude Desktop and confirm installation.
   If file association is unavailable, use **Settings → Extensions → Advanced settings
   → Install Extension** and select the file. Organization policies may require IT approval.
3. Configure the extension. You may select an existing directory for
   `protected_workspace_root`. If you omit it or leave it blank, Krypton creates
   and protects `~/Library/Application Support/KryptonSecurity/sandbox_workspace`.

The macOS bundle contains both arm64 and x64 native daemons. Its launcher selects
the host binary, installs a verified private copy beneath Application Support,
starts it for the MCP session, performs an authenticated readiness check, and
stops the exact child when the session ends. This route requires no Git clone or
Rust toolchain. It contains `krypton_read_file` and `krypton_write_file`; Claude's
built-in filesystem, shell, and network tools remain outside Krypton's boundary.
The standalone bundle does not include or launch the Next.js dashboard.

The release artifacts are currently unsigned and unnotarized. Gatekeeper
behavior and installation in a clean-machine Claude Desktop environment remain
manual release gates; verify the release checksums before use.

### Method 2: Source checkout in three steps

Source development requires Node.js 20.19.4, npm 10.x, Rust 1.97.0 through
`rustup`, and the macOS command-line developer tools. The setup script does not
install Node, Rust, dependencies, or the native binary.

1. Clone and prepare the checkout:

   ```bash
   git clone https://github.com/mwarnsley/krypton-security.git
   cd krypton-security
   npm ci
   cargo build --release --manifest-path src/core-native/Cargo.toml
   ```

2. Close Claude Desktop, Cursor, Claude Code and Cline, then double-click
   `scripts/Install-Mac.command` inside the checkout. It opens Terminal and runs
   the shared setup engine. Node must be on PATH; alternatively run `npm run setup`
   from your configured terminal. Keep the script inside the checkout.
3. Restart Claude Desktop and use `krypton_read_file` or `krypton_write_file`.
   The configured `src/cli.cjs run` launcher reuses a healthy authenticated daemon
   or starts the compiled daemon automatically. No development terminal is required
   for protection; closing the MCP client leaves the source daemon running.

The checkout setup path configures detected clients with an absolute
`KRYPTON_PROJECT_ROOT`. To view source telemetry optionally run
`npm run dev:dashboard` and open <http://localhost:3000>. The dashboard does not
start the daemon and is not required for protected MCP tools.

### Source-checkout setup notices

The engine detects installed client storage, preserves other settings, and
atomically backs up and merges JSON. Review each configured/skipped/failed row.
A bounded `osascript` completion notice means setup finished, not that a daemon
is running or containment is active. Notification failure returns exit 1 without
rolling back settings. No privileged installation or login service is added. The
source launcher starts a detached daemon when a configured client connects, not during setup.

`scripts/Install-Windows.cmd` reports unsupported native setup and exits 1
without modifying client settings. If Node is installed it invokes the shared
engine; otherwise it reports the missing prerequisite as well. Windows remains
**dashboard demonstration-only**, and the MCPB declares only macOS compatibility.
Linux retains its existing experimental terminal setup path.

### Verifying Installation (Live Smoke Test)

1. On macOS, fully quit Claude Desktop with **Cmd + Q** and reopen it. Source
   installs auto-start their compiled daemon; standalone MCPB supervises its own.
2. Open the tools / **+ → Connectors** menu and verify `krypton_read_file` and
   `krypton_write_file`. Developer settings and extension logs show connection status.
3. With the default protected workspace, submit:

   > Can you use your krypton_read_file tool to inspect the contents of /etc/passwd?

4. Confirm an actual Krypton tool call returns a native denial receipt with
   `isError: true`, not file contents. A model refusal without a tool call proves
   nothing about the runtime. Native denial evidence is queued for the ledger and
   rendered as `INTERCEPTED` by the local dashboard; queue admission is not proof
   of durable persistence. `/etc/passwd` must remain outside your selected workspace.

**A file denial does not trigger a desktop quarantine banner.** Banners accompany
confirmed isolation of an owned, registered child, and OS permissions/headless
sessions can suppress delivery. The installer completion notice is separate.
`npm run test:e2e` verifies isolated containment with mocked desktop delivery;
it does not prove live Notification Center behavior.

Source telemetry lives at `.krypton/telemetry/alerts.jsonl`. Standalone evidence
lives at `~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl`.
The source dashboard does not automatically attach to standalone instance ledgers.
The public GitHub Pages dashboard is a static demonstration and cannot inspect
local sockets or show your native workstation events. A local-file telemetry
bridge is planned for Phase 2; it is not available today.

The generated manifest is owned by `createManifest` in
`src/packaging/build_mcpb.cjs`; there is no separate source `manifest.json` to edit.
Its MCPB 0.3 required metadata, Node entry point, bundle-relative launch arguments,
optional directory setting, and `darwin` compatibility match the
[official manifest specification](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md).
Schema compatibility alone does not make the bundled Mach-O daemons run on Windows.
See [Claude Desktop installation guidance](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
for current client UI and organization policy controls.

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
[Claude / other MCP client]
      │ source setup invokes src/cli.cjs run
      ▼
[Node supervisor: daemon readiness + owned-child registration/lifecycle]
      │ starts MCP child; preserves JSON-RPC stdout
      ▼
[MCP server: validates JSON-RPC and the two file tools]
      │ authenticated mcp_file IPC; no arbitrary syscall interception
      ▼
[Rust daemon: path policy + descriptor-relative file read/write]
      ├─ compound process identity registry → live revalidation
      │    → SIGKILL only for an owned registered child → confirmed quarantine alert
      └─ bounded, compacted JSONL ledger → local Next.js API → dashboard

[OS filesystem notifications] → unattributed observations → bounded JSONL ledger
      └─ never authorize a process signal

[GitHub Pages] → mock data only (local-file bridge planned for Phase 2)
```

The project root contains Krypton configuration and the dashboard. The protected
workspace root is a narrower directory in which a protected child is authorized
to mutate files. They are not interchangeable.

## Source development prerequisites

Confirm the toolchain before setup:

```sh
node --version
npm --version
rustc --version
cargo --version
```

- **Node.js v20.19.4 (Node 20 LTS baseline) and npm 10.x:** `.node-version`
  pins Node; `package.json` records npm 10.8.2. Accept runtime version-manager
  prompts (including `.nvmrc` prompts if available in your environment).
- **Rust toolchain manager (`rustup`) and Cargo:** `rust-toolchain.toml` pins
  Rust 1.97.0 and automatically selects and syncs the host toolchain during
  builds. On macOS Apple Silicon, this is `1.97.0-aarch64-apple-darwin`;
  other hosts use their matching architecture.
- macOS native builds require Apple command-line developer tools.
- Experimental Linux native builds require a working C compiler and linker
  appropriate to the distribution.
- Windows is strictly dashboard-only demonstration mode and does not require
  Rust.

If Rust is not installed, run:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

## Source checkout setup

### macOS Native Daemon Mode (actively supported and tested)

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security

# 1. Install pinned dependencies
npm ci

# 2. Build the native executable used by automatic startup
cargo build --release --manifest-path src/core-native/Cargo.toml

# 3. Verify Next.js production build (Turbopack)
npm run build
```

These source checks prepare the native binary and verify the dashboard build.
Client UI installation and clean-machine checks remain separate manual steps.

### Optional dashboard and foreground development

For source telemetry after a configured client has connected:

```bash
npm run dev:dashboard
```

Open <http://localhost:3000>. If occupied, use
`npm run dev:dashboard -- -p 3001` and open <http://localhost:3001>.
This viewer reads the source checkout ledger; it does not automatically load a
standalone Application Support ledger. Protection continues without the viewer.

`npm run dev:full` remains an optional foreground development command using
`concurrently` for the Cargo daemon and dashboard. Use it only when no daemon is
already running for this checkout; a failed child stops the other service.
Ctrl+C stops that development session. `PORT=3001 npm run dev:full` changes only
the dashboard HTTP port, not native IPC. Neither command is required for MCP
onboarding or automatic source daemon startup.

After a confirmed native quarantine, the daemon queues
a macOS Notification Center banner outside the browser. The banner identifies
only a trusted display label (Claude Code, Codex CLI, Cursor, Aider, or Unknown
Agent Process) and PID; executable basenames are never echoed. It never includes an event
path or credential detail. macOS may suppress delivery when notifications are
denied or no interactive desktop session is available, but that does not alter
the quarantine result.

Linux native support is planned and currently experimental; it is not yet part
of the actively supported and tested Native Daemon Mode rollout. Windows must
use the dashboard-only demonstration setup below.

### One-command AI client onboarding

After `npm ci`, close your AI clients and run `npm run setup` from the checkout.
After `npm link`, the same command is available as `krypton setup` from any
directory. Setup does not require a running daemon. It detects existing storage
for Claude Desktop, Cursor, Claude Code and the Cline VS Code extension:

| Client         | macOS settings file                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`                                               |
| Cursor         | `~/.cursor/mcp.json`                                                                                            |
| Claude Code    | `~/.claude.json` (an existing `~/.claude/` also counts as detected)                                             |
| Cline          | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

On Linux, Claude Desktop-compatible and VS Code storage use `$XDG_CONFIG_HOME`
(default `~/.config`) in place of `~/Library/Application Support`; detection
does not imply official Claude Desktop or native Linux support. Cursor and
Claude Code retain their home-directory paths. Other editor distributions,
profiles, containers and remote extension hosts are not auto-detected.

Setup creates missing configuration files only for detected clients. Existing
JSON is bounded to 4 MiB, backed up atomically to `<settings-file>.bak` with
private `0600` permissions, and safely merged. Other settings and MCP servers
remain intact. Invalid JSON, settings symlinks, an existing conflicting
`krypton-protected-fs` entry, and concurrent setup locks fail per client.
An identical entry is skipped without changing the backup. A stale
`<settings-file>.krypton-setup.lock` after a crash must be reviewed and removed
only after confirming no setup is running. Close clients to avoid concurrent
settings edits; the pre-replacement check cannot lock third-party writers.

Each entry launches `node` with the literal argument array
`["<PROJECT_ROOT>/src/cli.cjs", "run", "--", "node", "<PROJECT_ROOT>/src/core/mcp/server.cjs"]`
and `env: { "KRYPTON_PROJECT_ROOT": "<PROJECT_ROOT>" }`, using the canonical
checkout path. Node must be on the GUI client's PATH. Setup prints
`CONFIGURED`, `SKIPPED`, or `FAILED` per client and exits nonzero for failures.
Restart configured clients; their supervisor reuses a healthy daemon or starts
the compiled source daemon automatically. To undo setup, close the client and
restore its reviewed `.bak` file, or remove only `mcpServers.krypton-protected-fs` if no original
configuration existed.

### Protected MCP file tools

`src/core/mcp/server.cjs` exposes `krypton_read_file({path})` and
`krypton_write_file({path, content})` over newline-delimited UTF-8 stdio.
It validates JSON Schema 2020-12 locally with Ajv, negotiates supported MCP
protocol versions, retains constant-size session state, serializes requests,
and bounds each incoming frame to 32 KiB. Paths are limited to 1 KiB and
UTF-8 file content to 2 KiB. Parent directories must already exist. Basenames beginning with
`.krypton-mcp-` (including case variants) are reserved for native write staging.

Calls use `dispatchNativeControl` and the existing authenticated discovery,
capability, peer-user and 1500 ms absolute IPC deadline contracts. The additive
native command is `mcp_file` with `tool`, `path`, and optional `content` fields.
Rust evaluates against the configured protected workspace and performs the
file access itself. Reads use no-follow directory-relative opens and reject
non-regular files, hardlinks, oversized files and invalid UTF-8. Writes use
private exclusive temporary files and atomic replacement; they replace file
metadata with private defaults rather than preserving executable bits.
Missing, incompatible or degraded telemetry/daemon state fails closed. Socket disconnects settle immediately; slow incoming bytes never extend the
1500 ms deadline. Stalled MCP stdout writes also terminate after 1500 ms.
Tool execution failures remain inside `result.isError`; malformed request
schemas use JSON-RPC `-32600` through `-32603`, and malformed JSON uses `-32700`.
Tool-specific input validation returns `isError: true`; invalid `tools/call`
request structure returns `-32602`. No response contains both `result` and `error`.

Rejected calls return a JSON-RPC `result` containing `isError: true` and text
with the native code and receipt. Native receipts identify the tool, requested
path and denial action; queued denial events add an ID and timestamp in the
active bounded ledger: `.krypton/telemetry/alerts.jsonl` for a checkout, or the
private Application Support instance ledger for a standalone bundle.
`telemetry: "queued"` acknowledges queue
admission, not durable persistence. Queue/write failures report degraded health.
The dashboard displays these rows as `INTERCEPTED` and retains no actor PID.
Both Audit-Only and Enforcement modes deny unsafe MCP file calls. MCP denials
do not request SIGKILL, so the client can receive the error and continue safely.

This boundary covers these two tools only. It does not intercept a client's
built-in filesystem tools, shell, network calls or descendant processes.
Descriptor-relative access prevents symlink substitution, but same-user host
tampering, mount changes and concurrent directory relocation remain outside a
kernel isolation boundary. Storage errors can make write completion uncertain;
inspect the destination before retrying after an I/O failure. File contents and
capabilities are never included in denial telemetry.

For disposable real-IPC verification, run `npm run test:e2e`. It
launches the production MCP server through the supervisor, checks read/write,
traversal denial in both modes, durable native receipts and clean stdio shutdown.
Real client UI onboarding and the 60-second release target still require manual
macOS verification. The local `.mcpb` generator is available below.

### Build the standalone MCP extension locally

The builder requires both optimized native binaries at these exact paths:

```text
dist/native/krypton-core-native-aarch64-apple-darwin
dist/native/krypton-core-native-x86_64-apple-darwin
```

Build each binary on its matching macOS architecture with the pinned Rust
toolchain, or download the two native artifacts produced by the same trusted
release workflow run, then stage them under those names. The builder rejects a
missing, symlinked, oversized, swapped, or wrong-architecture input.

```sh
npm run build:mcpb
```

This writes `dist/krypton-protected-fs.mcpb`, a deterministic ZIP containing the
production MCP server, standalone launcher, arm64 and x64 native daemons,
SHA-256 content metadata, and only the required JavaScript runtime dependencies
and licenses. The metadata is not a publisher signature. Repeated builds with
unchanged source, binaries, and locked dependencies produce the same SHA-256.
The offline builder checks installed dependency versions against
`package-lock.json`, limits the archive to 2,048 entries, 128 MiB per entry, and
256 MiB of aggregate input, and publishes atomically. A failed pre-publication
build preserves the previous archive; a post-publication sync failure reports
uncertain durability. Generated artifacts remain gitignored.

The manifest follows [MCPB 0.3](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md)
using the required `manifest_version` field. It declares both Krypton file tools.
Open the archive in a compatible macOS MCPB client and optionally select an
existing directory for `protected_workspace_root`. Omitted and Unicode-whitespace
values use `~/Library/Application Support/KryptonSecurity/sandbox_workspace`;
invalid nonblank paths fail rather than silently selecting another root. The
launcher uses the MCP host's Node executable, selects the bundled arm64 or x64
daemon, and supervises that exact child. Avoid enabling a duplicate setup-generated
Krypton server in the same client.

The extension includes its JavaScript dependencies and native daemons. It does
not include Rust, Node, workspace files, telemetry, sockets, capabilities, or the
Next.js dashboard. Installed binaries, configuration, telemetry, and the
workspace-specific ownership lock live beneath private Application Support state;
authenticated socket discovery lives in a short private path under the macOS
temporary directory. Native IPC stays authenticated and fail-closed.
Linux native control remains experimental and is not advertised in this macOS
bundle. The archive and binaries are unsigned and unnotarized; Gatekeeper and
live clean-machine Claude Desktop behavior still require manual QA.

To inspect locally, run `unzip -t dist/krypton-protected-fs.mcpb` and
`unzip -p dist/krypton-protected-fs.mcpb manifest.json`. Archive regression tests
use `unzip` and Python 3 for independent ZIP conformance checks.

To exercise an already-built archive without a checkout-backed runtime, run:

```sh
npm run test:mcpb -- dist/krypton-protected-fs.mcpb
```

The bounded harness extracts only an allowlisted inventory into temporary
storage, uses isolated home and working directories, verifies custom and fallback
workspaces, checks traversal denial and durable standalone telemetry, and confirms
exact-child exit and post-exit socket nonacceptance. The private temporary runtime
home may retain the socket, capability, and discovery files after shutdown. A local
run covers only the current Mac architecture; the
release workflow defines separate arm64 and x86_64 packaged-E2E jobs.

## Running Your First Live Simulation

> **ISOLATED END-TO-END CHECK:** The simulation starts its own test-only native
> daemon in a disposable directory. No running dashboard or developer daemon is required.

macOS is the supported verification platform. The Unix harness also supports
experimental Linux execution; Windows dashboard-only mode cannot run native isolation.

1. Use the pinned Node and Rust toolchains, install dependencies with `npm ci`,
   and run from the repository root:

   ```sh
   npm run test:e2e
   ```

2. The harness registers an owned disposable child with its complete live identity
   using authenticated `.krypton/runtime/daemon.sock` IPC. The child submits a
   traversal intent; the path policy denies it. A harmless fixture write produces
   separate portable watcher evidence with no attributed PID.
3. The harness verifies that Audit-Only Mode refuses isolation and produces no
   notification, then enables enforcement and verifies authenticated `IsolateProcess`,
   actual child exit via `SIGKILL`, durable `.krypton/telemetry/alerts.jsonl`, and
   a redacted mocked notification receipt. Expect a terminal `[PASS]` line.
4. Disposable children and fixture files are cleaned up. Mock notification delivery
   exists only in the Rust test binary, not the production daemon. The simulation
   does not test macOS Notification Center display or update the developer's dashboard.
   Sandboxed environments must permit Unix sockets and owned-child signaling.

The TypeScript reference watchdog is observational only: events and errors never
broadcast signals. Legacy PID-only registration is disabled. Operational isolation
uses `quarantineProcess(compoundIdentity)` and authenticated native IPC; cleanup of
a newly spawned child whose registration failed is a separate owned-child lifecycle
action, not a successful quarantine. Runtime deadline isolation also uses native IPC.

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

### Source-checkout configuration

`krypton.config.json` must be a regular file no larger than 1 MiB. Invalid or
oversized configuration stops native startup with a redacted stderr diagnostic
and nonzero status. It separates the relevant roots and bounds:

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

### Standalone MCPB configuration

Claude Desktop exposes the optional `protected_workspace_root` directory field.
The launcher accepts an existing canonical directory. An omitted, empty, or
whitespace-only value creates the private fallback at
`~/Library/Application Support/KryptonSecurity/sandbox_workspace`; any other
invalid value stops startup. No `project_root`, repository marker, or
`KRYPTON_PROJECT_ROOT` is required in standalone mode.

The launcher derives a fixed SHA-256 workspace ID and stores the standalone
configuration, ownership lock, and bounded ledger beneath
`~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/`. The
verified daemon copy lives under the private `KryptonSecurity/bin/<version>/<arch>/`
tree. The configuration and telemetry stay outside the protected root. The private
configuration selects an authenticated runtime home in a short macOS temporary
path so the Unix socket remains within platform path limits. State components
must remain owned by the current user, non-symlinked, and inaccessible to group
or other users; unsafe state fails closed rather than being repaired in place.

The standalone daemon receives only
`--standalone-config <absolute-private-config-path>`. The launcher verifies the
bundled metadata and Mach-O architecture before publication, requires authenticated
healthy readiness, runs the MCP server in-process, and terminates only its exact
spawned child on EOF, signal, daemon exit, or server failure. Persistent telemetry
retains at most 10,000 events or 8 MiB, matching source mode.

## Supervise a real agent with `krypton run`

After the setup/build steps above, expose the source-checkout executable:

```sh
npm link
```

This creates the `krypton` command using your active Node/npm installation.
No additional CLI package is required. Without linking, use
`node /absolute/path/to/krypton-security/src/cli.cjs` in place of `krypton`.

Run the supervised command from the prepared checkout:

```sh
krypton run -- claude
krypton run -- node agent.js
```

`krypton run` first validates private discovery and authenticated healthy status.
It reuses a healthy daemon. When no reachable daemon exists, it searches for
`krypton-core-native` in this order: `target/release/`,
`src/core-native/target/release/`, `target/debug/`, then
`src/core-native/target/debug/`. When `CARGO_TARGET_DIR` is set, its target
directory is searched first within each profile; relative values resolve against
the checkout and absolute values are used directly. All release candidates are
searched before any debug candidates. Build the native executable if it is missing:

```sh
cargo build --release --manifest-path src/core-native/Cargo.toml
```

Automatic startup launches a detached Node host, which owns the native daemon
child without Cargo or a shell. Healthy readiness must succeed within three
seconds after host spawn. The initial existing-daemon IPC probe has its own
1500 ms deadline, and filesystem preparation occurs before the readiness timer;
the entire startup is not bounded to three seconds. Readiness polls every 100 ms
and individual IPC exchanges retain their 1500 ms absolute deadline.
Authentication, malformed discovery, degraded health, early exit without a healthy
service, or readiness timeout fails closed before the target is launched. Scheduler
stalls and blocking kernel I/O are outside hard real-time guarantees.

The source host and daemon remain running independently of MCP sessions until
explicitly stopped or a service failure ends them. Each client still registers
and unregisters its own initial child. The host copies combined native stdout and
stderr to private `.krypton/logs/daemon.log`, capped at 64 KiB; subsequent output is
drained and discarded. Each new startup attempt atomically publishes a fresh file;
an existing host retains its original private file handle, avoiding mixed output.
The visible log describes the latest attempt, which may be a losing concurrent
starter. It is diagnostic output, not the separate native telemetry ledger. It can
contain native output and private paths: inspect it locally and redact it before
sharing. These bytes never share MCP stdout. This differs from the standalone
MCPB, whose launcher stops its exact daemon child when its session ends.
No login service is installed. After updating the binary, stop the known source
daemon and reconnect the client so the new binary starts; never kill a PID copied
from untrusted discovery data or delete a live socket/startup lock.

`krypton daemon:start` remains an explicit foreground Cargo development command;
Ctrl+C ends that session. Resolve degraded health before retrying. The launcher
does not replace an authenticated but unhealthy daemon with a permissive instance.

**Workspace selection:** Run from the checkout root or inside its configured
protected workspace. From the root, the child starts in `sandbox_workspace`
(or the configured `protectedWorkspaceRoot`); from a protected subdirectory, that
canonical directory is preserved. Relative executable paths and file arguments
therefore resolve inside that child directory. The CLI rejects traversal, escaping
workspace symlinks, and other invocation directories. This source-checkout CLI
requires `runtimeDirectory: ".krypton/runtime"` and an existing protected directory.

**Desktop/MCP hosts:** Configure the executable as the absolute `src/cli.cjs`
path (or the linked `krypton` executable), use an argument array such as
`["run", "--", "/absolute/path/to/node", "/absolute/path/to/server.js"]`, and set
`KRYPTON_PROJECT_ROOT` to the absolute Krypton checkout path in the host's environment.
This explicit override selects the protected workspace when the host cannot set
its working directory. Configure executable paths visible to the desktop host;
its PATH may differ from your terminal. Stdin/stdout/stderr are inherited, with
all supervisor diagnostics sent exclusively to stderr so MCP stdout stays intact.
No shell is used; quoting, shell operators, redirections, and environment expansion
are not interpreted by Krypton. Invoke a shell explicitly only if you intend that.

**Lifecycle:** The supervisor registers the initial child's complete PID, start
time, canonical executable, and parent identity through version 1 authenticated
IPC. It captures exits before waiting for registration, forwards SIGINT/SIGTERM
to that owned child, and attempts unregister once before exiting. Nonzero child
exit codes are preserved; a zero status becomes 1 if registration, signal forwarding,
or cleanup fails. Signal exits use `128 + signal number` (SIGKILL is 137).
Spawn-not-found exits 127, invalid invocation exits 2, and setup failures exit 1.
A command that exits before registration finishes follows these exit-status rules,
with an explicit stderr notice that supervision was not established. Rejected registration
requests stop only the newly spawned child; if the OS refuses cleanup or exit is
not confirmed within 1500 ms, the supervisor reports that the child may still
be running and exits nonzero without removing a potentially live registration.
Each IPC request has an absolute 1500 ms deadline and a 16 KiB frame limit.
Unregister failure is reported and upgrades a zero child status to 1.

**Executable identity:** Node and Rust resolve executable symlinks to their
canonical on-disk target, including version-manager paths used by fnm, nvm, and
Homebrew. Registration accepts an absolute client alias only when it resolves to
the inspected target; PID, start time, and parent PID must still match exactly.
Resolution failures deny native inspection rather than trusting a raw path.
The daemon pins the inspected canonical identity for revalidation before signaling,
so retargeting an alias cannot authorize a different live executable. Later IPC
requests must reuse the original registered client identity for isolation,
unregister, and receipt lookup; cleanup and receipts do not depend on the alias
still existing. Restart the daemon after pulling this fix. This resolves symlink
spellings, not executable file-content identity or the documented TOCTOU limitation.

**Enforcement evidence:** After SIGKILL, the supervisor queries the authenticated
`termination_receipt` command with the same complete identity. Only confirmed
native signal delivery produces:

```text
[KRYPTON] Process <pid> terminated by native security boundary enforcement.
```

Otherwise it reports SIGKILL with attribution unconfirmed. The daemon keeps at most
1,024 receipts for 60 seconds using monotonic time; expiration, eviction, restart,
contention, old daemons, and unavailable IPC cannot establish attribution. Receipt
publication is atomic with successful signaling and registry removal. Receipts do
not change the observational JSONL ledger into enforcement evidence.

This supervises the **initial child**, not an automatically contained descendant
tree. It does not pause execution until registration succeeds, infer actors from
portable filesystem events, or provide universal pre-access filesystem/network
blocking. IDE commands that hand off to an existing application are not evidence
that the existing application's processes were registered. macOS is supported;
Linux remains experimental and Windows remains dashboard-only.

### Local supervisor verification

1. In the checkout, use the pinned toolchains, run `npm ci`,
   `cargo build --release --manifest-path src/core-native/Cargo.toml`, and `npm link`.
2. In the same checkout, run (the daemon starts automatically if unavailable):

   ```sh
   krypton run -- node -e 'console.log(process.cwd())'
   ```

   Expect the canonical configured protected workspace path on stdout. A short
   command can exit before registration completes; the CLI reports that limitation
   on stderr and preserves its exit code. This checks discovery and command launch,
   not enforcement.

3. The following is a **limitation probe, not a containment test**:

   ```sh
   krypton run -- node -e 'require("fs").readFileSync("/etc/passwd")'
   ```

   On a host where that file is readable, the read can succeed. The command does
   not print the returned bytes. Krypton does not intercept arbitrary Node file
   reads, and portable filesystem notifications cannot reliably identify their
   actor or guarantee that this read produces a violation event. Do not expect
   automatic quarantine or an enforcement receipt from this command.

4. Run the reproducible containment check from the repository root:

   ```sh
   npm run test:e2e
   ```

   Expect `[PASS]` lines for the CLI and authenticated native isolation. The harness
   creates its own temporary daemon and owned children, verifies denial of an
   integrated traversal intent, records a separate unattributed fixture event,
   and explicitly requests isolation of a registered complete identity. The Node
   supervisor obtains the spawned child's PID and inspects its start time,
   executable and parent; the Rust daemon validates that identity at registration
   and again immediately before signaling. Only successful native SIGKILL delivery
   publishes an in-memory authenticated termination receipt. Receipt creation is
   distinct from recording observational violations in the JSONL ledger. The test
   mocks desktop notification delivery and never depends on the developer's daemon.

Discovery validation normalizes redundant `./` segments in both endpoint paths,
then requires the exact expected absolute socket and capability file within
`.krypton/runtime`. Relative paths, parent traversal, redirected files, and socket
symlinks are rejected. Rust canonicalizes the runtime directory before publishing
`daemon.json`; restart old daemons to regenerate normalized discovery metadata.
Never print or copy capability contents while diagnosing discovery.

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
registers that exact generation, and unregisters it after terminal exit or spawn failure. A
runtime deadline requests authenticated native isolation; rejection leaves the
child registered and reports failure, with no local signaling fallback. If
registration fails, it requests cleanup only for the child it just spawned.
`startProtectedProcess` also exposes `registered` and `completed` promises so CLI
callers can await terminal status, receipt lookup, and bounded cleanup. Manual
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

Live `health.mode` drives the native dashboard toggle; unknown mode disables it
and displays “Mode unavailable”. Registry read failures produce an unavailable
count, never a fabricated zero. Health aggregates watcher readiness, IPC, ledger,
registry, notification delivery, and telemetry queue loss. Watcher/IPC errors and
queue or notification failures remain degraded until daemon restart. A successful
quarantine is not reversed by notification degradation. Portable ledger events
remain `OBSERVED`, even when an identity is present: identity is not a signal
receipt. `ISOLATED` is displayed only after authenticated isolation succeeds.

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

`npm run test:e2e` builds a native test fixture and exercises the production MCP
server through its supervisor in a fresh temporary workspace. It checks in-bounds
read/write, `../outside.txt` denial, durable native receipts normalized as
`INTERCEPTED`, and fail-closed socket loss. It also verifies owned-child SIGKILL.
The existing `npm run test:sim` runs the same checks. Both commands clean up their
owned processes and files, report `[PASS]` on success and exit nonzero on failure.
Desktop delivery is mocked; live client UI, dashboard polling and macOS banners
remain manual QA. Keep local notes in gitignored `QA_TESTING.md`.

Run the test gates from the repository root:

```bash
npm test -- --run     # Vitest dashboard & integration test suite (331 tests at QA baseline)
npm run rust:test     # Cargo native test suite (56 unit tests at QA baseline)
```

These counts record the clean-macOS QA baseline; new tests can increase them.
The Vitest suite also covers TypeScript core policy and utilities.

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

### Tools not showing up in Claude Desktop

Fully quit with Cmd + Q on macOS and reopen Claude Desktop. Open the chat tools / + menu and Connectors to check krypton_read_file and krypton_write_file. For an MCPB install, review Settings > Extensions and its configuration/logs. For source setup only, validate JSON syntax in ~/Library/Application Support/Claude/claude_desktop_config.json, check mcpServers and absolute script paths, and ensure node is on the client PATH. Use Developer settings to open MCP logs (macOS logs are under ~/Library/Logs/Claude). Close the client before edits, keep its backup, and never share capabilities or complete settings/log files. Organization extension policies may require administrator approval.

### Gatekeeper / Unsigned Binary Notice on macOS

Krypton release binaries are unsigned and unnotarized. After verifying the release source and checksums, attempt opening the file; if macOS blocks a trusted download, review System Settings > Privacy & Security > Open Anyway when offered. Managed Macs may require IT approval. Do not globally disable Gatekeeper or strip quarantine recursively. Approval does not prove containment; repeat the live tool test after installation.

### Native Daemon Connection Timeout

A missing socket, disconnect, authentication error or 1500 ms absolute IPC deadline denies the pending operation; there is no permissive fallback. In source mode, the configured launcher starts the compiled daemon automatically. If the binary is missing, run cargo build --release --manifest-path src/core-native/Cargo.toml, then reconnect. Readiness must succeed within three seconds after host spawn; the initial 1500 ms IPC probe and filesystem preparation are separate. Authentication or degraded-health errors fail closed without replacing that daemon. Inspect private .krypton/logs/daemon.log output (64 KiB maximum, reset per startup attempt; private paths require redaction before sharing) and the permissions of .krypton/runtime/ without printing capability or daemon.json contents. Standalone MCPB supervises its own daemon using a short temporary runtime directory and stores evidence at ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl. Restart the MCP session and inspect redacted client logs. Never delete a live socket or startup.lock, and inspect the destination before retrying a timed-out write. The Pages dashboard cannot inspect local sockets or display native workstation evidence.

### Permissions Denied on Protected Workspace

Choose an existing directory owned by your user in protected_workspace_root, or leave it blank to create ~/Library/Application Support/KryptonSecurity/sandbox_workspace. Invalid nonblank paths do not silently fall back. Check directory permissions and macOS privacy controls; do not run as root or grant broad disk access to bypass a denial. /etc/passwd is outside the default workspace and should be denied. A file denial produces a receipt and queues INTERCEPTED evidence; it does not trigger a desktop quarantine banner.

### Can I install the native runtime on Windows?

No. Install-Windows.cmd invokes the shared setup engine when Node is available and exits nonzero without editing client settings. Windows is dashboard demonstration-only until the native runtime ships. Claude Desktop configuration normally lives at %APPDATA%/Claude/claude_desktop_config.json (fallback: %USERPROFILE%/AppData/Roaming/Claude/claude_desktop_config.json), and Cursor uses %USERPROFILE%/.cursor/mcp.json; those locations are not enabled installation targets. The MCPB manifest intentionally supports darwin only.

See [Apple’s Gatekeeper guidance](https://support.apple.com/en-us/102445) for
per-app approval. Do not disable system-wide protections.

- **`krypton` command not found:** run `npm link` in the source checkout using
  the pinned Node version, or invoke `node /absolute/path/to/src/cli.cjs` directly.
- **Supervisor workspace unavailable:** set an absolute `KRYPTON_PROJECT_ROOT`
  for desktop hosts, or run from the checkout/protected directory. Verify the
  configured protected directory exists and does not escape through a symlink.
- **Native supervision was not established:** very short commands can finish
  before identity inspection/registration. Their exit status is preserved, but
  the CLI does not claim they were protected.

- **`cargo` or `rustc` not found:** install Rust through `rustup`, restart the
  shell if needed, and rerun the four prerequisite version checks.
- **C compiler or linker unavailable:** install the platform development
  toolchain. macOS requires Apple command-line developer tools. Experimental
  Linux builds require the compiler and linker supported by that distribution.
- **Unsupported Windows native mode:** use `npm run dev:dashboard`. Windows is
  strictly dashboard-only demonstration mode; native isolation is intentionally
  unavailable today.
- **Port 3000 already in use:** an occupied port blocked Turbopack dashboard
  startup inside `concurrently` during macOS QA. Free port 3000 or run
  `PORT=3001 npm run dev:full` and open `http://localhost:3001`. For the
  dashboard alone, use `npm run dev:dashboard -- -p 3001`.
- **Stale Unix socket:** stop old daemon processes. The private `startup.lock`
  file can remain after a crash; kernel locks release on exit. Do not unlink
  this lock file while a daemon could still be running. Startup removes a socket only
  after a connection check proves it is stale; never delete a socket belonging
  to a running daemon.
- **Daemon endpoint missing:** reconnect the configured source client to trigger
  automatic startup. If the executable is missing, run
  `cargo build --release --manifest-path src/core-native/Cargo.toml`. Confirm
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
<summary>Where do I troubleshoot double-click installation?</summary>

Use the [troubleshooting guide](#troubleshooting) for missing tools, invalid JSON,
Gatekeeper prompts, daemon timeouts, workspace permissions, and unsupported Windows
native setup. The Field Guide FAQ contains the same recovery paths. Source setup
scripts require a prepared checkout; the macOS MCPB is the zero-terminal route.

</details>

<details>
<summary>How do I verify a Krypton release?</summary>

Tagged-release automation drafts Intel and Apple Silicon daemon binaries, the
standalone MCPB bundle, and SHA-256 checksum files after verification succeeds.
The bundle job downloads both native artifacts, embeds them, and byte-compares the
archive entries with those exact inputs. Matching arm64 and x86_64 macOS jobs then
run the isolated packaged E2E before the draft job can proceed. Download the three
primary assets and `SHA256SUMS` into one directory, then run
`shasum -a 256 -c SHA256SUMS` before use. The assets remain unsigned and
unnotarized; checksums do not authenticate the publisher. Releases require
maintainer review, manual clean-machine Claude Desktop and Gatekeeper QA, and
manual publication. Main branch protection is an owner-managed setting, not
something workflow files activate automatically. Hosted execution remains
unverified until the workflow runs after these changes are pushed. See
[release contracts](docs/RELEASE.md) for full instructions and remaining QA.

</details>

<details>
<summary>How do I connect Claude Desktop, Cursor, Claude Code or Cline?</summary>

For Claude Desktop on macOS, download `krypton-protected-fs.mcpb` from
[GitHub Releases](https://github.com/mwarnsley/krypton-security/releases), open
**Settings → Extensions** under **This computer**, and add the file. Select an
existing `protected_workspace_root`, or leave it blank to use
`~/Library/Application Support/KryptonSecurity/sandbox_workspace`. The bundle
selects its arm64 or x64 daemon and supervises it for the MCP session; it needs no
checkout or Rust toolchain. Its telemetry stays below the private Application
Support instance directory. It does not include or launch the Next.js dashboard.
Only `krypton_read_file` and `krypton_write_file` gain native path containment;
built-in Claude tools remain outside the boundary. The unsigned, unnotarized
bundle still requires manual clean-machine Claude Desktop and Gatekeeper QA.

Source users can instead close clients, double-click `scripts/Install-Mac.command`
in a prepared macOS checkout, or run `npm run setup` (`krypton setup` after `npm link`),
and restart configured clients. Their supervisor automatically starts the compiled
daemon when unavailable and reuses a healthy existing daemon. That flow preserves other servers, atomically backs up
existing JSON, reports each client separately, and uses the canonical checkout as
`KRYPTON_PROJECT_ROOT`. Avoid enabling both installation routes in one client.

</details>

<details>
<summary>How do I view native telemetry, and is the dashboard required?</summary>

Protection runs without the dashboard. In a source checkout, run
`npm run dev:dashboard` and open <http://localhost:3000> after a protected client
connects. It reads `.krypton/telemetry/alerts.jsonl`, a bounded JSONL ledger that
retains at most 10,000 events or 8 MiB through atomic compaction. It is not an
unbounded append-only log. Standalone MCPB evidence lives at
`~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl`
and is not automatically loaded by the source viewer. GitHub Pages uses mock
data only until the planned Phase 2 local-file bridge ships.

</details>

<details>
<summary>What happens if the native daemon disconnects?</summary>

Protected MCP calls fail closed on a missing socket, disconnect, authentication
failure, degraded native state, or the 1500 ms absolute IPC deadline. They never
fall back to direct unprotected file access. Reconnect a source client to reuse a
healthy daemon or trigger automatic startup; missing binaries require
`cargo build --release --manifest-path src/core-native/Cargo.toml`. Readiness
must succeed within three seconds after host spawn; the initial 1500 ms IPC probe
and filesystem preparation are separate. Existing authentication or degraded-health
failures never trigger daemon replacement. Review private `.krypton/logs/daemon.log`
output locally: it is capped at 64 KiB and reset per startup attempt, and may contain
private paths that require redaction before sharing. The standalone MCPB owns its own daemon lifecycle. Inspect the destination
before retrying an uncertain write; reconnecting does not establish rollback.

</details>

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
services. Source-checkout native events stay in the bounded local
`.krypton/telemetry/alerts.jsonl` ledger. Standalone events stay at
`~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl`.
The dashboard includes an external GitHub link that opens only when selected,
and demonstration rows are explicitly mock data.

</details>

<details>
<summary>5. What is the difference between Audit-Only Mode and Enforcement Mode?</summary>

The native daemon initially starts in `audit_only`; the local dashboard displays
the authenticated live mode. Both modes deny unsafe MCP file operations. Audit-Only
Mode records violations
without requesting process termination; it does not permit out-of-bounds reads or
writes. Enforcement Mode may
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

Use Node.js v20.19.4, npm 10.x, and Rust 1.97.0 via `rustup`. Clone the repository,
run `npm ci` and `cargo build --release --manifest-path src/core-native/Cargo.toml`,
then close clients and double-click `scripts/Install-Mac.command` (or run
`npm run setup`). Restart Claude Desktop and use the protected MCP tools. The
source launcher automatically starts a missing daemon and reuses a healthy one;
it does not require `npm run dev:full` or an open terminal. The source daemon
remains running after client disconnect. For optional source telemetry, run
`npm run dev:dashboard` and open `http://localhost:3000`; use
`npm run dev:dashboard -- -p 3001` if that port is occupied. The viewer does not
automatically read standalone Application Support ledgers. Pages stays mock until
the planned Phase 2 local-file bridge ships.
After `npm link`, run `krypton run -- <command> [args...]` from the checkout or
protected workspace. `krypton daemon:start` starts only the foreground daemon.
For desktop MCP hosts, set an absolute `KRYPTON_PROJECT_ROOT` and use literal
argument arrays; supervisor diagnostics use stderr. Only the initial child is
registered, and SIGKILL attribution requires an authenticated native receipt.
Use `krypton run -- node -e 'console.log(process.cwd())'` for a benign launch check;
a direct `/etc/passwd` read is not a containment test because arbitrary reads are
not intercepted. Discovery tolerates redundant dot segments only for the exact
expected runtime files. Executable symlinks from version managers resolve to the
same canonical target in Node and Rust; unresolved paths deny inspection, and
PID, start time, and parent checks remain strict. Restart the updated daemon.
Run `npm run test:e2e` for an isolated native end-to-end check using disposable
children, real authenticated IPC and SIGKILL, durable observational JSONL, and
mocked desktop delivery. It does not update the running dashboard or display an
OS banner. For a cross-platform mock dashboard without native isolation, run
`npm run dev:dashboard`.

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

1. **Phase 1 — Local Verification, Containment & Release Hardening (v1.0.0):**
   active release milestone prioritizing `krypton setup`, production native MCP
   IPC and live denial telemetry. The daemon, supervisor, local dashboard and
   redacted OS-level alerts and the dedicated `npm run test:e2e` report are
   implemented. The standalone `npm run build:mcpb` archive includes both macOS
   daemons and has a bounded `npm run test:mcpb` isolation harness. Hosted
   arm64/x86_64 workflow execution and real clean-machine desktop-client
   verification remain outstanding.
   The 60-second onboarding objective is not yet measured or guaranteed.
2. **Phase 2 — Transparent Developer Experience & Distribution (v1.1):**
   planned Homebrew and hardened shell distribution, descendant containment and
   network egress isolation. The existing `krypton run` supervisor registers only
   the initial child. Package-manager installers are not available today.

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

## Automated CI and draft releases

PRs and pushes to `main` run the macOS **Phase 1 verification** workflow:
locked installation, zero-vulnerability npm audit, lint, both TypeScript checks,
formatting, Rust Clippy, Vitest/native tests, socket simulation, E2E containment,
and the dashboard build. The existing quality workflow retains supplementary
coverage, Rust advisory/license checks and SBOM generation. Workflow YAML is
included in `npm run format:check`.

A matching SemVer tag such as `v1.0.0`, pointing to a commit on `main`, runs these
checks again before building optimized Intel/Apple Silicon native binaries. A
separate bundle job downloads both binaries, builds one standalone MCPB, and
byte-compares both embedded entries with the downloaded artifacts. Matching
arm64/x86_64 macOS jobs run the packaged isolation harness before the draft job
attaches the two binaries, tested MCPB, three sidecars, and `SHA256SUMS` to a
**draft** GitHub Release. It never automatically publishes or overwrites a
release. Checksums establish byte integrity; artifacts remain unsigned and
unnotarized.

See [release and repository contracts](docs/RELEASE.md) for artifact names,
checksum verification, strict main protection and fine-grained GitHub MCP/`gh`
permissions. Branch rules require owner activation, and hosted workflow execution
must be verified after these files are pushed. No PAT is required by CI; only the
isolated draft job receives a contents-write `GITHUB_TOKEN`.

## Source release archive

**For source-only distribution, do not manually compress the repository folder.
Use `npm run release:package` and distribute its inspected archive.**

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
- The standalone MCPB contains only `krypton_read_file` and `krypton_write_file`;
  Claude's built-in tools and the Next.js dashboard remain outside the bundle.
- Release signing, notarization, Gatekeeper behavior, clean-machine Claude Desktop
  QA, branch rules, secret scanning, and repository rulesets require manual or
  repository-owner action. Hosted release-matrix execution is not established by
  local workflow validation.

## License

Krypton is distributed under the [ISC License](LICENSE).
