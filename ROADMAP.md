# Krypton product roadmap

Status labels distinguish repository implementation from owner-managed or
platform-specific work.

## Implemented

- [x] Explicit project/protected-workspace configuration and safe path handling.
- [x] Compound process identity plus authenticated Unix-domain socket control.
- [x] Bounded JSONL retention, cursor API reads, deterministic mock rotation, and
      bounded client rendering.
- [x] Strict dashboard TypeScript, primitive token compliance, SHA-pinned Actions,
      CODEOWNERS, Dependabot, CodeQL, dependency license-policy checks, and SBOM
      workflow definitions.
- [x] Root ISC software license covering Krypton source distribution.

## Partially implemented

- [ ] Process attribution: explicit launcher registration is implemented;
      portable `notify` events remain unattributed.
- [ ] Cross-platform monitoring: `notify` observation is portable, but native
      authenticated control and isolation currently require Unix.
- [ ] Release provenance: clean tracked-file archives are implemented; signed
      releases and checksum publication are not.

## Planned engineering work

- [ ] Add macOS Endpoint Security and Linux eBPF/fanotify permission adapters for
      reliable process attribution or pre-access decisions where supported.
- [ ] Add Windows named-pipe control with restrictive ACLs and a Windows process
      generation/isolation adapter.
- [ ] Separate daemon privileges further and add sandboxed packaging/service
      installation.
- [ ] Add integrity authentication for persisted telemetry and optional encrypted
      local storage.
- [ ] Add load tests against real daemon sockets and browser profiling to the
      deterministic telemetry benchmark.
- [ ] Publish a signed release policy and release checksums after signing
      credentials are provisioned. Release signing establishes artifact
      provenance; it is separate from the implemented ISC software license.

## External repository configuration required

- [ ] Enable GitHub rulesets/branch protection and require CODEOWNERS approval.
- [ ] Require signed commits for protected branches.
- [ ] Enable GitHub secret scanning, push protection, and Dependabot alerts.
- [ ] Protect release environments and configure signing credentials.

## 🤖 Advanced AI Runtime Security Roadmap (Next Horizons)

### 1. Autonomous AI Agent Protection (MCP / STDIO Firewall)

- [ ] **Model Context Protocol (MCP) Adaptive Telemetry:** Investigate mediation
      points in MCP and STDIO agent hosts, including policy checks before tool
      dispatch where a host integration supports them. Evaluate correlation
      among agent requests, protected child processes, and native telemetry.
      Host-independent pre-execution interception is not implemented and is a
      research objective, not a guaranteed outcome.

### 2. Insecure Ephemeral Code Sandboxing

- [ ] **AI-Scaffolded Execution Monitoring:** Launch transient, AI-generated
      scripts through the protected launcher, enforce defined workspace and
      process boundaries, and record short-lived process lineage. This objective
      targets explicitly launched unvetted code; it does not imply automatic
      capture of every generated script on a machine.

### 3. Shadow AI Exfiltration Prevention (Clipboard Guard)

- [ ] **Native OS Clipboard Sentinel:** Explore privacy-sensitive clipboard
      protections with explicit user opt-in, local-only policy evaluation, and
      platform API and permission constraints. Prefer redacted findings over raw
      clipboard retention, complete accessibility and privacy review, and never
      silently collect clipboard contents. Universal automatic interception is
      not an assumed outcome.

### 4. Guided-install IDE integration

- [ ] **Guided-install VS Code Companion:** Deliver a staged sidebar integration
      with clear native-binary installation, permissions, updates, and platform
      status. Zero-configuration onboarding remains a long-term aspiration after
      signed binaries and multi-platform packaging are complete.
