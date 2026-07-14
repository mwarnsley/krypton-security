# Krypton

Krypton is an open-source, lightweight runtime boundary and isolation watchdog
built to prevent indirect prompt injections and unauthorized local execution
loops for local AI agents.

The project establishes a deterministic local boundary around agent-accessible
files. Requests are resolved to absolute paths, checked against the sandbox
boundary and sensitive endpoints, and denied when they escape the permitted
workspace. A process associated with a denied operation can be quarantined with
an OS-level `SIGKILL`, while the event is appended asynchronously to a local
security ledger.

## Getting started

### Requirements

- Node.js
- npm

Install the development dependencies:

```sh
npm install
```

Run the watchdog and its built-in mock simulation:

```sh
npx ts-node src/watchdog.ts
```

The simulation confirms that a valid sandbox path is allowed, directory
traversal and sensitive endpoints are denied, and a disposable child process is
terminated. Threat events are written locally to the ignored `alerts.json`
ledger.

## Structural map

```text
krypton-security/
├── src/
│   └── watchdog.ts       # Path boundary checks, quarantine, and mock simulation
├── sandbox_workspace/    # Isolated workspace for local agent operations
├── alerts.json           # Local-only security event ledger, created at runtime
├── FEATURES.md           # Public architectural milestone ledger
└── README.md             # Project overview and usage
```

### Isolation design patterns

- **Absolute path resolution:** Every requested path is normalized with
  `path.resolve` before policy evaluation, preventing lexical `../` traversal
  bypasses.
- **Sandbox containment:** Operations are permitted only when their resolved
  paths remain inside `/sandbox_workspace`.
- **Sensitive endpoint denial:** Native `Set` lookups block endpoints such as
  `.ssh`, `.aws`, `.env`, and `.env.*`, including when they appear inside the
  sandbox.
- **Fail-closed checks:** Unknown path-evaluation errors resolve to a denied
  access decision.
- **Process isolation:** Callers can quarantine a rogue child process with an
  immediate OS-level `SIGKILL`.
- **Local asynchronous telemetry:** Structured threat events are appended using
  a non-blocking stream and never require an external network call.

The current Phase 1 module exposes the enforcement primitives and a mock
simulation. Integration with real filesystem or process-execution hooks is an
upcoming hardening step.
