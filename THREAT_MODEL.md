# Krypton threat model

## Protected assets

- Files outside the configured protected workspace, especially credentials and
  developer configuration.
- Integrity of the native process registry, audit/enforcement mode, runtime
  endpoint record, capability, and telemetry ledger.
- Availability of the local daemon and dashboard.
- Clear separation between native evidence and demonstration data.

## Trust boundaries

The Rust daemon, its private runtime directory, reviewed configuration, and the
protected launcher are trusted components. Package lifecycle scripts, agent
children, tool output, filesystem event paths, IPC bytes, ledger bytes, and API
JSON are untrusted.

The invoking local user is assumed to control the project and runtime directory.
A root/admin attacker—or a same-user attacker able to read daemon memory, alter
files, attach a debugger, or replace the launcher—can bypass Krypton. Krypton is
not an isolation boundary against the account that owns it.

## Process ownership and PID reuse

The daemon never authorizes a PID alone. Registration and isolation compare PID,
start time, executable path, and parent PID against fresh operating-system
metadata. Unregister removes only an exact generation. A missing or mismatched
process fails closed; stale registrations are removed without signaling a reused
PID.

## IPC trust

Unix native control uses a workspace-specific `0600` socket beneath a `0700`
runtime directory. The daemon creates a 256-bit capability in a `0600` file and
checks it on every versioned JSON Lines request. Peer credentials must resolve to
the daemon user on supported Unix targets. Audit-mode changes receive the same
authentication as registration and isolation.

Requests and responses are limited to 16 KiB, reads/writes time out after two
seconds, four workers consume a 32-connection queue, and unknown versions or
commands are rejected. The capability is local bearer material; a same-user
attacker that can read the private file can authenticate.

## Filesystem attribution and enforcement limits

Dashboard HTTP mutation routes require `application/json` and matching loopback
Host and Origin headers (`localhost` or `127.0.0.1`) before invoking native IPC.
Missing, cross-origin, or invalid headers are denied; daemon capabilities remain
server-side. These guards address browser cross-origin requests, not caller
authentication. Non-browser clients can forge headers, so the dashboard must be
bound to loopback and must not be exposed through a public reverse proxy.

The portable `notify` adapter reports event kinds and paths, not the responsible
process. Krypton therefore records those events as `unattributed` and never
increments a per-process breakout threshold or quarantines a child from that
signal alone. The TypeScript reference watcher also records only `OBSERVED`
unattributed state, including degraded health on watcher errors; it has no signal
path. PID-only registration is disabled. Operational TypeScript isolation submits
a compound identity to authenticated native `IsolateProcess`. OS-specific
attribution adapters are not implemented.

Portable events are post-event telemetry. Krypton does not claim pre-access
kernel denial, complete credential-exfiltration prevention, or reliable actor
identity from FSEvents/inotify alone. Pre-action denial applies only when an
application explicitly asks Krypton's policy layer before performing the action.
The portable filesystem watcher does not block arbitrary operating-system access
before it occurs. OS-specific permission and endpoint-security adapters remain
future work.

## Paths, symlinks, renames, and TOCTOU

Existing targets are canonicalized. Missing/deleted targets resolve through the
nearest existing canonical ancestor and a validated lexical tail. Rename paths
are evaluated separately as supplied by `notify`. Exact path components are used
for ignores; similarly named directories are not ignored. Parent traversal,
sibling-prefix confusion, dangerously broad protected roots, and symlinks that
resolve outside the workspace are unsafe.

Canonicalization and live identity checks reduce alias and PID-reuse attacks but
cannot eliminate races between validation and operating-system action. Stronger
directory-handle and kernel permission APIs are future adapter work.

## Telemetry integrity and availability

Native events use monotonically increasing sequence IDs and one JSONL format.
Writes are newline-delimited and synchronized; retention compaction uses a
temporary file plus atomic rename. The ledger is capped at 10,000 events and
8 MiB. Recovery truncates an EOF-incomplete final JSON record to the last valid
byte offset before append, and preserves a valid final record missing its newline.
Interior corruption, malformed complete lines, and non-monotonic or exhausted
sequences are rejected without rewriting ledger contents. A write
failure marks daemon health degraded. The ledger is not cryptographically signed
or encrypted. Compaction and private IPC-file publication use exclusively created
`0600` temporary files, file sync, and directory sync before and after rename.
Existing temporary paths, including symlinks, fail closed and require operator
inspection; they are never automatically followed or overwritten.

The alert queue (1,024), IPC queue (32), worker count (4), IPC sizes (16 KiB),
API page size (250), ledger read window (1 MiB), and client rows (500) are
bounded. Saturation may drop telemetry or delay clients; it must not expand
memory without limit.

The watcher-to-main bridge is also bounded to 1,024 events. Saturation uses
non-blocking dispatch and marks sticky degraded telemetry health; IPC overload
rejects the connection and marks IPC degraded. Watcher errors and notification
failures also surface through authenticated health. Registry or mode lock
failures never become zero processes or active-enforcement defaults. Unknown
mode denies isolation and disables the dashboard toggle. Component degradation
does not itself prove that a previously confirmed quarantine failed. Ledger
observations remain `OBSERVED`; only successful native action receipts authorize
an `ISOLATED` UI confirmation.

## Desktop notification boundary

The macOS desktop alert is a downstream convenience signal, not process-control
authority or additional quarantine evidence. Only a successfully authenticated
`IsolateProcess` request that revalidates an owned process identity and confirms
`SIGKILL` can enqueue an alert; portable watcher events cannot do so. A bounded
background worker invokes `/usr/bin/osascript` with a constant script and passes
only a trusted agent label and PID as arguments. Known executable names map to
fixed labels; all others use `Unknown Agent Process`. These labels are explanatory,
not executable authenticity claims. Raw names, event paths, and credentials are excluded.
Delivery discards subprocess output and has a two-second execution deadline;
timeout triggers kill/reap cleanup on the notification worker.

Notification permission denial, a missing desktop session, an unavailable
delivery command, queue saturation, and process-launch errors degrade only this
convenience channel. Failures set sticky atomic degraded status without synchronous
locks or stderr writes on the IPC caller's path and cannot reverse or weaken the
completed quarantine. A successful osascript exit does not prove a banner was displayed.

The native injection simulation uses a real socket, registry, OS inspector,
owned-child signal, watcher, and durable ledger in a disposable runtime. Only
notification delivery is mocked, and only in the Rust test binary. Observational
ledger evidence and authenticated quarantine receipts remain separate: the test
does not infer the offending process from a portable filesystem event.

## Demonstration data

Mock scenarios are deterministic and bounded. Responses set `source: "mock"`
and an explicit `fallbackReason`; the dashboard displays a persistent warning.
Mock rows are not native evidence and do not carry actionable registered process
identities.

## Platform scope

macOS and Linux support the current Unix socket and signal model. Windows native
control is intentionally unsupported until restrictive named-pipe ACLs and a
process-generation adapter exist. Container, network filesystem, and privileged
service deployments require separate validation.
