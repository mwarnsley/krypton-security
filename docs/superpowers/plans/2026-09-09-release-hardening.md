# Phase 1 Release Hardening Plan

**Goal:** Add the requested macOS PR gates and SemVer draft-release pipeline.

**Architecture:** Reusable read-only macOS CI gates run for main PRs/pushes and
tagged releases. Releases validate product SemVer against package.json and require
main ancestry, then build each native architecture on matching macOS hardware.
A separate job validates the exact downloaded artifact set, generates/verifies
SHA-256 files, and uses a job-scoped write token to create only a draft release.

**Contracts:** Pin external actions to reviewed SHAs, bound jobs, preserve the
existing supplementary supply-chain workflow, reject every npm vulnerability,
and document owner-managed branch rules and least-privilege GitHub credentials.

1. Implement reusable CI and tagged native/MCPB release workflows.
2. Add tested SemVer/artifact checksum helpers and package scripts.
3. Synchronize roadmap, security/contribution guidance, README and dashboard FAQ.
4. Validate workflow syntax, helper failure paths and every local repository gate.

No repository settings, remote credentials, tags, commits or releases are changed
by implementation. Remote Actions execution and owner policy activation require
separate verification after this change is reviewed and pushed.
