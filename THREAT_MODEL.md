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
signal alone. OS-specific attribution adapters are not implemented.

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
8 MiB. A corrupt/incomplete final record is ignored during recovery; a write
failure marks daemon health degraded. The ledger is not cryptographically signed
or encrypted.

The alert queue (1,024), IPC queue (32), worker count (4), IPC sizes (16 KiB),
API page size (250), ledger read window (1 MiB), and client rows (500) are
bounded. Saturation may drop telemetry or delay clients; it must not expand
memory without limit.

## Desktop notification boundary

The macOS desktop alert is a downstream convenience signal, not process-control
authority or additional quarantine evidence. Only a successfully authenticated
`IsolateProcess` request that revalidates an owned process identity and confirms
`SIGKILL` can enqueue an alert; portable watcher events cannot do so. A bounded
background worker invokes `/usr/bin/osascript` with a constant script and passes
only a sanitized executable basename and PID as arguments, so raw event paths
and credential details are excluded from the banner.

Notification permission denial, a missing desktop session, an unavailable
delivery command, queue saturation, and process-launch errors degrade only this
convenience channel. They are logged categorically without sensitive values and
cannot block, reverse, or weaken the completed quarantine.

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
