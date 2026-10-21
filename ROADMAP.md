# Krypton Product Roadmap

This roadmap defines Krypton's prioritized release sequence. Status labels
separate repository implementation from remaining or proposed work; a planned
milestone or target entitlement is not a claim that the protection exists today.

The [documentation index](docs/index.md) and [end-user testing guide](docs/testing-guide.md)
are also rendered in the Next.js public site under `/docs/`, linked from
**About & Guide**. Static dashboard data remains demonstration-only; the guide
explains how to distinguish native acceptance evidence.

## Roadmap-wide Architectural Invariants

Every phase and commercial tier must preserve these boundaries:

- Core policy, process-identity, enforcement, and telemetry-validation loops
  remain local, deterministic, bounded, and free of remote calls.
- Unknown policy states and unsupported enforcement paths fail closed. Krypton
  never signals an arbitrary PID: isolation remains limited to an explicitly
  registered child whose PID, start time, executable path, and parent PID match
  live operating-system evidence.
- Portable watcher events remain explicitly unattributed unless an OS adapter
  supplies trustworthy actor evidence. Inferred agent labels are explanatory
  telemetry, not process-control authority.
- Native telemetry remains distinct from static or mock demonstration data and
  retains at most 10,000 events or 8 MiB. Source mode uses
  `.krypton/telemetry/alerts.jsonl`; standalone mode uses the private Application
  Support instance ledger.
- Platform, desktop, host, and fleet integrations must advertise their actual
  enforcement capability. A missing or degraded adapter must never silently
  downgrade a requested enforcing workflow to observation-only behavior.
- Licensing or subscription state must never weaken, delay, or remotely gate the
  individual workstation containment boundary. Paid capabilities operate around
  local enforcement rather than inside its decision loop.

### Universal Agent Bypass Containment

Krypton treats **Bypass Permissions**, **Auto**, **Full Access**, and **YOLO**
modes in clients such as Claude Code, Cursor Composer, Codex CLI, and Aider as
application-layer prompt suppressors, not operating-system authorization tokens.
When an agent is launched through Krypton's protected runner, its initial registered
child remains subject to the enabled controls regardless of the client's approval
configuration. The MCP file tools enforce native path checks; descendant and
syscall containment remain planned and other host tools are not intercepted. The README and Field Guide Full Access FAQ distinguish
protected MCP calls, raw sh/bash operations, standalone ledgers and mock Pages
data; installing the bundle never redirects all host file operations.

---

## Phase 1: Local Developer Verification, Containment Core & Release Hardening (Completed & Shipped — Release v1.0.2)

**Status:** Completed & Shipped (Release v1.0.2).

**Release Objective:** Deliver a direct local evaluation experience. A macOS user
should be able to install the released MCPB in Claude Desktop and verify native
containment against a Krypton tool call within 60 seconds, without cloning the
repository, installing Rust, or editing client JSON manually.

[v1.0.2 is live](https://github.com/mwarnsley/krypton-security/releases/tag/v1.0.2)
with dual-architecture native daemon supervision (`arm64` and `x86_64`), a
standalone `.mcpb` bundle, and verified release ancestry gates. Phase 1 delivers
the local containment, telemetry rendering, and protected release workflow.
The 60-second onboarding goal remains an unmeasured target, not a performance
guarantee. Source setup separately requires dependencies and a compiled native binary. The
source launcher reuses a healthy daemon or auto-starts one with bounded readiness;
its detached Node host owns the daemon beyond MCP disconnect while each client
retains its child registration lifecycle. The optional source Next.js viewer
is started with `npm run dev:dashboard`; the standalone bundle does not include it.

**v1.0.3 follow-up polish:** Source auto-spawning, unified dashboard branding, and
accurate audit-mode guidance are implemented in the working tree. The package
version remains `1.0.2`; these completed implementation items do not claim a
published v1.0.3 release or completion of the public-trial gates below.

### 1. Local Frictionless Onboarding (Must-Have for HackerNoon)

- [x] **Local contributor quality gate:** Versioned pre-push checks validate a clean checkout and the pushed commit, run targeted AlertTable actions, full verification and formatting, and stop on failure. `npm run hooks:install` activates them per checkout. AGENTS requires the same targeted/full gates before authorized commits, explicit DOM/clipboard wait ceilings of at most 3 seconds, and afterEach mock restoration. These checks do not replace hosted CI or alter native security deadlines.
- [x] **Mandatory Error-Handling Audit Gate:** Document the three-tier contract, audit all native/core/CLI entry points, remediate failures and record fresh verification in `AGENTS.md` before further Phase 1 features.
- [x] **Universal Single-Command Client Config (`krypton setup`):** Detect existing Claude Desktop, Cursor, Claude Code, and Cline storage on macOS/Linux; atomically back up existing JSON, preserve other servers, and install `krypton-protected-fs` with canonical supervisor paths and `KRYPTON_PROJECT_ROOT`. Malformed files and conflicting entries fail closed. `npm run setup` works without global linking.
- [x] **Supervisor Cold-Start & Daemon Lifecycle:** `src/cli.cjs run` probes authenticated IPC, reuses a healthy daemon, or starts the compiled background native daemon on demand before launching the MCP child. Readiness retries have a three-second budget after host spawn; the initial 1500 ms probe and filesystem preparation are separate. Authentication failures and degraded health fail closed. A refused/disconnected registration gets one authenticated refresh and exact-identity retry; native registration accepts a repeated live identity without replacing stale generations. Native startup-lock arbitration removes only refused orphan sockets. SIGINT/SIGTERM/beforeExit cancel recovery and request owned-child shutdown. The source daemon survives client disconnect while each MCP child unregisters on exit; no manually running `npm run dev:full` or active daemon terminal is required before opening Claude Desktop.
- [x] **Double-Click Source Setup:** `Install-Mac.command` invokes atomic client configuration and a bounded completion notice without instructing users to run terminal watchers. It opens Terminal automatically and still requires a prepared checkout, Node on PATH, installed dependencies, and a compiled native binary. Dependency-free, zero-terminal distribution is a separate public-trial gate; the standalone `.mcpb` remains the existing no-checkout route.
- [x] **Standalone `.mcpb` Generator:** `npm run build:mcpb` outputs `dist/krypton-protected-fs.mcpb`, a deterministic MCPB 0.3 archive containing the production server, standalone launcher, required JavaScript dependencies, and verified arm64/x64 native daemons. The archive manifest has zero mandatory setup fields and no checkout-directory requirement. `protected_workspace_root` is optional; blank input creates `~/Library/Application Support/KryptonSecurity/sandbox_workspace`. The launcher selects and supervises its exact native child, while private configuration and telemetry remain outside the protected root. Concurrent Claude Desktop launches of one workspace share that daemon: lock-election losers attach through authenticated private discovery without signaling it, and take over with at most two bounded rounds when the owner exits. Cold-start preparation adopts a sibling's identical publication. No checkout or Rust toolchain is required after installation. The bundle is unsigned and unnotarized, excludes the Next.js dashboard and local runtime state, with clean-machine Claude Desktop and Gatekeeper checks retained for ongoing release QA.
- [x] **Deterministic Local Test Harness (`npm run test:e2e`):** Boots a disposable native daemon fixture, exercises production MCP stdio read/write and traversal denial, verifies durable native receipts mapped to `INTERCEPTED`, fail-closed socket loss and owned-child `SIGKILL`, then cleans up and prints a pass/fail terminal report. Desktop notification delivery is mocked; live client and dashboard QA remain separate.
- [x] **Isolated Packaged Harness (`npm run test:mcpb -- <archive>`):** Extracts only an allowlisted MCPB inventory into bounded temporary storage, isolates HOME and working directories, and verifies custom/fallback workspace selection, traversal denial, durable standalone telemetry, exact-child exit, and post-exit socket nonacceptance without repository markers. The private temporary runtime home may retain runtime files after shutdown. Local runs cover one architecture; the release workflow defines matching arm64 and x86_64 jobs.

### 2. Containment Engine & Native IPC (Must-Have)

- [x] **Native macOS Watchdog Daemon:** Rust core maintaining compound identities, revalidating registered children before isolation, and exposing authenticated local IPC via `.krypton/runtime/daemon.sock`.
- [x] **Fail-Closed Path Policy:** Strict lexical traversal rejection (`..`) and workspace canonicalization via `path_policy.rs`.
- [x] **Universal Stdio Entry:** Bare `node src/cli.cjs run` and the locally linked `krypton-mcp run` bin expose MCP to Claude Desktop, Claude Code, Cursor, Codex CLI and standard stdio hosts on supported macOS architectures. Prepared source installs use their release daemon without bundle extraction; the workspace environment variable has a validated private fallback. Electron event-only stdin, canonical host-shim entry detection, backpressure, teardown, startup rejection ownership, host-loaded exit settlement, exit-time owned-daemon SIGKILL fallback and the unexpanded `${user_config.protected_workspace_root}` sandbox fallback have regression coverage. Registry publication and native-binary npm delivery remain release work; live client UI QA remains manual.
- [x] **Production Native MCP Server:** `src/core/mcp/server.cjs` serves bounded stdio `krypton_read_file` and `krypton_write_file` calls with local JSON Schema 2020-12 validation. `dispatchNativeControl` sends authenticated `mcp_file` requests to the Rust daemon, which evaluates paths and performs descriptor-relative file access. Denials return `isError: true` inside `result` with native receipts. Missing or incompatible daemons fail closed. Calls support up to 2 KiB of UTF-8 content and 1 KiB paths; only these tools are contained.
- [x] **Live Telemetry Emission:** Native MCP denials queue structured receipts to the bounded source or standalone JSONL ledger, retaining tool, requested path, timestamp, and denial action. Queue admission is distinct from durable persistence; write/queue failures degrade health. Dashboard rows show `INTERCEPTED`, with no invented actor PID or SIGKILL claim. The standalone MCPB persists telemetry under its private Application Support instance and does not bundle or launch the dashboard.

### 3. Krypton Security Dashboard & Telemetry Verification (Must-Have)

- [x] **Split dashboard summary:** At 1024px and above, two equal-height cards share the top section: workspace identity, guide/theme utilities and Engine Overview on the left; Watchdog status, active processes and audit/telemetry controls on the right. Both use 24px padding. About Guide sits beside Engine Overview; the theme toggle stays in the top-right workspace header. A three-column runtime panel shows child count, centered retained alert-list count and right-aligned boundary status with the dashboard release version. Below 640px the metrics stack; above 9,999 counts use compact notation with an exact tooltip and accessible label. The alert count is bounded to the current list, can include observations and is not a lifetime rejection total, with audit and telemetry aligned across its footer. A neutral hover/focus/tap tooltip before Intercepted Alerts lists all five loaded severity counts, keeping the metric uncluttered; Escape dismisses it. Table badges use shared AA-tested colors and soft matching borders; table help precedes labels, sorting follows, and action controls align right with visible hover/focus states. The Actions header keeps one unboxed info icon on the left; hover or click opens an icon-led four-section guide to available developer utilities anchored to that icon. Escape dismisses it. Target Path, Security Verification and Blocked (Unattributed) use plain-language labels, and tooltips distinguish recorded evidence from cryptographic signing. Audit mode copy retains the supervised-process and always-blocked file boundary. Degraded/offline states do not claim active containment. Smaller screens stack workspace, runtime, then the full-width activity log. Content uses the full viewport with 16px/24px side padding. About Guide is unconditional in development, production and Pages; its former environment/hostname gate and public guide marker are removed. Static export remains mock-only.
- [x] **Dual-theme Field Guide:** Semantic light/dark palettes, a persistent-when-available header toggle, contrast-tested text/control tokens, keyboard focus, and selectable copyable peer-test cards.
- [x] **Embedded peer-test walkthrough:** Method 1 is a sectioned card with separate download/install steps, 16px spacing and theme-aware copy boxes for the exact filename, optional field and default folder. Plain-language instructions retain Cmd + , / Cmd + Q and version-dependent installer fallback. Requested v1.0.3 bundle link with private/unavailable sharing instructions, blank optional workspace setup, baseline read/write, three denial prompts, symlink prerequisites, and source/standalone/Pages evidence distinctions.
- [ ] **Manual accessibility and client QA:** Verify both themes with Lighthouse (target 95+), screen readers, keyboard/reflow checks, and clean-machine Claude Desktop installation. Automated contrast/component checks alone do not establish full WCAG compliance or release asset availability.

- [x] **Live Local Telemetry Stream:** Next.js dashboard parsing `.krypton/telemetry/alerts.jsonl` with clear distinctions between confirmed native receipts and unconfirmed observations.
- [x] **Intercepted Breach Visualizer:** Delivered native denial telemetry rendering in v1.0.2: the local dashboard displays the timestamp, blocked path, Krypton tool name, and recorded enforcement action. Portable watcher evidence remains unattributed; built-in host tools remain outside the MCP boundary.
- [x] **Desktop OS Notification Integration:** Trigger macOS Notification Center alerts via `/usr/bin/osascript` upon confirmed child process isolation.

### 4. Release Hardening & Automated Delivery (Must-Have)

- [x] **GitHub Actions CI/CD Pipeline:** `.github/workflows/ci.yml` defines a reusable `macos-14` gate for PRs and pushes to `main`: locked installation, lint, both TypeScript projects, formatting, Rust Clippy, Vitest, native unit tests, socket simulation, source E2E containment, dashboard build and security audit. The v1.0.2 release ships through these verification gates.
- [x] **Strict Branch Protection & Automated PR Gates:** Delivered for v1.0.2 through [PR #27](https://github.com/mwarnsley/krypton-security/pull/27) and owner-managed branch policies. The workflow fetches `origin/main` before checking tag ancestry and rejects commits not reachable from main. Branch-policy enforcement is configured in GitHub, separately from workflow source.
- [x] **Automated SemVer Release Packaging:** `.github/workflows/release.yml` validates a matching package version and main ancestry for `v*.*.*` tags, reuses CI gates, builds `x86_64-apple-darwin` and `aarch64-apple-darwin` optimized binaries, downloads both into one standalone bundle job, and byte-compares the embedded archive entries with those exact artifacts. Matching-host packaged-E2E jobs must pass before the draft job attaches the two binaries, tested MCPB, three sidecars, and `SHA256SUMS`. v1.0.2 is published; signing and notarization remain future work, with Gatekeeper and clean-machine Claude QA retained as ongoing release checks.
- [x] **Agent GitHub Integration Contracts:** Document repository-scoped fine-grained PAT permissions for GitHub MCP and `gh`, secret storage, read-only defaults, explicit authorization for remote writes and prohibition of protection bypasses. Workflows use job-scoped `GITHUB_TOKEN`, never a personal PAT.
- [x] **Dependency Supply-Chain Auditing:** PR CI enforces zero npm vulnerabilities at every severity through `npm run security:audit`, including dev dependencies. Existing Rust advisory/license checks and SBOM generation remain supplementary gates; network or audit errors fail the check.

See [release and repository contracts](docs/RELEASE.md) for artifact names,
required check contexts, credential boundaries and activation verification.

---

## Phase 2: Transparent Developer Experience & Distribution (v1.1)

**Status:** In progress. Auto-spawn and dashboard polish are implemented; the
public-trial gates and broader v1.1 distribution work remain open.

**Release Objective:** Expand beyond source checkouts to system-wide developer adoption via native package managers and prebuilt binaries.

### Pre-HackerNoon & Public Trial Gate (Target: Early Next Week)

Complete these milestones in order before the public trial. The timing is a
target, not a claim of release readiness; manual evidence and distribution checks
must pass before marking the remaining gates complete.

1. [x] **Supervisor Daemon Auto-Spawn & Recovery:** On-demand background daemon startup during MCP client connection removes the manual daemon-terminal requirement. A new session can recover from an unavailable daemon by starting a compiled binary; authentication failures, degraded health, and failed tool writes are not retried into success. Existing healthy daemons are reused; one refused/disconnected registration can refresh discovery and retry its revalidated exact identity. Native startup-lock arbitration refreshes refused orphan sockets without unlinking live service endpoints. Readiness is bounded, shutdown cancels recovery, and client exit unregisters the child without stopping the shared source service.
2. [x] **Unified Krypton Dashboard Branding & Audit Mode Tooltips:** The Next.js UI uses Krypton Security branding and explains the native Audit-Only startup default: telemetry observation without child termination. Active Protection permits isolation only of owned, registered children after live identity verification. Both modes enforce hard fail-closed denial of unsafe MCP reads/writes; static demonstrations do not change native policy.
3. [ ] **Active Quarantine & Desktop Alert Verification:** Run a controlled end-to-end scenario involving `sandbox_workspace`, verify confirmed isolation of an owned, registered child, and visually capture the native macOS **"Krypton quarantine confirmed"** banner. Record the native receipt and notification-permission conditions. Automated mocked-delivery tests already exist; an individual file denial or unattributed watcher event does not by itself prove quarantine or trigger this banner. This gate does not claim automatic file relocation or arbitrary process containment.
4. [ ] **Release Packaging Audit (Zero-Terminal Distribution):** Audit the existing standalone `krypton-protected-fs.mcpb` release artifact for one-click Claude Desktop import on clean macOS systems, including checksums and unsigned/Gatekeeper behavior. Validate and package the proposed global npm/npx runner (`npx krypton-security setup`) before advertising it as supported; publication, native-binary delivery, and Node prerequisites remain to be resolved. An npx command is a terminal alternative, not itself a zero-terminal installer.
5. [ ] **3-Minute Friends & Testers Quickstart:** Publish and time a concise clean-machine guide whose user workflow is double-clicking an installer or loading the `.mcpb` extension in a supported client, with no source-development prerequisites. Validate protected-tool registration and one native denial receipt, and explain where to inspect evidence. The README now opens with a macOS alpha bundle quickstart and two copy-paste verification prompts; the Field Guide mirrors the write-success and read-denial checks. Its two-minute onboarding / 60-second verification targets still require timed clean-machine beta validation. This gate remains open; the current source-checkout script does not satisfy the prerequisite-free installer goal.

### Broader Distribution & Developer Experience Milestones

- [x] **Source-checkout double-click onboarding:** `Install-Mac.command` reuses atomic client setup and attempts a bounded completion notification. A prepared checkout, Node on PATH, `npm ci`, and `cargo build --release --manifest-path src/core-native/Cargo.toml` are required. Restarting clients triggers automatic native startup with a three-second readiness budget after host spawn; the initial 1500 ms IPC probe and filesystem preparation are separate. Authentication and degraded health fail closed without replacing the existing daemon. `npm run dev:full` is not required for protection. `Install-Windows.cmd` reports unsupported native setup without changing settings; Windows containment remains Phase 4. README and Field Guide cover live MCP denial verification and troubleshooting, separately from desktop quarantine banners.
- [ ] **Homebrew Tap:** Package prebuilt native binaries at `krypton-security/tap/krypton`.
- [ ] **Shell One-Liner:** Host a hardened shell installer at `https://get.krypton.dev`.
- [ ] **Client-Side Telemetry Visualizer (Web Dashboard Bridge):** Enable the static web dashboard (`mwarnsley.github.io/krypton-security/`) to read and visualize a local `alerts.jsonl` file via the browser File System Access API / file picker. This remains unavailable today: Pages uses mock data, and the source viewer does not automatically load standalone Application Support ledgers. The planned bridge would provide non-technical users with live audit inspection without requiring a local Next.js Node server or CLI execution before the Phase 3 Tauri desktop app ships.
- [ ] **Process Tree & Descendant Containment:** Track agent child processes recursively through process generations.
- [ ] **Network Egress Isolation:** Process-level macOS Seatbelt profiles and domain allowlisting.

---

## Phase 3: Desktop App & Power-User Features (v1.2–v1.3)

**Status:** Planned.

**Release Objective:** Package the dashboard and daemon into a menu-bar application for non-terminal workflows.

- [ ] **Tauri Desktop Shell:** Bundle the React UI and Rust daemon into a lightweight (<10 MB) `.dmg`/`.app`.
- [ ] **Interactive Allowlisting:** 1-click rules from intercepted alert notifications.
- [ ] **Incident Export & Kill-Cam:** Exportable forensic summaries for security compliance.

---

## Phase 4: Enterprise Cross-Platform & Fleet Systems (v2.0)

**Status:** Planned.

- [ ] Windows Named Pipes and Job Object containment.
- [ ] Linux Landlock LSM and seccomp-bpf sandboxing.
- [ ] Multi-seat fleet console and SOC 2 / EU AI Act compliance evidence exports.

---

## Future Milestones: Remediation, Signing & Licensing

- [ ] **Active process remediation:** Add an explicit operator-triggered
      SIGKILL / Force Stop workflow, preserving registered ownership, live compound
      identity checks and audit evidence. No Force Stop action or upgrade notice is
      exposed in the current dashboard.
- [ ] **Cryptographic report-signing key infrastructure:** Design signing-key
      generation, secure storage, rotation, trust distribution and report verification
      before offering cryptographically signed Markdown threat reports. Current
      reports remain explicitly unsigned diagnostic exports.
- [ ] **Enterprise / Pro licensing & enforcement:** Design entitlement validation
      and paid activation for future remediation, remote agent orchestration and fleet
      policy lockdown. No paid entitlement service is implemented. Licensing must not
      weaken or delay automatic local boundary denial or add remote calls to security
      enforcement hooks. Commercial plans remain in this roadmap, outside dashboard
      menus, tooltips and Field Guide copy.

Existing native control APIs and automatic local enforcement are unchanged. The
current dashboard exposes only JSON inspection, process-detail copy, allowed-folder
inspection and unsigned Markdown report downloads.

## Commercialization Matrix (Open-Core)

Community capabilities ship in v1.0.2. Paid packaging, pricing, and capabilities
below define the commercial strategy and remain planned. macOS is supported;
Linux native execution remains experimental, and Windows remains dashboard-only
until the Phase 4 runtime ships.

| Tier                   | Pricing            | Included capabilities                                                                                                                                                                                           |
| :--------------------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Community**          | Free / Open Source | Standalone local `.mcpb`, native daemon watchdog, local JSONL ledger, and local Next.js telemetry viewer with JSON/process/folder diagnostics and unsigned Markdown reports (separate source-mode application). |
| **Pro**                | $19–$29/user/mo    | Community plus planned manual process remediation, multi-agent local profiles, APFS snapshot rollbacks, instant desktop/webhook notifications (Slack/Discord), and cloud-synced dynamic threat feeds.           |
| **Enterprise / Fleet** | $49–$99/seat/mo    | Pro plus centralized fleet console, remote kill-switch orchestration, SIEM forwarding (Splunk, Datadog, OpenTelemetry), and tamper-evident compliance evidence exports supporting SOC 2 / EU AI Act workflows.  |

Developer Pro targets $29/user/month at launch within the proposed Pro range.
Enterprise Governance uses annual contracts with a $15,000 ARR floor. Existing
local macOS isolation notifications remain available in Community; Pro adds
notification integrations and profile-aware workflows. Compliance exports are
planned evidence tooling, not certification or a guarantee of compliance.

**Core invariant:** The individual local workstation containment boundary is
never gated, degraded, or delayed by licensing state. Cloud-synced feeds are
validated and applied locally outside the enforcement loop. Future remote
kill-switch orchestration must still require local authorization, registered
ownership, and live compound-identity revalidation; it cannot signal arbitrary
PIDs or bypass local policy. A cloud or subscription outage must not weaken the
local boundary.
