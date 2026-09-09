# MCPB Generator Implementation Plan

**Goal:** Implement the requested deterministic local MCP extension archive.

**Architecture:** Generate an MCPB 0.3 `manifest.json` using the specification's
`manifest_version` field. Bundle the existing server, authenticated transport,
supervisor and a launcher using `process.execPath`, plus only Ajv's installed,
lockfile-matched runtime dependency closure. A required directory setting selects
the user's existing Krypton checkout and running daemon. Never bundle native
runtime credentials, telemetry, development packages or builder-machine paths.

**Tech stack:** CommonJS, Node filesystem APIs, a bounded deterministic ZIP writer,
existing Vitest, and the official MCPB validator for artifact verification.

**Spec:** User request in this session and
https://github.com/anthropics/mcpb/blob/main/MANIFEST.md.

- [x] Test manifest metadata, portable launch configuration, archive contents,
      reproducibility, standalone dependency resolution and failure boundaries.
- [x] Implement `src/packaging/build_mcpb.cjs`, declaration and launcher; register
      `build:mcpb`. Publish through a private temporary file and atomic rename.
- [x] Synchronize README, FEATURES, ROADMAP and dashboard guide/tests. Document
      that the archive requires a separately running native daemon and macOS QA.
- [x] Build twice, compare hashes, inspect/extract the ZIP, validate with the
      official MCPB tool, run all AGENTS.md gates and the native E2E harness.

The generated `dist/` artifact remains ignored. This task does not request a new
commit or push.
