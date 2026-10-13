# Standalone MCPB Architecture Design

**Status:** Approved; implementation amendment recorded 2026-10-13  
**Date:** 2026-10-12  
**Target:** macOS Apple Silicon and Intel Claude Desktop installations

## Implementation amendment (technical correction, 2026-10-13)

This amendment records the security-preserving layout selected during implementation. It
does not reopen the approved product behavior or require new user approval. A persistent
Application Support socket path can exceed macOS `AF_UNIX` limits, so authenticated IPC
uses a short private directory beneath the canonical OS temporary root. Configuration,
telemetry, the verified binary, and the cross-launch instance lock remain persistent under
Application Support. The private runtime home contains the full workspace SHA-256 marker;
that marker detects a collision in the shortened runtime token and fails closed. The
runtime directory and its private marker, startup lock, discovery, capability, and stale
socket filesystem entries may remain after exit. A stopped daemon is proven by process
exit and a socket that no longer accepts connections; the next native startup validates
the retained files, owns stale-socket recovery under its kernel lock, and atomically
replaces discovery and capability material.

## Purpose

Make `krypton-protected-fs.mcpb` operate without a Krypton source checkout,
Cargo, or a separately started daemon. Claude Desktop installs one extension,
selects an optional protected workspace, and launches the JavaScript MCP server
with the matching bundled native daemon. The native path policy, authenticated
IPC, fail-closed behavior, and bounded telemetry contract remain authoritative.

The standalone bundle must not claim to intercept Claude Desktop's built-in
tools. It contains only `krypton_read_file` and `krypton_write_file`, and those
tools remain the only operations enforced through this MCP server.

## User experience

The MCPB manifest replaces the required `project_root` field with an optional
directory field named `protected_workspace_root`.

- When the user selects a directory, Krypton canonicalizes and protects that
  exact directory.
- When the field is missing, empty, or whitespace-only, Krypton creates and
  protects:

  `~/Library/Application Support/KryptonSecurity/sandbox_workspace`

- A nonblank value that is missing, redirected at its final component, not a
  directory, inaccessible, or otherwise unsafe is an explicit configuration
  failure. Krypton does not replace an invalid user choice with the fallback.
- The fallback directory is created with private ownership and permissions
  before native startup. Failure to create or verify it stops startup with a
  bounded diagnostic on stderr.
- Claude Desktop supplies no checkout path. The installed extension locates all
  JavaScript and native files relative to its own installation directory.

The extension remains macOS-only for this release. `process.platform` must be
`darwin`; `process.arch` must be `arm64` or `x64`. Every other combination fails
before executing a bundled binary.

## Bundle contents and deterministic assembly

The final archive contains the existing reviewed JavaScript runtime closure plus
both release daemon binaries:

```text
manifest.json
package.json
README.md
native/native-binaries.json
native/krypton-core-native-aarch64-apple-darwin
native/krypton-core-native-x86_64-apple-darwin
src/cli/runtime.cjs
src/core/mcp/server.cjs
src/core/processIsolation.cjs
src/packaging/launch_mcpb.cjs
src/packaging/mcpb_runtime.cjs
node_modules/<allowlisted runtime dependency files>
```

`native-binaries.json` is generated during packaging and maps `arm64` and `x64`
to an exact relative filename, byte length, and SHA-256 digest. The launcher
accepts no filename or path from user input.

`src/packaging/build_mcpb.cjs` gains an explicit native-input contract for the
two release artifacts. It verifies each input as a bounded, unchanged, regular,
non-symlink file; confirms the Mach-O architecture; computes its digest; and
adds the bytes and generated metadata to the deterministic archive. Unit tests
inject bounded fixture binaries through the programmatic build API and never
invoke Cargo.

The release workflow remains responsible for compiling locked optimized Rust
binaries on the matching GitHub-hosted macOS runners. Bundle assembly happens
only after both architecture jobs succeed. The resulting MCPB is assembled once
from those exact artifacts, tested on both macOS architectures, and then passed
to the existing checksum and draft-release stages. The separate daemon assets
may remain in the release for diagnostics and advanced users, but the MCPB must
contain byte-identical copies.

The ZIP writer's current 1 MiB per-file and 16 MiB total limits are too small for
two optimized native binaries. The implementation will raise them to explicit
reviewed bounds that remain no larger than the release artifact limit: 128 MiB
per native binary, 256 MiB total payload, and 2,048 entries. Tests cover the
exact limits and one byte beyond. ZIP timestamps, ordering, names, and regular
`0644` archive attributes stay deterministic; executable permission is applied
only after verified extraction.

## Private installed state

The launcher uses this root:

`~/Library/Application Support/KryptonSecurity`

The persistent root and every security-sensitive directory must be owned by the current
user, must not be a symlink, and must deny group/other access. Files containing
configuration, discovery metadata, capabilities, and telemetry use private
permissions. Existing unsafe state is rejected rather than repaired in place.

The persistent layout is:

```text
KryptonSecurity/
├── bin/<version>/<arch>/krypton-core-native
├── sandbox_workspace/                 # only the blank-input fallback
└── instances/<workspace-id>/
    ├── config/runtime.json
    └── .krypton/
        ├── instance.lock
        └── telemetry/alerts.jsonl
```

`workspace-id` is a fixed lowercase hexadecimal SHA-256 digest of the canonical
protected workspace path. Raw workspace paths are not placed in filenames.
Separate workspaces therefore receive separate ledgers and persistent instance
locks.

Authenticated IPC uses the canonical temporary root and this bounded layout:

```text
<canonical-os-temp>/k/<12-character-token>/
├── workspace-id                       # full 64-hex workspace ID, mode 0600
└── .krypton/runtime/
    ├── startup.lock
    ├── daemon.json
    ├── daemon.sock
    └── capability
```

The token is the first 12 base64url characters derived from the workspace ID.
The full marker prevents two workspaces from sharing a truncated token. Every
component from `k` downward is private and current-user owned. The final socket
path is limited to 103 bytes, leaving room for the macOS `sockaddr_un` NUL byte.

The launcher reads the selected archive binary with no-follow bounded I/O,
checks its length and digest against `native-binaries.json`, and atomically
publishes a private executable copy under `bin/<version>/<arch>`. It sets mode
`0700`, reopens the destination without following symlinks, and verifies its
ownership, regular-file type, length, and digest before execution. A
pre-publication failure preserves the previous verified binary. A failure after
rename reports uncertain durability and stops; it does not blindly retry.

The installed extension's location may be read-only and its archive mode is not
trusted to preserve executability. Krypton never executes the archive entry in
place.

## Standalone native configuration

Source-checkout startup remains compatible with the existing
`krypton.config.json`. Standalone startup is a separate, explicit native mode:

```text
krypton-core-native --standalone-config <absolute-private-config-path>
```

The native entry point accepts either zero arguments for existing checkout mode
or exactly the standalone form above. Unknown, missing, duplicated, relative,
or oversized arguments return invalid usage without starting watchers, IPC, or
telemetry.

The standalone JSON schema is versioned and contains already resolved absolute
paths:

```json
{
  "schemaVersion": 1,
  "protectedWorkspaceRoot": "/canonical/protected/workspace",
  "runtimeDirectory": "/private/.../T/k/<token>/.krypton/runtime",
  "telemetryPath": "/private/Application Support/.../.krypton/telemetry/alerts.jsonl",
  "ignoredPaths": ["node_modules", ".git", ".krypton"],
  "telemetryMaxEvents": 10000,
  "telemetryMaxBytes": 8388608,
  "rateLimitWindowSeconds": 10,
  "rateLimitMaxBreakouts": 3
}
```

The launcher writes this file atomically with mode `0600`. Rust opens it with
no-follow bounded I/O, validates `schemaVersion`, ownership and permissions,
canonicalizes the protected directory, requires telemetry and the persistent
instance lock to remain under the private instance directory, and accepts only
the exact private short-runtime shape above (or the contained checkout-compatible
shape). The protected workspace may be outside Application Support; neither
persistent nor temporary runtime state may be inside the protected workspace.

Native configuration loading resolves into one internal `RuntimePaths` model so
watching, MCP policy, IPC, and telemetry do not branch throughout the daemon.
Checkout configuration and standalone configuration each validate and produce
that model at their owning boundary. Checkout mode carries its already validated
canonical project root in that model so startup diagnostics do not reload a
mutable configuration file. Standalone mode has no repository root,
additional observed roots, or source-tree markers.

The JavaScript transport gains an explicit runtime-home input for discovery.
Standalone launch uses the private short runtime home and finds
`.krypton/runtime/daemon.json` beneath it. Checkout callers keep their existing
project-root behavior. The MCP server accepts the runtime home through an
explicit option or `KRYPTON_RUNTIME_HOME`; the standalone manifest no longer
sets `KRYPTON_PROJECT_ROOT`.

## Launcher and daemon lifecycle

`src/packaging/launch_mcpb.cjs` becomes the owning standalone process. It does
not invoke the source-checkout supervisor and does not start the MCP server as a
second Node child. After native readiness it calls the existing MCP server
`serve` boundary in-process, preserving stdout exclusively for newline-delimited
JSON-RPC.

Startup proceeds in this order:

1. Validate macOS platform and architecture.
2. Resolve and validate the selected or fallback protected workspace.
3. Validate/create the private Application Support and instance directories.
4. Verify and atomically stage the matching native binary.
5. Atomically publish the standalone runtime configuration.
6. Spawn the native daemon directly without a shell. Its stdin and output do
   not share MCP stdout.
7. Probe authenticated `health` through the existing IPC transport until it is
   ready or a fixed five-second absolute startup deadline expires. Each IPC
   exchange retains the existing maximum 1,500 ms absolute deadline.
8. Start the MCP stdio server in-process with the explicit runtime home.

The readiness loop has a fixed attempt cap and delay, observes daemon early
exit, and never extends the five-second deadline. A timeout, malformed discovery
record, capability failure, or daemon exit terminates the owned child and
returns a redacted operational failure.

The launcher owns only the exact `ChildProcess` object it spawned. It never
signals a PID obtained from discovery, telemetry, configuration, or user input.
On MCP stdin closure, server completion, SIGINT, SIGTERM, startup failure, or a
terminal promise failure, it settles the server once and performs bounded daemon
cleanup:

1. Send `SIGTERM` to the owned child.
2. Wait at most two seconds for exit and reap it.
3. If still live, send `SIGKILL` to that same owned child and wait at most two
   additional seconds.
4. Preserve the private runtime directory and validated runtime files for safe
   next-start inspection. Preserve the bounded telemetry ledger, persistent
   instance lock inode, and verified installed binary.

Cleanup failure upgrades an otherwise successful launcher exit to operational
failure. Diagnostics use stable categories on stderr and never expose workspace
paths, capability material, raw native messages, or arbitrary exception text.
If stderr fails, the launcher still returns nonzero without recursive output.

The persistent instance lock is acquired before opening telemetry and prevents
two standalone daemons from sharing one ledger even if their temporary roots
differ. The runtime startup lock separately serializes IPC publication. A
concurrent launcher fails closed with a stable busy diagnostic. Stale discovery
data is never treated as authority; native startup owns stale-socket recovery
under its existing private kernel lock.

## Telemetry and containment behavior

The native MCP boundary continues to resolve tool paths relative to the
canonical protected workspace. `../outside.txt`, absolute paths, symlink
escapes, missing-parent escapes, special files, and other existing denial cases
remain fail-closed.

Denied MCP calls return a correlated `CallToolResult` with `isError: true` and a
validated native receipt when available. The daemon writes the same bounded
native telemetry event to the instance ledger. The ledger keeps its existing
10,000-event and 8 MiB limits, atomic compaction, bounded queue, and degraded
health behavior.

The standalone beta does not bundle or launch the Next.js dashboard. Telemetry
generation is part of this work; a standalone dashboard reader or viewer is a
separate product decision. Documentation must identify the Application Support
ledger location without exposing capabilities or socket metadata.

## Failure contract

The launcher fails closed and does not start the MCP server when any of these
conditions occur:

- Unsupported platform or architecture.
- Missing, oversized, redirected, wrong-architecture, or digest-mismatched
  bundled binary.
- Unsafe Application Support ownership, permissions, or symlinks.
- Invalid nonblank protected workspace input.
- Runtime configuration publication failure or uncertain durability.
- Native spawn error, early exit, readiness timeout, malformed discovery, or
  failed authenticated health response.
- Concurrent instance ownership.

An omitted or blank `protected_workspace_root` is not a failure. It selects the
private fallback workspace and follows the same validation afterward.

Core enforcement remains entirely local and deterministic. No startup,
readiness, policy, telemetry, or cleanup path calls a network service. Resource
limits cover manifest/config bytes, binary bytes, archive payload, file counts,
startup attempts, IPC frames, output, telemetry, and cleanup waits.

## Testing strategy

### Unit and component tests

- `tests/packaging/build_mcpb.test.ts` verifies the optional manifest field,
  removal of `project_root`, both native entries, architecture validation,
  digest metadata, archive bounds, deterministic output, and typed failures for
  missing, redirected, changed, oversized, or wrong-architecture inputs.
- New colocated launcher tests exercise `arm64`/`x64` selection, unsupported
  hosts, blank fallback, valid custom workspaces, invalid nonblank paths,
  private directory validation, binary copy/digest/mode checks, readiness
  success/timeout/early exit, exact-child cleanup, escalation, and cleanup
  failure status. OS process and signal effects are injected or use explicitly
  owned disposable children.
- Native configuration tests cover both startup modes, standalone schema and
  path validation, permissions, bounds, runtime-state containment, and unchanged
  checkout behavior.
- Existing process isolation and MCP server tests cover explicit runtime-home
  discovery, the 1,500 ms absolute deadline, malformed metadata, unavailable
  sockets, and unchanged source mode.
- ZIP tests cover the new exact native and total payload limits.

### Isolated packaged E2E

A new packaged-bundle harness receives the completed `.mcpb` as input. It does
not import runtime code from the checkout after extraction.

For each macOS architecture runner it:

1. Creates bounded temporary HOME, extraction, protected workspace, and outside
   directories.
2. Extracts the MCPB and verifies its inventory and selected Mach-O architecture.
3. Confirms the temporary HOME has no `package.json`, Cargo manifest,
   `krypton.config.json`, repository marker, or pre-existing daemon.
4. Launches the extracted `launch_mcpb.cjs` through the same manifest arguments
   and environment Claude Desktop supplies.
5. Completes MCP initialization and confirms an allowed file read inside the
   workspace.
6. Calls `krypton_read_file` with `../outside.txt` and requires an `isError: true`
   traversal denial with a correlated native receipt.
7. Reads the Application Support ledger and requires the matching bounded native
   telemetry event.
8. Closes MCP stdin, waits for launcher success, and proves the owned daemon has
   exited and no socket accepts new requests.
9. Repeats the startup using blank workspace input and verifies the exact fallback
   directory is created and protected.
10. Removes only the owned temporary tree.

The harness has absolute startup and total-run deadlines, bounded stdout/stderr
capture, one request in flight, and no retry that could hide uncertain writes.
It prints distinct pass lines for custom workspace, fallback workspace,
traversal denial, telemetry durability, and cleanup.

## Release and documentation synchronization

The release workflow changes its dependency graph so the MCPB assembly job
depends on both native architecture jobs. The isolated packaged E2E matrix must
pass before checksum generation or draft release creation. Release validation
confirms the two standalone daemon assets are byte-identical to their entries in
the MCPB.

The same change updates:

- Root `README.md`, including the prominent Quick Start, source setup, smoke
  test, fallback workspace, macOS scope, and honest dashboard boundary.
- `FEATURES.md` and `ROADMAP.md` standalone-install status and remaining live
  Claude Desktop QA.
- `docs/RELEASE.md`, release workflow inventory, checksums, signing status, and
  isolated bundle verification.
- `ExplainerDrawer` FAQ text and tests so the dashboard does not describe the
  obsolete checkout-dependent MCPB.
- MCPB embedded README and manifest descriptions.
- Applicable JSDoc, declarations, native comments, and threat-model/release
  notes for the new binary and lifecycle trust boundaries.

Unsigned and unnotarized native code may be blocked by macOS Gatekeeper even
when archive integrity and SHA-256 checks pass. Public one-click installation
must remain a release gate until Developer ID signing, notarization, and clean
machine Claude Desktop QA are completed. Beta documentation must state the
actual signing status and any required macOS approval step; it must not describe
the bundle as frictionless until that gate is verified.

## Acceptance criteria

The architecture is complete when all of the following are demonstrated from a
clean macOS test environment:

- One released MCPB contains both verified daemon architectures and all required
  JavaScript dependencies.
- Claude Desktop installation requires no source checkout, Cargo, or manually
  started daemon.
- A selected protected workspace is used exactly; blank input creates the exact
  private fallback directory.
- The extracted launcher chooses only the correct architecture, stages a private
  verified executable, and starts the daemon without shell interpretation.
- Authenticated health succeeds before MCP JSON-RPC begins.
- An allowed in-workspace read succeeds, `../outside.txt` is denied, and the
  denial is durably represented in bounded telemetry.
- Closing the MCP session terminates and reaps the daemon the launcher owns.
- All existing source-checkout flows and mandatory repository gates remain
  green.
- Release checks verify bundle contents and cross-artifact binary identity.
- Documentation describes only behavior verified by packaged E2E and live
  client QA, with signing/notarization limitations explicit.
