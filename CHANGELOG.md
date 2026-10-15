# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-10-14

### Added

- **Standalone MCPB Distribution**: Bundled dual-architecture native daemons (`arm64-apple-darwin` and `x86_64-apple-darwin`) into a standalone `.mcpb` package with zero external repo or toolchain dependencies.
- **Private Runtime State**: Added hybrid configuration support with persistent fallback storage under `~/Library/Application Support/KryptonSecurity/sandbox_workspace`.
- **Ephemeral Socket Isolation**: Added short per-user runtime paths for UNIX domain sockets to respect macOS `sockaddr_un` 104-character system limits.
- **Packaged E2E Test Suite**: Added automated tests verifying bundle extraction, path traversal blocking, process lifecycle supervision, and clean teardown.

### Fixed

- Fixed macOS symlink resolution in temporary directory creation using `fs.realpath`.
- Fixed CI test runner compatibility across Linux and macOS temporary filesystems.
- Resolved `cargo-deny` CVSS 4.0 advisory parsing in Rust quality workflows.

### Security

- Remediated high-severity denial-of-service advisory in `braces` (GHSA-vfj7-8cjw-p6xm) via vendored depth-bounded patch.
- Pinned secure overrides for `micromatch` (`^4.0.8`) and `postcss-selector-parser` (`^7.1.6`).

---

## [1.0.0] - 2026-10-12

### Added

- Initial release of Krypton Security runtime boundary and isolation watchdog for local AI agents.
- Core native Rust supervisor daemon for filesystem interception and boundary enforcement.
- Model Context Protocol (MCP) server integration with Claude Desktop.
- Live telemetry monitoring dashboard and security event stream.
