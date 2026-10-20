# Krypton end-user acceptance testing guide

Use this walkthrough to verify a normal file operation and three filesystem
boundary classes. The [v1.0.3 validation report](RELEASE_v1.0.3_VALIDATION_REPORT.md)
records the supplied acceptance results; new runs will have different receipt
IDs and timestamps.

## 1. Install the Claude Desktop extension

1. On a supported Apple Silicon or Intel Mac, download
   **`krypton-protected-fs.mcpb`** from the intended
   [GitHub release](https://github.com/mwarnsley/krypton-security/releases).
   For a v1.0.3 acceptance run, select that release's asset and verify that the
   installed extension reports **1.0.3**. Record the artifact checksum, macOS
   version, and Claude Desktop version for your own test record.
2. Open Claude Desktop **Settings → Extensions** and drag and drop the `.mcpb`
   into the extension installer. If that interface does not accept the drop,
   use **Advanced settings → Install Extension** and choose the file, or
   double-click the bundle to open its installer. Confirm installation.
3. Leave configuration at its default: the optional `protected_workspace_root`
   field is blank. The protected root is then:

   ```text
   ~/Library/Application Support/KryptonSecurity/sandbox_workspace
   ```

4. Fully quit Claude Desktop with **Cmd + Q**, reopen it, and confirm that
   `krypton_read_file` and `krypton_write_file` are available. Avoid leaving an
   older duplicate Krypton server enabled.

The bundle supplies its native daemon; this installation does not require a
source checkout, Rust, or a dashboard terminal. If installation is blocked,
follow the existing [installation troubleshooting](../README.md#troubleshooting).

## 2. Confirm normal in-workspace operations

Use a test workspace in which `release_test.txt` is absent or disposable: the
write can replace that file. Copy and paste this exact prompt:

> Use only krypton_write_file to write release_test.txt inside the protected workspace with the exact content "Krypton v1.0.3 acceptance test: harmless content." and no trailing newline. Then use only krypton_read_file to read release_test.txt back. Show both tool results and confirm that the returned content exactly matches what was written. Do not substitute shell commands or built-in file tools.

**PASS:** both native operations report `action: "allowed"`, and the read-back
content matches exactly. Successful results use codes such as `file_written`
and `file_read`. A model's statement that it wrote the file is insufficient:
inspect the actual tool results. Stop and diagnose setup if this baseline fails.

## 3. Prepare the harmless outward-symlink fixture

The symlink must exist before testing it; a missing file does not demonstrate
an outward-symlink boundary. Run the following yourself in Terminal after the
extension has created the default workspace. These commands create only a
harmless temporary file and a link to it; the MCP tools intentionally cannot
create an outward link for you.

```bash
KRYPTON_TEST_WORKSPACE="$HOME/Library/Application Support/KryptonSecurity/sandbox_workspace"
KRYPTON_TEST_FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/krypton-boundary-test.XXXXXX")"
printf '%s\n' 'Harmless outside-workspace fixture.' > "$KRYPTON_TEST_FIXTURE/outside.txt"
ln -s "$KRYPTON_TEST_FIXTURE/outside.txt" "$KRYPTON_TEST_WORKSPACE/symlink_out.txt"
readlink "$KRYPTON_TEST_WORKSPACE/symlink_out.txt"
```

Check that each command succeeds and that `readlink` shows the temporary
`outside.txt` path, outside the protected root. If `symlink_out.txt` already
exists, stop and inspect it; do not overwrite an existing file or link. Keep
this Terminal session open so the fixture paths remain available for cleanup.
If you chose a custom workspace, replace `KRYPTON_TEST_WORKSPACE` with its actual
absolute path and ensure the temporary fixture is outside it.

## 4. Run the containment prompts

Send each prompt separately and expand the tool result. These are read tests;
do not ask Claude to create or modify any out-of-workspace target.

### Relative traversal

> This is an authorized boundary test using a harmless test filename. Use only krypton_read_file with the literal path ../escaped_test.txt. Do not normalize the path or substitute another tool. Show the native result, including its action, error code, and any receipt ID or timestamp returned. A denial is the expected result.

### Outward symlink

> I created symlink_out.txt inside the protected workspace, pointing to a harmless temporary file outside it. Use only krypton_read_file with the literal path symlink_out.txt. Do not follow the link using another tool. Show the native result, including its action, error code, and any receipt ID or timestamp returned. A denial is the expected result.

### Absolute path

> This is an authorized absolute-path boundary test. Use only krypton_read_file with the literal path /etc/hostname. Do not use shell commands or built-in file tools. Show the native result, including its action, error code, and any receipt ID or timestamp returned. A denial is the expected result; do not retrieve the file by another route.

`/etc/hostname` is outside the default workspace and contains no credential
material. It may not exist on every macOS installation; do not create a system
file for this test. Judge the boundary by the native denial, not by whether a
separate operating-system read succeeds. `../escaped_test.txt` likewise need
not exist to exercise lexical traversal rejection.

For each check, **PASS** means the Krypton tool actually ran and returned a
native `action: "denied"` / `file_access_denied` result, with `isError: true`
on the MCP tool result and no target contents. Capture the receipt ID and UTC
timestamp when available; if a field is absent, record that instead of inventing
it. A timeout, disconnected daemon, generic error, or client refusal is not a
confirmed native boundary-test pass. A denial can queue telemetry; queue
admission alone is not a durable-ledger acknowledgment.

These tests use non-sensitive equivalents instead of `/etc/passwd` or
`~/.ssh/id_rsa`. Do not substitute real credentials for the benign fixtures.

## 5. Distinguish client classification from native enforcement

This subsection applies to **Claude Code**, if you repeat the tests there with
the same Krypton server connected. It is not a Claude Desktop extension setting.

Claude Code's auto-mode classifier can block a call before it reaches Krypton.
In that case, there is no new native receipt for that attempt. Record it as
**client-blocked / native test not executed**, not as a daemon denial.

For this controlled read-tool test, merge this entry into the existing
`permissions.allow` array in `~/.claude/settings.json`; preserve other settings:

```json
{
  "permissions": {
    "allow": ["mcp__krypton-protected-fs__krypton_read_file"]
  }
}
```

Use the exact connected tool name; if the server has another name, this entry
will not match. Inspect `/permissions`, reconnect or restart if needed, and
repeat one benign prompt. A matching narrow allow rule normally resolves the
call before classifier review, letting Krypton produce the native rejection.
Deny/ask rules and applicable managed policy still take precedence; the entry
is not a guarantee against every client-side block. It neither grants the
native daemon access outside its root nor enables other tools. Remove the test
allow entry afterward if you do not want it retained.

The rule syntax and precedence follow the official
[Claude Code permissions documentation](https://code.claude.com/docs/en/permissions#mcp).
The evaluation order is documented under
[how auto mode evaluates actions](https://code.claude.com/docs/en/permission-modes#how-auto-mode-evaluates-actions).
If the call still never executes, record that limitation; do not count a model
refusal or use an unrelated tool as evidence of native containment.

## 6. Inspect the optional UI dashboard

The dashboard is a separate source-mode application. To start it, use the
repository's Node.js 20.19.4/npm 10.8.2 toolchain in a source checkout:

```bash
cd /absolute/path/to/krypton-security
npm ci
npm run dev
```

Open **<http://localhost:3000>**. The `dev` script starts the Next.js telemetry
dashboard through `dev:dashboard`; it does not start a daemon. If port 3000 is
occupied, stop this attempt and use `npm run dev:dashboard -- -p 3001`, then
open <http://localhost:3001>.

**Check the evidence source first.** The viewer does not automatically attach
to the standalone extension's Application Support ledger. A missing, degraded,
or unreachable source-mode daemon/ledger can produce clearly labeled mock
rows. The public GitHub Pages dashboard is also a static demonstration. Neither
is evidence of the extension tests merely because it shows an alert.

For live UI verification, use the existing
[source-checkout setup](../README.md#quick-start--installation), connect a
source-mode client, and repeat the benign tests against that client's configured
workspace. Confirm the dashboard's native state and the local
`http://localhost:3000/api/telemetry` response has `source: "native"` and
`nativeDaemonReachable: true`. These are separate source-mode observations;
they do not retroactively verify the installed extension's receipts.

In **Intercepted security alerts**, native MCP boundary denials display:

| Field                     | Expected meaning                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamp                 | Event capture time; compare with the recorded receipt, accounting for displayed timezone/format.                                                                                   |
| Application / Tool        | `krypton_read_file` for these read tests; do not infer an actor process from the tool name.                                                                                        |
| Attempted Access Location | The requested target path associated with the denial.                                                                                                                              |
| Severity                  | **High** for native MCP boundary events.                                                                                                                                           |
| Verified Signature        | `Native MCP request (actor unattributed)` for these events. Despite the column label, this is attribution text, not a cryptographic signature or proof of a particular caller PID. |

The normalized event is `INTERCEPTED` with trigger category
`NATIVE_MCP_BOUNDARY`; it is not a confirmed process quarantine. The UI may show
`Denied (actor unattributed)` instead of a Process ID. File denials do not require
an OS quarantine banner.

For the **installed extension**, the primary evidence is the native tool result
and its local ledger under:

```text
~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl
```

Match your recorded IDs and timestamps in that instance's ledger if you inspect
it locally. Do not copy ledger files into the source runtime or relabel mock rows
to make them appear native. The local-file bridge for the public dashboard is
still planned; see [the roadmap](../ROADMAP.md).

## 7. Record and clean up

Record the extension/client versions, architecture, workspace selection,
baseline content match, and each native denial's ID, timestamp, path, and action.
Mark client-blocked or unavailable checks separately. Keep raw logs local and
share only the relevant redacted results.

After verifying that they are the fixtures from this run, remove
`release_test.txt`, the `symlink_out.txt` link (not its target through the link),
and the temporary directory printed by `printf '%s\n' "$KRYPTON_TEST_FIXTURE"`.
Leave pre-existing files and runtime state intact. Overall acceptance is **PASS**
only when the baseline and all three native containment checks pass.
