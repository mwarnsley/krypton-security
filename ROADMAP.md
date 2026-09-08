# Krypton product roadmap

This roadmap defines Krypton's prioritized release sequence. Status labels
separate repository implementation from remaining or proposed work; a planned
milestone or target entitlement is not a claim that the protection exists today.

## Roadmap-wide architectural invariants

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
  retains at most 10,000 events or 8 MiB in
  `.krypton/telemetry/alerts.jsonl`.
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
When an agent is launched through Krypton's protected runner, its registered
process tree remains subject to the same deterministic path, process, and enabled
syscall-boundary controls regardless of the client's approval configuration.

On the current Unix runtime, an enforcement decision may terminate only an
explicitly registered child after its PID, start time, executable path, and parent
PID have been revalidated; the deterministic termination mechanism is `SIGKILL`.
This guarantee does not extend to an unwrapped process or an unavailable native
adapter, and it does not imply that portable watcher events can identify an
actor. Future Windows enforcement uses registered Job Object containment rather
than POSIX signals and remains a Phase 4 capability.

## Phase 1: Native macOS Hardening & Public Launch (Current Release / v1.0)

**Release objective:** Complete the supported macOS launch around the existing
native containment foundation and make native quarantine events visible outside
the browser.

### Implemented in the repository

- [x] **Native macOS watchdog daemon:** The Rust runtime maintains compound
      process identities, revalidates registered children before Unix signal
      isolation, and exposes authenticated local IPC through
      `.krypton/runtime/daemon.sock`.
- [x] **AegisAgent Command Center:** The Next.js 16 dashboard incrementally
      presents bounded native JSONL telemetry from
      `.krypton/telemetry/alerts.jsonl`, limits client rendering to 500 rows,
      and distinguishes native evidence from mock data.
- [x] **Offline deterministic security loop:** Repeated policy and registry
      membership uses native `Set` or `Map` lookups with average-case $O(1)$
      cost. Lexical path normalization and inspection remain $O(L)$ in path
      length. Core security decisions make no remote calls.
- [x] **Public demonstration sandbox:** The GitHub Pages build runs without
      native API routes, begins with an empty simulated ledger, and creates a
      clearly labeled mock event only when a visitor selects the threat trigger.
      The interactive Explainer Drawer documents the product boundary and its
      limitations.

### Remaining v1.0 public-launch milestone

- [ ] **Desktop OS Alert Integration:** Deliver a headless native macOS
      notification adapter for confirmed background quarantine events so a
      developer receives an immediate workstation alert outside the browser.
      Notifications must be emitted only after authenticated daemon evidence
      confirms an owned child was quarantined, must follow the existing redaction
      policy, and must not block watcher or enforcement threads. Phase 3 will
      reuse this event path inside the Tauri application.

### Phase 1 completion criteria

- The notification adapter has deterministic unit coverage with operating-system
  delivery mocked and an explicit no-permission/degraded path.
- Notification failure cannot reverse a deny or quarantine decision, stall the
  daemon, or relabel unattributed watcher evidence as a confirmed actor event.
- macOS installation, permissions, disablement, and troubleshooting guidance is
  synchronized across the README and dashboard guide.

## Phase 2: Transparent Developer Experience & Zero-Config CLI (v1.1)

**Status:** Planned.

**Release objective:** Make explicit protected launching feel native to existing
developer workflows while preserving verifiable process ownership.

### Zero-Friction Packaging & Distribution

**Status:** Planned (immediate Phase 2 target).

- [ ] Publish standalone, versioned Krypton binaries through a Homebrew tap so a
      supported macOS workstation can install with:

  ```sh
  brew install krypton-security/tap/krypton
  ```

- [ ] Publish a hardened shell installer at `https://get.krypton.dev` so a
      supported workstation can install with:

  ```sh
  curl -fsSL https://get.krypton.dev | sh
  ```

- [ ] Remove Rust compilation and Node.js runtime requirements from end-user
      execution. Release artifacts must remain platform-specific, checksummed,
      signed, provenance-linked, and reproducibly generated by release CI; the
      installation script must verify the selected artifact before execution.
- [ ] Establish a measured time-to-first-containment target below 30 seconds from
      the start of installation to a successfully protected `krypton exec`
      session on a supported clean workstation. This is a target, not a current
      guarantee.

### Wrap & Run CLI Wrapper (`krypton exec`)

- [ ] Provide one command that starts an explicitly protected tool or autonomous
      agent without requiring Docker or a devcontainer:

  ```sh
  krypton exec -- claude
  krypton exec -- cursor .
  ```

- [ ] Canonicalize the invocation directory as the requested workspace boundary,
      validate it against Krypton's protected-root policy, start or discover the
      workspace daemon, and register the initial child before returning control.
- [ ] Track descendants as a process tree through compound identity evidence and
      expire every registration with its process generation. Near-zero overhead
      means no polling loop or remote decision lies on the path-policy hot path.
- [ ] Preserve native macOS execution speed and tool behavior without requiring a
      container runtime. Zero-config applies only after the supported Krypton
      binary is installed; permissions or unsupported adapters must produce an
      explicit fail-closed error.

### Safe Auto-Pilot (Safe YOLO Mode Guardrail)

- [ ] Add supported host adapters that may auto-approve operations only when the
      canonical target and registered child remain inside the active workspace
      policy.
- [ ] Halt and quarantine registered children attempting parent-directory escape
      or access to denied credential locations such as `~/.ssh`, `~/.aws`, and
      `~/.env`.
- [ ] Enforce outbound-port policy only where a native network mediation adapter
      can prove the initiating process and destination. Without that adapter,
      Krypton must reject an enforcing Safe Auto-Pilot session rather than claim
      network containment.
- [ ] Keep unattended execution bounded by explicit session lifetime, process
      ownership, event-rate, and telemetry-retention limits. Host approval APIs
      remain integration-specific; Krypton must not claim it can bypass or
      universally control third-party permission systems.

### Network Egress Isolation & Domain Allowlisting (Phase 2/3 Planned)

**Status:** Planned.

**Objective:** Prevent data exfiltration after an unauthorized file read or
prompt-injection attempt by constraining outbound communication for processes
launched through Krypton's protected runner.

- [ ] **Process-level sandbox profiles:** Apply a capability-detected macOS
      Seatbelt profile containing `(deny network-outbound)` or launch a supported
      Linux child inside a dedicated network namespace such as `unshare --net`.
      Profiles must be installed before the agent starts, bound to its registered
      process tree, and fail closed when the requested adapter or host capability
      is unavailable. Linux privilege and kernel requirements must be reported
      explicitly rather than silently falling back to unrestricted execution.
- [ ] **Air-Gapped Mode:** Block all outbound TCP and UDP sockets for the wrapped
      process tree. Permit only the minimum authenticated local IPC required by
      the runtime, including the workspace Unix-domain socket discovered as
      `.krypton/runtime/daemon.sock`; no remote fallback is allowed.
- [ ] **Domain Allowlist Mode:** Force agent TCP and UDP traffic through an
      embedded local proxy that permits only explicitly approved endpoints such
      as `github.com`, `registry.npmjs.org`, and `crates.io`. Block direct sockets,
      alternate resolvers, literal-IP bypasses, redirects to unapproved hosts,
      DNS rebinding, and connections whose destination cannot be bound to an
      approved policy entry. Proxy control and policy evaluation remain local.
- [ ] **Audit-Only Egress:** Do not drop packets, but append bounded destination
      evidence to `.krypton/telemetry/alerts.jsonl`. Record destination IPs and
      ports when observable and record hostnames only when supported by proxy or
      DNS evidence; otherwise label the hostname unknown rather than infer one.
      Audit-only events cannot be presented as blocked or quarantined traffic.
- [ ] Keep egress telemetry asynchronous, redacted, bounded by the existing
      10,000-event/8 MiB ledger limits, and explicitly associated with a process
      only when compound registered identity evidence supports attribution.

### Phase 2 completion criteria

- `krypton exec` has deterministic argument, path, daemon-discovery, child-tree,
  signal-forwarding, and exit-status tests.
- Supported host and network adapters publish capability negotiation so a caller
  can distinguish enforcement, audit-only, and unavailable states.
- Network profiles prove pre-launch installation, direct-socket and DNS-bypass
  resistance, domain-policy enforcement, evidence-aware audit logging, and
  fail-closed behavior through deterministic platform-specific tests.
- The wrapper leaves no stale capability files or live registrations after
  normal exit, crash recovery, or interrupted startup.
- Homebrew and shell-install paths verify checksums, signatures, platform and
  architecture selection, rollback behavior, and the sub-30-second
  time-to-first-containment target in clean-workstation release tests.

## Phase 3: Native Desktop Application & Developer Convenience (v1.2–v1.3)

**Status:** Planned. No Tauri application, installer, tray integration, or
desktop runtime bridge is implemented in the repository today.

**Release objective:** Package Krypton's local dashboard and native core into a
low-overhead desktop experience for developers, general knowledge workers, and
non-technical users who need zero-terminal setup.

### Tauri Desktop Shell (macOS and Windows)

- [ ] Reuse the existing React dashboard presentation inside a Tauri webview and
      bundle the Rust core without introducing an Electron or production Node.js
      runtime. The desktop build will compile a client/static dashboard surface;
      typed Tauri commands or an authenticated bundled Rust sidecar will replace
      the current Next.js `/api/*` routes inside the app. Browser development and
      hosted demonstration builds retain their existing Next.js paths.
- [ ] Target a release binary below 10 MB and steady-state memory below 50 MB.
      These are measured engineering budgets, not current guarantees; release CI
      must report platform-specific package size and idle/active memory evidence.
- [ ] Provide signed, notarized one-click `.dmg`/`.app` installers for macOS and
      signed `.msi`/`.exe` installers for Windows, with authenticated updates,
      rollback metadata, and uninstall guidance.
- [ ] Add a system-tray or menu-bar shield that reports protection, audit-only,
      degraded, and unavailable states without obscuring whether a native runtime
      is connected.
- [ ] Dispatch native macOS Notification Center and Windows Action Center alerts.
      macOS alerts may represent confirmed native quarantine evidence. Until
      Phase 4 ships, Windows alerts and telemetry in the Tauri shell must remain
      explicitly simulation/demo data and must never claim native containment.

### Phase 3 Windows boundary

The initial Windows Tauri application is a desktop shell and simulation/demo
experience only. It does not gain true native process containment merely by
packaging the dashboard or Rust code. Windows enforcement becomes available only
after Phase 4 delivers the Named Pipe transport, restrictive access control,
compound Windows process-generation validation, and Job Object isolation.

### One-click interactive allowlisting

- [ ] Extend the three-dot action menu for an eligible intercepted alert with:
  - **Allow permanently:** write a validated project rule to `.kryptonrc`.
  - **Allow for session:** add a daemon-generation-scoped, in-memory exception
    without restarting the daemon.
- [ ] Canonicalize the proposed path, display the narrowest rule that will be
      created, require an explicit operator action, and reject sensitive roots,
      traversal, ambiguous symlinks, broad wildcards, and rules outside the
      configured project boundary.
- [ ] Persist permanent rules with schema validation, restrictive permissions,
      atomic replacement, crash-safe recovery, and an auditable rule identifier.
      Session rules expire on daemon restart or authenticated revocation.
- [ ] Support legitimate monorepo and cross-package workflows such as
      `../packages/ui` only when the canonical target belongs to an explicitly
      approved project root; lexical sibling-prefix matches never qualify.

### Multi-Agent Process Tagging

- [ ] Associate registered process generations with agent-runtime evidence such
      as Claude Code, Cursor, Cline, or Warp by combining explicit launcher
      metadata, parent executable signatures, and process hierarchy.
- [ ] Label derived signatures as inferred with provenance and confidence. Tags
      improve operator context but never authorize isolation, rule creation, or
      PID selection.
- [ ] Represent unknown or conflicting signatures honestly instead of assigning a
      best-guess agent identity.

### Incident Sharing & Forensic Kill-Cam

**Status:** Planned.

- [ ] Add a one-click **Export Incident Brief / Share Kill-Cam** action to each
      eligible row in the Intercepted Security Alerts table.
- [ ] Generate sanitized Markdown, JSON, and image summaries of prevented agent
      escapes for developer social proof and compliance records. A representative
      brief may state that Krypton intercepted Claude Code attempting an
      unauthorized read of `~/.aws/credentials` and isolated the registered child
      with `SIGKILL`, but only when native evidence supports every part of that
      statement.
- [ ] Redact home-directory prefixes, credentials, capability material, unrelated
      command arguments, and unapproved payload fields before export. Mock and
      unattributed events must remain explicitly labeled and cannot claim a
      confirmed actor, attempted operation, or native quarantine.
- [ ] Keep export generation local and bounded. Sharing remains an explicit user
      action; Krypton must not upload incident data automatically.

### Phase 3 completion criteria

- Desktop commands preserve the authenticated, versioned, bounded native-control
  contract and never expose daemon capabilities to webview JavaScript.
- Packaging tests distinguish macOS native evidence, Windows simulation data,
  degraded runtime state, and unavailable runtime state.
- Permanent and session exceptions have deterministic policy matrices,
  permission tests, corruption recovery, revocation coverage, and daemon-restart
  tests.
- Agent tagging has fixtures for supported, unknown, ambiguous, stale, and
  adversarial executable hierarchies.
- Incident exports have deterministic redaction, native/mock attribution,
  Markdown/JSON schema, image-rendering, size-bound, and explicit-share tests.
- Release CI records installer signature/notarization status and the binary and
  memory budgets rather than treating targets as unverified guarantees.

## Companion Ecosystem: Vulnerable Agent Playground

**Status:** Planned.

The standalone `krypton-vulnerable-agent-demo` repository will provide an
intentionally vulnerable, disposable demonstration harness for showing prompt
injection and path-traversal attempts against autonomous agents in both
Audit-Only and Enforcement modes.

- [ ] Publish deterministic scenarios, synthetic credentials, and disposable
      workspaces that demonstrate the difference between logging a policy
      violation and isolating an owned process.
- [ ] Keep the harness physically separate from production source and real user
      data. It must refuse non-disposable targets and must never require real
      credentials, home-directory access, or an unbounded network service.
- [ ] Pin each demo release to a compatible Krypton version and label simulated,
      unattributed, denied, and confirmed native quarantine evidence accurately.
- [ ] Provide a resettable walkthrough suitable for local evaluation, launch
      demonstrations, and reproducible security education without weakening the
      core repository's fail-closed defaults.

## Phase 4: Enterprise Cross-Platform Containment & Fleet Systems (v2.0)

**Status:** Planned. macOS remains the only actively supported and tested native
runtime today; Linux native control is experimental, and Windows remains
dashboard-only demonstration mode until this phase ships.

**Release objective:** Introduce Windows and hardened Linux isolation adapters
behind the same compound process identity, bounded telemetry, and fail-closed
contracts, then add enterprise fleet visibility without placing cloud services
inside local security decisions.

### Windows Native Runtime Subsystem

- [ ] Replace Unix-domain socket transport with Windows Named Pipes at
      `\\.\pipe\krypton-ipc`, protected by a restrictive per-user ACL and a
      versioned, authenticated request protocol.
- [ ] Replace POSIX `SIGSTOP`/`SIGTERM` isolation with Windows Job Objects that
      bind the registered process tree, enforce hard memory and child-process
      limits, and prevent child escape from the owned job.
- [ ] Implement canonical Windows drive-letter, backslash, case, reparse-point,
      long-path, and UNC normalization without lexical prefix confusion.
- [ ] Match process creation time, executable identity, and parent generation
      before a Job Object action; a numeric process ID alone is insufficient.

### Linux Landlock, eBPF, and seccomp-bpf subsystem

- [ ] Add unprivileged filesystem restriction through the Linux Landlock LSM,
      with explicit kernel feature detection and fail-closed ruleset creation.
- [ ] Add narrowly scoped seccomp-bpf filters for supported protected-launch
      profiles. Filters must complement rather than replace canonical path policy
      and registered process-tree ownership.
- [ ] Evaluate eBPF for attributable, bounded telemetry where kernel support and
      deployment privileges allow it. eBPF observations alone must not authorize
      process isolation.
- [ ] Retain authenticated Unix-domain socket IPC on Linux with private runtime
      permissions and clearly separate post-event watcher telemetry from
      pre-access Landlock enforcement evidence.

### Enterprise fleet systems

- [ ] Add an opt-in multi-seat aggregation console for redacted workstation
      health, policy version, and incident metadata. Source files, daemon
      capabilities, raw credential paths, and unrelated local activity must not
      leave a workstation.
- [ ] Distribute signed, versioned organization policies through a separate
      synchronization plane. Local enforcement continues with the last verified
      policy when the service is unreachable; expired or invalid mandatory policy
      fails closed according to an explicit organization policy.
- [ ] Add role-based administration, SSO/SAML identity, audit trails, device
      enrollment, revocation, and bounded offline recovery without creating a
      remote arbitrary-PID control channel.
- [ ] Generate evidence-scoped compliance exports from retained telemetry and
      policy history. Reports must state their collection window and gaps and
      must not claim certification or controls that the evidence cannot prove.

### Phase 4 completion criteria

- A shared conformance suite proves equivalent registration, identity
  revalidation, deny, isolation, recovery, telemetry, and capability-reporting
  semantics across supported platforms.
- Unsupported Windows or Linux kernel features produce an explicit unavailable or
  degraded state; they never silently run an enforcing profile without the
  requested boundary.
- Fleet outage, invalid policy, tenant isolation, authorization, enrollment,
  revocation, and audit-export failure modes have deterministic tests.
- Installation packages document required permissions, kernel or OS versions,
  update provenance, rollback, and removal.

## Commercialization & Tiering Strategy (Open-Core Model)

### Open Core with Buyer-Based Tiering

Individual workstation containment remains 100% free, private, and unrestricted
to build developer trust and bottom-up adoption. Krypton monetizes power-user
recovery and explanation workflows, fleet visibility, team governance,
enterprise identity, and compliance evidence—not stronger basic local
containment. The core local policy and native runtime remain useful offline and
must never require an account, subscription check, or cloud response to deny an
unsafe operation.

### Target commercial-state capability matrix

This matrix describes intended entitlements after the corresponding roadmap
phases ship; it is not a current availability matrix. In particular, Full macOS
and Windows local containment means all three tiers receive the complete runtime
once each platform is supported. Today macOS is the only actively supported and
tested native runtime. The Phase 3 Windows Tauri app is initially a shell and
simulation/demo experience; true Windows containment becomes available only with
the Phase 4 Named Pipe and Job Object runtime.

| Capability                              | Free (Community & Solo Dev) |  Pro (Power User / Consultant)  |       Enterprise (Teams & Orgs)        |
| :-------------------------------------- | :-------------------------: | :-----------------------------: | :------------------------------------: |
| **Local Runtime Containment**           |   Full (macOS & Windows)    |     Full (macOS & Windows)      |         Full (macOS & Windows)         |
| **Desktop App & System Tray (Tauri)**   | Included (`.dmg` / `.msi`)  |   Included (`.dmg` / `.msi`)    |       Included (`.dmg` / `.msi`)       |
| **Local Dashboard & Telemetry**         |  Included (`alerts.jsonl`)  |    Included (`alerts.jsonl`)    |       Included (`alerts.jsonl`)        |
| **CLI Wrapper (`krypton exec`)**        |          Included           |            Included             |                Included                |
| **Dynamic Threat Feeds**                |     Static local rules      |   Auto-synced real-time rules   |      Auto-synced real-time rules       |
| **File Snapshot & 1-Click Rollback**    |        Not included         | Included (APFS / VSS snapshots) |    Included (APFS / VSS snapshots)     |
| **AI Incident Explainer**               |      Raw process trees      |  Plain-English incident briefs  |     Plain-English incident briefs      |
| **Centralized Fleet Dashboard**         |        Not included         |          Not included           |     Multi-seat aggregation console     |
| **Mandatory Org-Wide Policies**         |        Not included         |          Not included           |        Admin-enforced lockdown         |
| **EU AI Act & SOC 2 Compliance Export** |        Not included         |          Not included           | 1-Click PDF/CSV forensic audit reports |
| **SSO / SAML (Okta, Azure AD) & RBAC**  |        Not included         |          Not included           |                Included                |

### Commercial architecture guardrails

- Dynamic threat-feed retrieval runs in a separate, authenticated updater. It
  validates signatures and versions before atomically publishing local rules;
  network availability never enters the core decision loop.
- Snapshot and rollback operations require an explicit operator action, bounded
  retention, available-disk checks, platform capability detection, and recovery
  tests. APFS or VSS availability is never inferred from subscription state.
- AI incident briefs must default to local processing or require explicit opt-in,
  data minimization, redaction, tenant isolation, retention disclosure, and a
  raw-evidence link. Generated prose is explanatory and not enforcement evidence.
- Fleet telemetry is opt-in, minimized, authenticated, tenant-isolated, and
  bounded. Enterprise administration can distribute policy but cannot remotely
  bypass compound process identity or authorize arbitrary signaling.
- Compliance exports are evidence packages, not automatic legal certification.
  They must identify source, time range, policy version, missing intervals, and
  whether each event is native or simulated.

### Target pricing guidelines

- **Free:** $0 for unlimited individual local containment.
- **Pro:** approximately $10–$15 per user per month.
- **Enterprise:** approximately $25–$40 per seat per month.

Pricing is directional planning guidance, not a published offer or billing
contract. Final packaging depends on implementation cost, platform availability,
support obligations, and validated buyer demand.

## Release governance and deferred research

The following work remains important but does not redefine the release phases or
commercial entitlements above:

- [ ] Enable GitHub rulesets, required CODEOWNERS approval, signed commits,
      secret scanning, push protection, and protected release environments.
- [ ] Publish signed release artifacts and checksums after owner-managed signing
      credentials are provisioned.
- [ ] Add telemetry integrity authentication, optional encrypted local storage,
      real-socket load tests, and browser profiling.
- [ ] Investigate privacy-preserving clipboard protections, MCP or STDIO host
      mediation, and AI-scaffolded transient execution profiles as separately
      threat-modeled research. None is a current protection guarantee.
