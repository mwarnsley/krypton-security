# v1.0.3 release acceptance validation report

**Overall result: PASS** for the baseline operation and three containment classes
recorded below.

## Environment and evidence scope

- Installation: clean-slate install on macOS, arm64 (Apple Silicon).
- Client: Claude Desktop running the Krypton extension version **1.0.3**.
- Containment receipt timestamps: **2026-10-20**, in UTC.
- Evidence source: acceptance results supplied by the release tester. This report
  transcribes those results; preparing this document did not independently rerun
  the desktop tests or inspect the original receipt payloads.

The installed extension version is the tester-reported version. This document
neither changes the repository package version nor establishes that a release
artifact has been published. The supplied results do not include the exact
macOS/Claude Desktop versions or the installed artifact checksum.

## Baseline in-workspace test

| Check                               | Target                                            | Daemon action | Verification                                            | Status |
| ----------------------------------- | ------------------------------------------------- | ------------- | ------------------------------------------------------- | ------ |
| Write and read back a harmless file | `release_test.txt` inside the protected workspace | `allowed`     | Read-back content verified to match the written content | PASS   |

The baseline establishes that normal in-workspace operations worked before
interpreting denials as successful containment. The original baseline content,
receipt IDs, and timestamp were not included in the supplied evidence. The
[testing walkthrough](testing-guide.md) provides a fixed harmless payload for
future repetitions; it is not asserted to be the original test payload.

## Boundary containment matrix

| Boundary class     | Requested path                                    | Status | Daemon action | Receipt ID                                            | Timestamp (UTC)        |
| ------------------ | ------------------------------------------------- | ------ | ------------- | ----------------------------------------------------- | ---------------------- |
| Relative traversal | `../escaped_test.txt`                             | PASS   | `denied`      | `native-mcp-req-0b208f52-a909-4db1-8d94-8e57a112b737` | `2026-10-20T03:28:24Z` |
| Outward symlink    | `symlink_out.txt`, pointing outside the workspace | PASS   | `denied`      | `native-mcp-req-1217c9c0-9ca9-482d-8b01-5be09322ba6e` | `2026-10-20T03:29:21Z` |
| Absolute path      | `/etc/hostname`                                   | PASS   | `denied`      | `native-mcp-req-37f8b75f-ba08-4ea5-b9b5-f1268cb39f50` | `2026-10-20T03:29:22Z` |

Sensitive system paths such as `/etc/passwd` and `~/.ssh/id_rsa` were replaced
with non-sensitive functional equivalents to exercise the same boundary classes
safely. The fixtures test traversal, outward symlink resolution, and absolute
out-of-workspace access without attempting to retrieve credentials.

## Interpretation and acceptance

All recorded checks passed: a permitted write/read round trip succeeded, and
all three out-of-workspace access classes received native daemon denials.
A client refusal without an actual Krypton tool invocation would not establish
this native containment result; the recorded receipt IDs identify the supplied
native-denial evidence.

This acceptance result covers Krypton's protected MCP file tools on the stated
macOS arm64 installation. It does not claim containment for unrelated client
shell/filesystem tools, cryptographic receipt signatures, process quarantine,
or verification of other platforms. Dashboard observations and hosted CI results
were not supplied as part of this acceptance run. See the
[testing walkthrough](testing-guide.md) for repeatable prompts and the distinction
between client classification, native receipts, and dashboard telemetry.
