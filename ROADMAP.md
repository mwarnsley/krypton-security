# Krypton product roadmap

This roadmap defines Krypton's prioritized release sequence. Status labels
separate repository implementation from remaining or proposed work; a planned
milestone is not a claim that the protection exists today.

## Roadmap-wide architectural invariants

Every phase must preserve these boundaries:

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
- Platform and host integrations must advertise their actual enforcement
  capability. A missing or degraded adapter must never silently downgrade a
  requested enforcing workflow to observation-only behavior.

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

- [ ] **Desktop OS Alert Integration:** Deliver native macOS user-notification
      banners for confirmed background quarantine events so a developer receives
      an immediate workstation alert outside the browser. Notifications must be
      emitted only after authenticated daemon evidence confirms an owned child
      was quarantined, must not include secret path contents beyond the existing
      redaction policy, and must not block watcher or enforcement threads.

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
      container runtime. “Zero-config” applies only after the supported Krypton
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

### Phase 2 completion criteria

- `krypton exec` has deterministic argument, path, daemon-discovery, child-tree,
  signal-forwarding, and exit-status tests.
- Supported host and network adapters publish capability negotiation so a caller
  can distinguish enforcement, audit-only, and unavailable states.
- The wrapper leaves no stale capability files or live registrations after
  normal exit, crash recovery, or interrupted startup.

## Phase 3: Interactive Dashboard Rule Creator & Granular Exceptions (v1.2)

**Status:** Planned.

**Release objective:** Let an operator resolve legitimate cross-workspace access
without weakening default-deny policy or manually editing configuration.

### One-click allowlisting from the Alert Table

- [ ] Extend the three-dot action menu for an eligible intercepted alert with:
  - **Allow path permanently:** write a validated project rule to `.kryptonrc`.
  - **Allow path for this session only:** add a daemon-generation-scoped,
    in-memory exception without restarting the daemon.
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

### Phase 3 completion criteria

- Permanent and session exceptions have deterministic allow/deny matrices,
  permission tests, corruption recovery, revocation coverage, and daemon-restart
  tests.
- Dashboard mutations require authenticated native confirmation and use
  optimistic rollback on failure; static demonstrations modify mock state only.
- Agent tagging has fixtures for supported, unknown, ambiguous, stale, and
  adversarial executable hierarchies.

## Phase 4: Cross-Platform Native Containment (v2.0)

**Status:** Planned. macOS remains the only actively supported and tested native
runtime today; Linux native control is experimental and Windows remains
dashboard-only demonstration mode.

**Release objective:** Introduce platform-native isolation adapters behind the
same compound process identity, local IPC, bounded telemetry, and fail-closed
contracts used by macOS.

### Windows Native Runtime

- [ ] Replace Unix-domain socket transport with Windows Named Pipes at
      `\\.\pipe\krypton-ipc`, protected by a restrictive per-user ACL and a
      versioned, authenticated request protocol.
- [ ] Replace POSIX `SIGSTOP`/`SIGTERM` isolation with Windows Job Objects that
      bind the registered process tree, enforce hard resource limits, and prevent
      child escape from the owned job.
- [ ] Implement canonical Windows drive-letter, case, separator, reparse-point,
      long-path, and UNC normalization without lexical prefix confusion.
- [ ] Match process creation time, executable identity, and parent generation
      before a Job Object action; a numeric process ID alone is insufficient.

### Linux Landlock and seccomp-bpf subsystem

- [ ] Add unprivileged filesystem restriction through the Linux Landlock LSM,
      with explicit kernel feature detection and fail-closed ruleset creation.
- [ ] Add narrowly scoped seccomp-bpf filters for supported protected-launch
      profiles. Filters must complement rather than replace canonical path policy
      and registered process-tree ownership.
- [ ] Retain authenticated Unix-domain socket IPC on Linux with private runtime
      permissions and clearly separate post-event watcher telemetry from
      pre-access Landlock enforcement evidence.

### Phase 4 completion criteria

- A shared conformance suite proves equivalent registration, identity
  revalidation, deny, isolation, recovery, telemetry, and capability-reporting
  semantics across supported platforms.
- Unsupported Windows or Linux kernel features produce an explicit unavailable or
  degraded state; they never silently run an enforcing profile without the
  requested boundary.
- Installation packages document required permissions, kernel or OS versions,
  update provenance, rollback, and removal.

## Release governance and deferred research

The following work remains important but does not redefine the four release
phases above:

- [ ] Enable GitHub rulesets, required CODEOWNERS approval, signed commits,
      secret scanning, push protection, and protected release environments.
- [ ] Publish signed release artifacts and checksums after owner-managed signing
      credentials are provisioned.
- [ ] Add telemetry integrity authentication, optional encrypted local storage,
      real-socket load tests, and browser profiling.
- [ ] Investigate privacy-preserving clipboard protections, MCP or STDIO host
      mediation, AI-scaffolded transient execution profiles, and guided IDE
      integrations as separately threat-modeled research. None is a current
      protection guarantee.
