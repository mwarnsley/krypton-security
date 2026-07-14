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

## 🏗️ Core Architecture & Nomenclature

To understand the architecture of this security sandbox environment, it is
helpful to distinguish between the background engine and its visual interface:

- **🔒 Krypton (The Engine):** This is the core security runtime engine and
  daemon. It runs silently in the background of the workspace, dynamically
  initializing the `fs.watch` file-system loops, tracking process structures
  within its internal `Set<number>` registry, and executing automated `SIGKILL`
  isolation plumbing whenever a path breakout attempt occurs.
- **🛡️ AegisAgent (The Command Center):** This is the administrative web
  dashboard interface built natively via Next.js and the React App Router. It
  functions as the visual command center, pulling real-time, non-blocking
  asynchronous data streams from the local telemetry ledger (`alerts.json`) to
  provide a fluid data grid of enforcement actions, live process counts, and
  immediate system state visibility.

Together, the **Krypton engine** acts as the indestructible containment cage,
while the **AegisAgent dashboard** provides the crystal-clear window and control
switchboard into that cage.

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
