# Standalone MCPB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one macOS MCPB that contains both native daemon architectures, starts and supervises the matching daemon without a repository checkout, protects a user-selected workspace or a private fallback workspace, and proves traversal denial plus telemetry in an isolated packaged test.

**Architecture:** The release workflow builds the two optimized Rust binaries on matching macOS runners and passes them to the deterministic MCPB builder. The installed launcher validates private Application Support state, stages the matching daemon, writes a standalone native configuration, waits for authenticated IPC health, runs the existing MCP server in-process, and owns bounded daemon cleanup. Checkout startup remains supported through the same resolved native `RuntimePaths` model.

**Tech Stack:** Node.js 20.19.4 CommonJS, MCPB 0.3, deterministic stored ZIP, Rust 1.97.0, authenticated Unix-domain IPC, Vitest 4, GitHub Actions macOS arm64/x64 runners.

**Spec:** `docs/superpowers/specs/2026-10-12-standalone-mcpb-design.md`

**Implementation amendment (2026-10-13):** This technical correction records
the reviewed implementation shape without requesting new user approval. Persistent
configuration, telemetry, binaries, and the instance lock live in Application
Support. Authenticated IPC uses a private short canonical temporary path to satisfy
the macOS `AF_UNIX` limit, with a full workspace-ID marker for truncated-token
collision detection. Runtime files are retained for validation and stale-socket
recovery on the next start. Checkout `RuntimePaths` carries the canonical project
root from its single configuration load. Packaged E2E has one 45-second absolute
parent deadline plus a separate six-second owned-tree cleanup budget.

## Global Constraints

- Support only `darwin-arm64` and `darwin-x64`; reject every other host before executing native code.
- `protected_workspace_root` is optional. Missing, empty, or whitespace-only input selects `~/Library/Application Support/KryptonSecurity/sandbox_workspace`; an invalid nonblank input fails closed.
- Store binaries, configuration, telemetry, and the persistent instance lock beneath `~/Library/Application Support/KryptonSecurity`. Store capability material, discovery, and the socket beneath the private short temporary runtime. Keep both roots outside the protected workspace.
- Bundle exactly `native/krypton-core-native-aarch64-apple-darwin` and `native/krypton-core-native-x86_64-apple-darwin`, described by schema-versioned SHA-256 metadata.
- Limit each native binary and each ZIP entry to 128 MiB, total ZIP payload to 256 MiB, entry count to 2,048, and ZIP names to 1,024 UTF-8 bytes.
- Preserve the existing 1,500 ms absolute IPC deadline; allow at most five seconds total for daemon readiness.
- Preserve the 10,000-event and 8 MiB telemetry ledger limits and the current MCP `CallToolResult` error contract.
- Never execute a binary directly from the extension archive or installation directory; publish and verify a private `0700` copy first.
- Keep stdout exclusively for newline-delimited MCP JSON-RPC after launcher startup.
- Add no runtime dependency and make no network call in startup, readiness, policy, telemetry, or cleanup paths.
- Preserve checkout-mode configuration and all existing `krypton setup`, supervisor, simulation, and dashboard behavior.
- Do not commit or push unless the human engineer gives a separate explicit instruction.

## File Structure

- Modify `src/packaging/zip.cjs` and `src/packaging/zip.d.cts`: enforce the approved archive limits.
- Modify `src/core-native/src/config.rs`: parse checkout and standalone configuration into one validated `RuntimePaths` value.
- Modify `src/core-native/src/main.rs`: select startup mode, consume `RuntimePaths`, and return exit 2 for invalid invocation.
- Modify `src/core/processIsolation.cjs` and `src/core/processIsolation.d.cts`: name the discovery base `runtimeHome` and keep checkout callers compatible.
- Modify `src/core/mcp/server.cjs` and `src/core/mcp/server.d.cts`: accept an explicit standalone runtime home independently of the protected workspace.
- Create `src/packaging/mcpb_runtime.cjs` and `src/packaging/mcpb_runtime.d.cts`: own host selection, protected-root resolution, private installed state, binary verification/publication, and standalone config publication.
- Modify `src/packaging/launch_mcpb.cjs`; create `src/packaging/launch_mcpb.d.cts`: own daemon readiness, MCP service lifetime, signals, and exact-child cleanup.
- Modify `src/packaging/build_mcpb.cjs` and `src/packaging/build_mcpb.d.cts`: accept both release binaries and generate the standalone manifest, metadata, embedded README, and archive.
- Create `src/testing/mcpb_e2e.cjs` and `src/testing/mcpb_e2e.d.cts`: exercise only files extracted from the completed MCPB.
- Create `tests/packaging/mcpb_runtime.test.ts`, `tests/packaging/launch_mcpb.test.ts`, and `tests/testing/mcpb_e2e.test.ts`; update the existing packaging, IPC, MCP, and dashboard tests named below.
- Modify `package.json`, `.github/workflows/ci.yml`, and `.github/workflows/release.yml`: expose packaged E2E and assemble/test the bundle after both native builds.
- Modify `README.md`, `FEATURES.md`, `ROADMAP.md`, `THREAT_MODEL.md`, `docs/RELEASE.md`, and the ExplainerDrawer source/test: synchronize installation, runtime, trust-boundary, release, and FAQ contracts.

## Review Focus

- An unresolved literal such as `${user_config.protected_workspace_root}` must be rejected as an invalid nonblank directory, while ASCII/Unicode whitespace alone must select the fallback.
- Any symlink, foreign owner, group/other writable mode, or non-directory component under `KryptonSecurity` must stop startup without repairing or traversing it.
- Metadata that names the wrong architecture, repeats a path, changes size/digest, or points outside `native/` must be rejected before publication or spawn.
- A daemon that exits after readiness but before MCP stdin closes must end the MCP session and still run exact-child cleanup once.
- Canonically equivalent workspace paths must produce one instance ID; distinct Unicode paths must produce distinct fixed lowercase SHA-256 instance IDs without placing raw paths in filenames.

---

### Task 1: Raise the deterministic ZIP limits

**Files:**

- Modify: `src/packaging/zip.cjs`
- Modify: `src/packaging/zip.d.cts`
- Test: `tests/packaging/zip.test.ts`

**Interfaces:**

- Consumes: Existing `createZip(entries)` and `ZipError` API.
- Produces: The unchanged API with 128 MiB per-entry, 256 MiB aggregate, 2,048-entry, and 1,024-byte-name limits.

- [ ] **Step 1: Write failing boundary tests**

  Add `accepts an entry at the 128 MiB limit`, `rejects an entry one byte above 128 MiB`, `accepts a payload at the 256 MiB limit`, and `rejects a payload one byte above 256 MiB`. Assert successful calls return a ZIP buffer and rejected calls throw `{ code: 'size_limit' }`. Keep the buffers scoped to each test so they can be collected between cases.

- [ ] **Step 2: Run the focused tests and confirm the old 1 MiB/16 MiB limits fail them**

  Run: `npm test -- --run tests/packaging/zip.test.ts`

  Expected: FAIL on the new accepted-boundary cases.

- [ ] **Step 3: Update the ZIP constants and declaration comments**

  Set `MAX_FILE_BYTES = 128 * 1024 * 1024` and `MAX_PAYLOAD_BYTES = 256 * 1024 * 1024`; retain deterministic timestamps, byte sorting, `0644` attributes, and every existing path/collision check.

- [ ] **Step 4: Run the focused tests**

  Run: `npm test -- --run tests/packaging/zip.test.ts`

  Expected: PASS with exact-limit and one-byte-over coverage.

- [ ] **Step 5: Stop for review**

  Do not commit unless the human explicitly authorizes it. If authorized: `git add src/packaging/zip.cjs src/packaging/zip.d.cts tests/packaging/zip.test.ts && git commit -m "feat(packaging): support bounded native payloads"`.

### Task 2: Resolve checkout and standalone native configuration

**Files:**

- Modify: `src/core-native/src/config.rs`
- Modify: `src/core-native/src/main.rs`

**Interfaces:**

- Consumes: Existing checkout `RuntimeConfig`, repository-root discovery, watcher, telemetry, and IPC constructors.
- Produces:
  - `pub struct RuntimePaths { project_root: Option<PathBuf>, protected_root: PathBuf, runtime_directory: PathBuf, telemetry_file: PathBuf, instance_lock_file: Option<PathBuf>, ignored_paths: Vec<String>, observed_roots: Vec<PathBuf>, sensitive_paths: Vec<PathBuf>, telemetry_max_events: usize, telemetry_max_bytes: u64, rate_limit_window_seconds: u64, rate_limit_max_breakouts: usize }`
  - `pub enum StartupMode { Checkout, Standalone(PathBuf) }`
  - `pub struct UsageError`
  - `pub fn parse_startup_mode(args: &[OsString]) -> Result<StartupMode, UsageError>`
  - `pub fn load_runtime_paths(mode: &StartupMode, current_dir: &Path) -> Result<RuntimePaths, io::Error>`

- [ ] **Step 1: Add failing Rust tests for startup argument parsing**

  Cover zero arguments as `Checkout`, exactly `--standalone-config <absolute path>` as `Standalone`, and reject missing values, duplicate flags, unknown flags, relative paths, NUL-bearing/non-Unicode-safe misuse where constructible, and oversized path bytes. Assert invalid invocation maps to exit status 2 through a small testable `run_with_args` boundary in `main.rs`.

- [ ] **Step 2: Add failing Rust tests for standalone configuration**

  Define `StandaloneRuntimeConfig` with exact camelCase fields from the spec and assert schema version 1, absolute protected/runtime/telemetry paths, `0600` current-user regular config, non-symlink input, telemetry/instance-lock containment beneath the private instance directory, the exact private short-runtime shape, runtime outside the protected root, fixed nonzero limits, and empty `observed_roots`/`sensitive_paths`. Add failures for wrong schema, relative paths, traversal, oversized JSON, unsafe permissions, and symlink config.

- [ ] **Step 3: Run the focused Rust tests and confirm missing interfaces fail**

  Run: `cargo test --manifest-path src/core-native/Cargo.toml config::tests -- --nocapture`

  Expected: FAIL to compile until the new types and functions exist.

- [ ] **Step 4: Implement startup-mode parsing and `RuntimePaths` resolution**

  Keep `RuntimeConfig` as the checkout JSON shape. Add a private `StandaloneRuntimeConfig`, bounded no-follow file loading with ownership/mode checks, mode-specific validation, and a single conversion boundary to `RuntimePaths`. Canonicalize the protected root, normalize the private destinations, and preserve existing checkout validation.

- [ ] **Step 5: Refactor `main.rs` to use only `RuntimePaths` after startup**

  Change watcher, telemetry, and IPC construction to consume resolved absolute paths. Keep checkout observed-root behavior; standalone mode has none. Avoid `unwrap` when checking telemetry parents. Keep fixed redacted diagnostics and return exit 2 only for usage errors, exit 1 for operational failures.

- [ ] **Step 6: Run native formatting, analysis, and tests**

  Run: `cargo fmt --manifest-path src/core-native/Cargo.toml --check`

  Run: `cargo clippy --manifest-path src/core-native/Cargo.toml --all-targets --all-features -- -D warnings`

  Run: `npm run rust:test`

  Expected: PASS; existing checkout configuration tests remain green.

- [ ] **Step 7: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/core-native/src/config.rs src/core-native/src/main.rs && git commit -m "feat(native): add standalone runtime configuration"`.

### Task 3: Add explicit runtime-home IPC discovery

**Files:**

- Modify: `src/core/processIsolation.cjs`
- Modify: `src/core/processIsolation.d.cts`
- Modify: `src/core/mcp/server.cjs`
- Modify: `src/core/mcp/server.d.cts`
- Test: `tests/core/processIsolation.ipc.test.ts`
- Test: `tests/core/mcp/server.test.ts`

**Interfaces:**

- Consumes: `dispatchNativeControl(command, root)` and MCP `SessionOptions.projectRoot`.
- Produces:
  - `discoverNativeEndpoint(runtimeHome?: string): Promise<Record<string, unknown>>`
  - `dispatchNativeControl(command: Record<string, unknown>, runtimeHome?: string): Promise<Record<string, unknown>>`
  - `SessionOptions.runtimeHome?: string`, with `projectRoot?: string` retained as a checkout compatibility alias.

- [ ] **Step 1: Add failing process-isolation tests**

  Add a fixture where `runtimeHome` contains `.krypton/runtime` but no `package.json`, Cargo manifest, protected workspace, or repository markers. Assert discovery and authenticated health use that runtime directory. Retain tests for malformed metadata, symlink socket/capability, disconnect, and the 1,500 ms absolute deadline.

- [ ] **Step 2: Add failing MCP session tests**

  Assert `createSession({ runtimeHome, dispatch })` passes `runtimeHome` to dispatch, `KRYPTON_RUNTIME_HOME` takes precedence over `KRYPTON_PROJECT_ROOT`, legacy `projectRoot` still works, and a relative runtime home returns an `invalid_runtime_home` tool result without dispatch.

- [ ] **Step 3: Run focused tests and confirm failure**

  Run: `npm test -- --run tests/core/processIsolation.ipc.test.ts tests/core/mcp/server.test.ts`

  Expected: FAIL because `runtimeHome` is not yet recognized.

- [ ] **Step 4: Rename the transport boundary and extend MCP options**

  Treat the second transport argument as the directory that owns `.krypton`, without adding repository checks. Resolve the server root in this order: `options.runtimeHome`, `options.projectRoot`, `KRYPTON_RUNTIME_HOME`, `KRYPTON_PROJECT_ROOT`, checkout default. Keep the dispatch call signature and all response validation unchanged.

- [ ] **Step 5: Run focused tests**

  Run: `npm test -- --run tests/core/processIsolation.ipc.test.ts tests/core/mcp/server.test.ts`

  Expected: PASS, including legacy source-mode cases.

- [ ] **Step 6: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/core/processIsolation.cjs src/core/processIsolation.d.cts src/core/mcp/server.cjs src/core/mcp/server.d.cts tests/core/processIsolation.ipc.test.ts tests/core/mcp/server.test.ts && git commit -m "feat(core): support explicit native runtime homes"`.

### Task 4: Prepare private standalone installed state

**Files:**

- Create: `src/packaging/mcpb_runtime.cjs`
- Create: `src/packaging/mcpb_runtime.d.cts`
- Create: `tests/packaging/mcpb_runtime.test.ts`

**Interfaces:**

- Consumes: Bundle root, package version, host platform/architecture, optional configured workspace, and the generated `native/native-binaries.json`.
- Produces:
  - `class StandaloneRuntimeError extends Error { code: StandaloneRuntimeErrorCode }`
  - `resolveProtectedWorkspace(configuredValue: unknown, applicationSupportRoot: string): Promise<{ path: string, usedFallback: boolean }>`
  - `StandaloneRuntimeOptions = { bundleRoot: string, version: string, platform: NodeJS.Platform, arch: string, homeDirectory: string, configuredWorkspace?: string, applicationSupportRoot?: string, temporaryDirectory?: string }`, where `applicationSupportRoot` and `temporaryDirectory` are test-only overrides for the exact `KryptonSecurity` and canonical temporary roots.
  - `prepareStandaloneRuntime(options: StandaloneRuntimeOptions): Promise<StandaloneRuntimePaths>`
  - `StandaloneRuntimePaths = { protectedWorkspaceRoot, runtimeHome, runtimeDirectory, telemetryPath, configPath, daemonPath, workspaceId }`

- [ ] **Step 1: Write failing workspace and instance-ID tests**

  Assert omitted, empty, ASCII-whitespace, and Unicode-whitespace values create and return `<Application Support>/KryptonSecurity/sandbox_workspace`; a valid selected directory is canonicalized without creation; invalid nonblank, symlink-final-component, file, inaccessible, and unresolved `${user_config.protected_workspace_root}` values reject with `invalid_workspace`. Assert canonical aliases share a lowercase 64-hex workspace ID and distinct Unicode paths do not.

- [ ] **Step 2: Write failing private-state tests**

  Assert created security-sensitive directories are `0700`, config and the full workspace-ID marker are `0600`, raw workspace paths never occur in filenames, config/telemetry/instance lock stay beneath `instances/<workspace-id>`, and the runtime uses `<canonical-temp>/k/<short-token>/.krypton/runtime` with a socket path no longer than 103 bytes. Assert a mismatching full marker, symlink components, foreign ownership through injected metadata, group/other permissions, non-directories, or either private root nested beneath the protected root reject with `unsafe_state` and are not repaired.

- [ ] **Step 3: Write failing binary and config publication tests**

  Use minimal valid 64-bit Mach-O fixtures for CPU types `0x0100000c` and `0x01000007`. Assert exact architecture selection, bounded no-follow reads, size and SHA-256 verification, atomic private publication, destination mode `0700`, unchanged verified reuse, pre-rename preservation, and `durability_unknown` after rename. Reject wrong architecture, duplicate/escaping metadata paths, symlinks, tampered bytes, oversize input, and changed-during-read metadata.

- [ ] **Step 4: Run focused tests and confirm missing module failure**

  Run: `npm test -- --run tests/packaging/mcpb_runtime.test.ts`

  Expected: FAIL because the runtime preparation module does not exist.

- [ ] **Step 5: Implement private state preparation**

  Use only `node:fs/promises`, `node:path`, `node:crypto`, and `node:os`. Validate every sensitive component with `lstat`, current UID, and permission masks; use `O_NOFOLLOW` for files; write via private temporary files, `sync`, atomic rename, destination reopen/recheck, and directory `sync`. Generate the exact standalone schema from the spec with limits `10000`, `8388608`, `10`, and `3`, and ignored paths `node_modules`, `.git`, `.krypton`.

- [ ] **Step 6: Run focused tests**

  Run: `npm test -- --run tests/packaging/mcpb_runtime.test.ts`

  Expected: PASS with no raw paths or arbitrary exception messages in public errors.

- [ ] **Step 7: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/packaging/mcpb_runtime.cjs src/packaging/mcpb_runtime.d.cts tests/packaging/mcpb_runtime.test.ts && git commit -m "feat(packaging): prepare private standalone runtime state"`.

### Task 5: Supervise the bundled daemon from the MCPB launcher

**Files:**

- Modify: `src/packaging/launch_mcpb.cjs`
- Create: `src/packaging/launch_mcpb.d.cts`
- Create: `tests/packaging/launch_mcpb.test.ts`

**Interfaces:**

- Consumes: `prepareStandaloneRuntime`, `dispatchNativeControl({ type: 'health' }, runtimeHome)`, and `serve(input, output, { runtimeHome })`.
- Produces:
  - `waitForNativeReady(runtimeHome, child, dependencies?): Promise<void>`
  - `terminateOwnedDaemon(child, dependencies?): Promise<void>`
  - `LauncherOptions = { configuredWorkspace?: string, bundleRoot?: string, homeDirectory?: string, platform?: NodeJS.Platform, arch?: string, input?: Readable, output?: Writable }`
  - `LauncherDependencies = { prepareRuntime?, spawn?, dispatch?, serve?, now?, delay? }`
  - `runStandaloneMcpb(options?: LauncherOptions, dependencies?: LauncherDependencies): Promise<number>`

- [ ] **Step 1: Write failing host and spawn tests**

  Assert only `darwin/arm64` and `darwin/x64` reach preparation. Assert spawn receives the verified absolute daemon path, `['--standalone-config', absoluteConfigPath]`, `{ shell: false }`, and stdio that cannot share or block MCP stdout. Assert no spawn occurs for unsupported hosts, preparation failures, or CLI arguments.

- [ ] **Step 2: Write failing readiness tests**

  With injected monotonic time/delay/dispatch, assert only `{ ok: true, code: 'ready', health: { status: 'healthy' } }` starts MCP. Retry only transient unavailable/disconnected responses under a fixed attempt cap and five-second absolute deadline; reject degraded/malformed health, authentication/config errors, timeout, and child early exit. Assert each real dispatch retains its own existing 1,500 ms deadline.

- [ ] **Step 3: Write failing lifecycle tests**

  Assert clean stdin EOF, SIGINT, SIGTERM, server rejection, readiness failure, and daemon exit after readiness each settle once. Assert cleanup sends `SIGTERM` only to the spawned child, waits at most two seconds, escalates that same child to `SIGKILL`, waits at most two more seconds, and upgrades cleanup failure to exit 1. Assert an already-exited child is only reaped and never signaled by a PID read from discovery.

- [ ] **Step 4: Run focused tests and confirm failure**

  Run: `npm test -- --run tests/packaging/launch_mcpb.test.ts`

  Expected: FAIL against the checkout-dependent supervisor launcher.

- [ ] **Step 5: Implement the launcher lifecycle**

  Remove the supervisor child. Prepare state, spawn the daemon directly, perform authenticated readiness, and call `serve` in-process. Race the active MCP service against owned-daemon exit and signals; use one idempotent async cleanup promise in `finally`. Emit only stable bounded stderr categories, preserve MCP stdout, and use the shared `runCli` terminal boundary with a synchronous exact-child kill fallback for broken terminal streams.

- [ ] **Step 6: Run focused launcher, MCP, and CLI boundary tests**

  Run: `npm test -- --run tests/packaging/launch_mcpb.test.ts tests/core/mcp/server.test.ts tests/cli/runtime.test.ts`

  Expected: PASS without open handles.

- [ ] **Step 7: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/packaging/launch_mcpb.cjs src/packaging/launch_mcpb.d.cts tests/packaging/launch_mcpb.test.ts && git commit -m "feat(packaging): supervise standalone mcpb daemon"`.

### Task 6: Package both native architectures and standalone metadata

**Files:**

- Modify: `src/packaging/build_mcpb.cjs`
- Modify: `src/packaging/build_mcpb.d.cts`
- Test: `tests/packaging/build_mcpb.test.ts`

**Interfaces:**

- Consumes: Native inputs at `dist/native/krypton-core-native-aarch64-apple-darwin` and `dist/native/krypton-core-native-x86_64-apple-darwin` by default, with explicit paths supplied through the programmatic test API.
- Produces:
  - `buildBundle(projectRoot?: string, options?: { nativeInputs?: { arm64: string, x64: string } }): Promise<{ path, sha256, files }>`
  - Metadata `{ schemaVersion: 1, binaries: { arm64: { path, size, sha256 }, x64: { path, size, sha256 } } }`
  - Manifest user field `protected_workspace_root` with `type: 'directory'` and `required: false`.

- [ ] **Step 1: Replace checkout-manifest assertions with standalone assertions**

  Assert `project_root` and `KRYPTON_PROJECT_ROOT` are absent; `protected_workspace_root` is optional; the launcher receives `KRYPTON_PROTECTED_WORKSPACE_ROOT`; compatibility remains macOS/Node `>=20.19.4`; and the embedded README states the fallback path, two-tool boundary, autonomous daemon lifecycle, telemetry location, and unsigned/notarization status.

- [ ] **Step 2: Add failing native-input and inventory tests**

  Build with minimal arm64/x64 Mach-O fixtures. Assert both exact native filenames and `native/native-binaries.json` are present, `src/core/supervisor.cjs` is absent, metadata length/digests match archive bytes, output is byte-reproducible, and no builder absolute path appears. Reject missing, empty, symlinked, redirected, oversized, wrong-CPU, swapped, duplicate, or changed-during-read inputs with stable `PackagingError` codes.

- [ ] **Step 3: Run focused tests and confirm failure**

  Run: `npm test -- --run tests/packaging/build_mcpb.test.ts`

  Expected: FAIL because the current manifest requires a checkout and the archive omits native files.

- [ ] **Step 4: Implement bounded native collection and metadata generation**

  Add the new runtime helper and launcher declaration to the reviewed source inventory as appropriate. Read binaries with fixed-size chunks, `O_NOFOLLOW`, before/after descriptor and path metadata comparison, Mach-O CPU validation, and the 128 MiB limit. Generate metadata from the bytes actually added to the archive; never accept an archive path from input.

- [ ] **Step 5: Update the manifest and embedded README**

  Use `KRYPTON_PROTECTED_WORKSPACE_ROOT: '${user_config.protected_workspace_root}'`, remove checkout/supervisor claims, and describe the fallback without claiming Gatekeeper signing, built-in-tool interception, or a bundled dashboard.

- [ ] **Step 6: Run packaging tests**

  Run: `npm test -- --run tests/packaging/build_mcpb.test.ts tests/packaging/zip.test.ts`

  Expected: PASS; two builds from identical inputs have identical SHA-256 values.

- [ ] **Step 7: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/packaging/build_mcpb.cjs src/packaging/build_mcpb.d.cts tests/packaging/build_mcpb.test.ts && git commit -m "feat(packaging): bundle verified native daemons"`.

### Task 7: Add isolated packaged MCPB end-to-end verification

**Files:**

- Create: `src/testing/mcpb_e2e.cjs`
- Create: `src/testing/mcpb_e2e.d.cts`
- Create: `tests/testing/mcpb_e2e.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: A completed `.mcpb` path passed as the only CLI argument.
- Produces: `runPackagedMcpbE2E(bundlePath: string, dependencies?): Promise<void>` and package script `test:mcpb`.

- [ ] **Step 1: Write failing harness-boundary tests**

  Assert missing/extra args exit 2, non-regular/symlink/oversized archives fail closed, the complete run has one 45-second absolute deadline, extraction has a child bound and bounded output, child stdout/stderr are bounded, every JSON-RPC request has one matching response, and a separate six-second cleanup budget removes only the harness-owned temporary tree. Stall pre-scenario input/setup I/O and require parent timeout, late-rejection ownership, and owned cleanup. Use injected extraction/spawn/filesystem boundaries; unit tests must not need a real release binary.

- [ ] **Step 2: Run the focused test and confirm missing harness failure**

  Run: `npm test -- --run tests/testing/mcpb_e2e.test.ts`

  Expected: FAIL because the packaged harness does not exist.

- [ ] **Step 3: Implement isolated extraction and protocol driving**

  Create temporary HOME, extraction, protected, outside, and neutral working directories. Confirm HOME and the working directory contain no `package.json`, Cargo manifest, `krypton.config.json`, repository marker, or pre-existing daemon. Extract with `/usr/bin/unzip` using literal arguments, validate the bounded inventory and selected Mach-O architecture, then spawn only the extracted manifest launcher with the neutral directory as `cwd`. After spawn, do not `require` or read runtime modules from the checkout.

- [ ] **Step 4: Implement the custom-workspace and fallback scenarios**

  For the custom workspace, initialize MCP, send `notifications/initialized`, read an inside fixture successfully, call `krypton_read_file` for `../outside.txt`, require `isError: true` plus a native denial receipt, and require its matching JSONL telemetry event. Close stdin and prove the child exits and the Unix socket no longer accepts. Repeat with blank input and assert creation of the exact fallback directory.

- [ ] **Step 5: Add bounded PASS reporting and the package script**

  Add `"test:mcpb": "node src/testing/mcpb_e2e.cjs"`. Print separate PASS lines for custom workspace, fallback workspace, traversal denial, telemetry durability, and daemon cleanup only after all assertions and cleanup succeed.

- [ ] **Step 6: Run unit coverage for the harness**

  Run: `npm test -- --run tests/testing/mcpb_e2e.test.ts`

  Expected: PASS with no repository-dependent runtime imports.

- [ ] **Step 7: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add src/testing/mcpb_e2e.cjs src/testing/mcpb_e2e.d.cts tests/testing/mcpb_e2e.test.ts package.json && git commit -m "test(packaging): verify isolated standalone mcpb"`.

### Task 8: Assemble and gate the release artifact on both architectures

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `tests/packaging/release-artifacts.test.ts` only if artifact-contract assertions require wording or inventory updates; the three primary artifact names remain unchanged.

**Interfaces:**

- Consumes: Two `krypton-native-*` artifacts from matching runners and the new `test:mcpb` script.
- Produces: One `krypton-mcpb` artifact assembled from both exact binaries and tested on macOS arm64 and Intel before checksums/draft release.

- [ ] **Step 1: Remove checkout-dependent MCPB construction from reusable CI**

  Keep unit packaging tests in `Phase 1 verification`, but remove the `npm run build:mcpb`, ZIP inspection, and `krypton-mcpb` upload steps that run before two release binaries exist. Preserve the required job name `Phase 1 verification`.

- [ ] **Step 2: Add a release bundle assembly job**

  Make `bundle` depend on `verification` and the full `native` matrix. Check out the exact tag, install locked Node dependencies, download both native artifacts into `dist/native`, run `npm run build:mcpb`, verify ZIP integrity, and compare each archived native entry byte-for-byte with its downloaded release artifact before uploading `krypton-mcpb`.

- [ ] **Step 3: Add a packaged E2E architecture matrix**

  Run on `macos-14`/`arm64` and `macos-15-intel`/`x86_64`. Download the one bundle, run `npm ci`, execute `npm run test:mcpb -- release-artifacts/krypton-protected-fs.mcpb`, and set a bounded timeout. Do not build a daemon or read a checkout configuration during the harness.

- [ ] **Step 4: Gate draft publication on packaged E2E**

  Make `draft` depend on `verification`, `native`, `bundle`, and the E2E matrix. Download artifacts only from this workflow run, preserve the exact three-primary/seven-total checksum contract, and update draft notes to state standalone behavior plus unsigned/unnotarized limitations.

- [ ] **Step 5: Validate workflow structure locally**

  Run: `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); YAML.load_file('.github/workflows/release.yml')"`

  Run: `npm test -- --run tests/packaging/release-artifacts.test.ts`

  Expected: PASS. Manual inspection confirms every action remains SHA-pinned and only the draft job has `contents: write`.

- [ ] **Step 6: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add .github/workflows/ci.yml .github/workflows/release.yml tests/packaging/release-artifacts.test.ts && git commit -m "ci(release): gate standalone mcpb on packaged e2e"`.

### Task 9: Synchronize product, release, and dashboard documentation

**Files:**

- Modify: `README.md`
- Modify: `FEATURES.md`
- Modify: `ROADMAP.md`
- Modify: `THREAT_MODEL.md`
- Modify: `docs/RELEASE.md`
- Modify: `src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.tsx`
- Modify: `src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.test.tsx`
- Modify: Applicable JSDoc/comments in files changed by Tasks 1-8.

**Interfaces:**

- Consumes: Behavior proven by unit and packaged E2E tests.
- Produces: One consistent user/operator description of standalone installation, fallback behavior, limits, telemetry, and release gates.

- [ ] **Step 1: Update ExplainerDrawer tests first**

  Replace checkout-dependent assertions with text assertions for `protected_workspace_root`, the exact Application Support fallback, bundled arm64/x64 daemon selection, automatic lifecycle, two-tool containment scope, standalone telemetry, and unsigned/notarized status. Keep source setup and `KRYPTON_PROJECT_ROOT` documentation where it still describes `krypton setup`, rather than deleting the checkout flow globally.

- [ ] **Step 2: Run the focused dashboard test and confirm copy mismatch**

  Run: `npm test -- --run src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.test.tsx`

  Expected: FAIL until FAQ/setup copy is synchronized.

- [ ] **Step 3: Update the dashboard explainer**

  Describe released MCPB installation separately from source setup. State that the bundle supervises its daemon and needs no checkout/Rust toolchain, the fallback location, telemetry ledger behavior, macOS arm64/x64 scope, and that built-in Claude tools are outside containment.

- [ ] **Step 4: Update repository documentation**

  In the README Quick Start, install from GitHub Releases, explain optional workspace selection and fallback, give the `../outside.txt` smoke test, and state that the standalone bundle does not launch the Next.js dashboard. Update FEATURES/ROADMAP status, the installed-binary/config/lifecycle trust boundaries in `THREAT_MODEL.md`, release job graph/artifact identity checks in `docs/RELEASE.md`, local two-binary build prerequisites, Gatekeeper signing/notarization limits, and clean-machine Claude Desktop QA status.

- [ ] **Step 5: Run documentation and dashboard checks**

  Run: `npm test -- --run src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.test.tsx`

  Run: `npm run format:check`

  Run: `npm run design-system:check`

  Expected: PASS with no checkout-dependent MCPB claims remaining in `README.md`, `FEATURES.md`, `ROADMAP.md`, `THREAT_MODEL.md`, `docs/RELEASE.md`, or ExplainerDrawer.

- [ ] **Step 6: Stop for review**

  Do not commit unless explicitly authorized. If authorized: `git add README.md FEATURES.md ROADMAP.md THREAT_MODEL.md docs/RELEASE.md src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.tsx src/dashboard/components/patterns/ExplainerDrawer/ExplainerDrawer.test.tsx && git commit -m "docs: describe standalone mcpb installation"`.

### Task 10: Run the complete verification and packaged release rehearsal

**Files:**

- Verify: Every file changed in Tasks 1-9.
- Generated only: `dist/krypton-protected-fs.mcpb`, native release build outputs, temporary E2E state. Do not add them to source control.

**Interfaces:**

- Consumes: The completed implementation and locally available arm64/x64 release binaries.
- Produces: Fresh gate evidence and a reviewable working tree; no commit, push, tag, release, or live Claude Desktop mutation.

- [ ] **Step 1: Format changed sources**

  Run: `npx prettier --write "**/*.{tsx,ts,json,md}" ".github/**/*.{yml,yaml}"`

  Run: `cargo fmt --manifest-path src/core-native/Cargo.toml`

  Expected: Only intentional files change.

- [ ] **Step 2: Run every mandatory repository gate**

  Run, individually: `npm run lint`; `npx tsc --noEmit`; `npx tsc --noEmit --project src/dashboard/tsconfig.json`; `npm run format:check`; `cargo fmt --manifest-path src/core-native/Cargo.toml --check`; `cargo clippy --manifest-path src/core-native/Cargo.toml --all-targets --all-features -- -D warnings`; `npm test -- --run`; `npm run design-system:check`; `npm run rust:test`; `npm run build`; `npm run test:sim`; `npm run test:e2e`.

  Expected: Every command exits zero without unresolved warnings.

- [ ] **Step 3: Build and inspect the real bundle**

  Stage optimized arm64/x64 binaries under their exact `dist/native` names, run `npm run build:mcpb`, run `unzip -t dist/krypton-protected-fs.mcpb`, inspect `manifest.json` and `native/native-binaries.json`, and compare each embedded binary byte-for-byte with its staged source.

  Expected: One deterministic MCPB with both matching native entries and no repository path, runtime secret, telemetry, `.env`, or development dependency.

- [ ] **Step 4: Run packaged E2E on each matching host architecture**

  Run: `npm run test:mcpb -- dist/krypton-protected-fs.mcpb`

  Expected: PASS lines for custom workspace, fallback workspace, traversal denial, telemetry durability, and daemon cleanup. Repeat on both macOS arm64 and Intel; local evidence from only one architecture must be reported as partial until hosted matrix results exist.

- [ ] **Step 5: Inspect the final working tree**

  Run: `git diff --check`

  Run: `git status --short`

  Run: `git diff --stat`

  Expected: No generated artifact, Application Support runtime state, capability, socket, telemetry ledger, environment file, or unrelated user file is staged or tracked.

- [ ] **Step 6: Record remaining release gates**

  Report Developer ID signing, notarization, Gatekeeper behavior, clean-machine Claude Desktop installation, hosted arm64/x64 workflow execution, and final publication as incomplete unless separately demonstrated. Do not claim the beta is frictionless or public-launch ready from local tests alone.
