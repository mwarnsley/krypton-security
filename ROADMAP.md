# Krypton Product Roadmap

This roadmap defines Krypton's prioritized release sequence. Status labels
separate repository implementation from remaining or proposed work; a planned
milestone or target entitlement is not a claim that the protection exists today.

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
syscall containment remain planned and other host tools are not intercepted.

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
guarantee. Source setup separately requires dependencies and a running checkout
daemon; the standalone bundle does not include the Next.js viewer.

### 1. Local Frictionless Onboarding (Must-Have for HackerNoon)

- [x] **Mandatory Error-Handling Audit Gate:** Document the three-tier contract, audit all native/core/CLI entry points, remediate failures and record fresh verification in `AGENTS.md` before further Phase 1 features.
- [x] **Universal Single-Command Client Config (`krypton setup`):** Detect existing Claude Desktop, Cursor, Claude Code, and Cline storage on macOS/Linux; atomically back up existing JSON, preserve other servers, and install `krypton-protected-fs` with canonical supervisor paths and `KRYPTON_PROJECT_ROOT`. Malformed files and conflicting entries fail closed. `npm run setup` works without global linking.
- [x] **Standalone `.mcpb` Generator:** `npm run build:mcpb` outputs `dist/krypton-protected-fs.mcpb`, a deterministic MCPB 0.3 archive containing the production server, standalone launcher, required JavaScript dependencies, and verified arm64/x64 native daemons. `protected_workspace_root` is optional; blank input creates `~/Library/Application Support/KryptonSecurity/sandbox_workspace`. The launcher selects and supervises its exact native child, while private configuration and telemetry remain outside the protected root. No checkout or Rust toolchain is required after installation. The bundle is unsigned and unnotarized, excludes the Next.js dashboard and local runtime state, with clean-machine Claude Desktop and Gatekeeper checks retained for ongoing release QA.
- [x] **Deterministic Local Test Harness (`npm run test:e2e`):** Boots a disposable native daemon fixture, exercises production MCP stdio read/write and traversal denial, verifies durable native receipts mapped to `INTERCEPTED`, fail-closed socket loss and owned-child `SIGKILL`, then cleans up and prints a pass/fail terminal report. Desktop notification delivery is mocked; live client and dashboard QA remain separate.
- [x] **Isolated Packaged Harness (`npm run test:mcpb -- <archive>`):** Extracts only an allowlisted MCPB inventory into bounded temporary storage, isolates HOME and working directories, and verifies custom/fallback workspace selection, traversal denial, durable standalone telemetry, exact-child exit, and post-exit socket nonacceptance without repository markers. The private temporary runtime home may retain runtime files after shutdown. Local runs cover one architecture; the release workflow defines matching arm64 and x86_64 jobs.

### 2. Containment Engine & Native IPC (Must-Have)

- [x] **Native macOS Watchdog Daemon:** Rust core maintaining compound identities, revalidating registered children before isolation, and exposing authenticated local IPC via `.krypton/runtime/daemon.sock`.
- [x] **Fail-Closed Path Policy:** Strict lexical traversal rejection (`..`) and workspace canonicalization via `path_policy.rs`.
- [x] **Production Native MCP Server:** `src/core/mcp/server.cjs` serves bounded stdio `krypton_read_file` and `krypton_write_file` calls with local JSON Schema 2020-12 validation. `dispatchNativeControl` sends authenticated `mcp_file` requests to the Rust daemon, which evaluates paths and performs descriptor-relative file access. Denials return `isError: true` inside `result` with native receipts. Missing or incompatible daemons fail closed. Calls support up to 2 KiB of UTF-8 content and 1 KiB paths; only these tools are contained.
- [x] **Live Telemetry Emission:** Native MCP denials queue structured receipts to the bounded source or standalone JSONL ledger, retaining tool, requested path, timestamp, and denial action. Queue admission is distinct from durable persistence; write/queue failures degrade health. Dashboard rows show `INTERCEPTED`, with no invented actor PID or SIGKILL claim. The standalone MCPB persists telemetry under its private Application Support instance and does not bundle or launch the dashboard.

### 3. AegisAgent Dashboard & Telemetry Verification (Must-Have)

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

**Status:** Planned.

**Release Objective:** Expand beyond source checkouts to system-wide developer adoption via native package managers and prebuilt binaries.

- [ ] **Homebrew Tap:** Package prebuilt native binaries at `krypton-security/tap/krypton`.
- [ ] **Shell One-Liner:** Host a hardened shell installer at `https://get.krypton.dev`.
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

## Commercialization Matrix (Open-Core)

Community capabilities ship in v1.0.2. Paid packaging, pricing, and capabilities
below define the commercial strategy and remain planned. macOS is supported;
Linux native execution remains experimental, and Windows remains dashboard-only
until the Phase 4 runtime ships.

| Tier                   | Pricing            | Included capabilities                                                                                                                                                                                          |
| :--------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Community**          | Free / Open Source | Standalone local `.mcpb`, native daemon watchdog, local JSONL ledger, and local Next.js telemetry viewer (separate source-mode application).                                                                   |
| **Pro**                | $19–$29/user/mo    | Community plus multi-agent local profiles, APFS snapshot rollbacks, instant desktop/webhook notifications (Slack/Discord), and cloud-synced dynamic threat feeds.                                              |
| **Enterprise / Fleet** | $49–$99/seat/mo    | Pro plus centralized fleet console, remote kill-switch orchestration, SIEM forwarding (Splunk, Datadog, OpenTelemetry), and tamper-evident compliance evidence exports supporting SOC 2 / EU AI Act workflows. |

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
