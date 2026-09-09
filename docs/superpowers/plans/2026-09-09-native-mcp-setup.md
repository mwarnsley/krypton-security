# Native MCP and Universal Setup Implementation Plan

**Goal:** Implement the user's approved workspace changes for `krypton setup`
and a stdio MCP file server, prioritizing onboarding in Phase 1.

**Architecture:** The CommonJS setup script detects existing client storage,
validates bounded JSON, and atomically backs up and merges client settings.
The CommonJS MCP server validates JSON Schema 2020-12 locally with Ajv and
uses the existing `dispatchNativeControl` transport. Rust evaluates and performs
bounded file operations using directory descriptors and no-follow opens, then
queues native denial evidence through the existing ledger writer.

**Constraints:** Preserve unrelated local work and client servers. No commits,
personal-settings changes during development, arbitrary PID signaling, remote
policy calls, or automatic downgrade when the daemon is unavailable. Only MCP
file calls gain this boundary; arbitrary agent tools remain outside it.

1. Add failing setup tests for detection, safe merge, private atomic backups,
   malformed data, conflicts, symlinks, idempotence, and CLI routing. Implement
   `src/cli/setup.cjs`, its declarations, supervisor routing, and package script.
2. Add failing MCP tests for lifecycle, JSON-RPC envelopes, schema validation,
   native denials, missing/malformed daemon replies, frame bounds and stdio.
   Implement `src/core/mcp/server.cjs` and declarations with constant session
   state, bounded frames, serialized requests, and output backpressure.
3. Extend native IPC with `mcp_file`, fixed read/write tool names, bounded path
   and content fields, and native receipts. Add native tests before implementing
   path traversal, symlink, hardlink, special-file, missing-file, UTF-8 and size
   rejection. Preserve authenticated IPC and process-control invariants.
4. Add disposable real-IPC MCP simulation coverage and denial telemetry tests.
   Assign persistence sequences in the single writer to preserve ordering
   across concurrent native producers. Normalize MCP evidence without claiming
   a known actor or process isolation.
5. Replace the roadmap using the supplied text, revise onboarding to
   `krypton setup`, and synchronize README, FEATURES and ExplainerDrawer.
6. Run focused tests, Prettier on changed files, and all AGENTS.md gates:
   `npm run lint`, both TypeScript checks, `npm run format:check`, Cargo fmt
   and Clippy, `npm test -- --run`, `npm run design-system:check`,
   `npm run rust:test`, `npm run test:sim`, and the dashboard build. Report
   exact results and platform/manual verification limits.
