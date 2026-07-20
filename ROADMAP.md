# Krypton product roadmap

Status labels distinguish repository implementation from owner-managed or
platform-specific work.

## Implemented

- [x] Explicit project/protected-workspace configuration and safe path handling.
- [x] Compound process identity plus authenticated Unix-domain socket control.
- [x] Bounded JSONL retention, cursor API reads, deterministic mock rotation, and
      bounded client rendering.
- [x] Strict dashboard TypeScript, primitive token compliance, SHA-pinned Actions,
      CODEOWNERS, Dependabot, CodeQL, audit, license, and SBOM workflow definitions.

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
- [ ] Publish a standalone ISC license file and a signed release policy after
      signing credentials are provisioned.

## External repository configuration required

- [ ] Enable GitHub rulesets/branch protection and require CODEOWNERS approval.
- [ ] Require signed commits for protected branches.
- [ ] Enable GitHub secret scanning, push protection, and Dependabot alerts.
- [ ] Protect release environments and configure signing credentials.

## 🤖 Advanced AI Runtime Security Roadmap (Next Horizons)

### 1. Autonomous AI Agent Protection (MCP / STDIO Firewall)

- [ ] **Model Context Protocol (MCP) Adaptive Telemetry:** Implement native hooks mapping stdin/stdout execution loops for LLM command-line agents (Cursor, Claude Code, Windsurf) to catch prompt-injection-driven background breakout scripts before local OS execution completes.

### 2. Insecure Ephemeral Code Sandboxing

- [ ] **AI-Scaffolded Execution Monitoring:** Enforce deterministic local sandbox tracking boundaries for transient, AI-generated micro-scripts to prevent un-vetted code blocks from running localized variable or PII harvesting sweeps.

### 3. Shadow AI Exfiltration Prevention (Clipboard Guard)

- [ ] **Native OS Clipboard Sentinel:** Extend the local Rust background daemon to monitor the clipboard buffer pipeline, automatically intercepting massive data strings matching restricted corporate records or database schemas before data exfiltration occurs via web AI portals.

### 4. Zero-Config IDE Integration

- [ ] **Krypton VS Code Extension Sidebar Companion:** Bundle the native high-performance Rust binary as a zero-config extensions marketplace sidebar companion, exposing our tokenized React tables and real-time status card indicators natively within the active editor window.
