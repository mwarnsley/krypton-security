# Krypton

Krypton is an open-source runtime boundary and isolation watchdog for local AI
agents. It evaluates deterministic filesystem and process actions at the local
execution boundary, blocks sandbox escapes and sensitive-path access, isolates
registered rogue child processes, and records enforcement telemetry without
depending on probabilistic prompt classification.

## 🏗️ Core Architecture & Nomenclature

- **Krypton — the containment engine:** Owns path-policy evaluation, workspace
  monitoring, least-privilege process registration, `SIGKILL` quarantine, and
  append-only local telemetry.
- **AegisAgent — the command center:** A Next.js and React dashboard that polls
  the local telemetry API, renders newest-first enforcement events, reports the
  active registered-process count, and exposes manual containment controls.

Together, Krypton provides the execution boundary while AegisAgent provides the
operator-facing visibility and control plane.

## Dual-Engine Architecture

Krypton develops two execution layers against the same sandbox and telemetry
contract:

| Layer                                   | Location           | Current role                                                                                                                                                                                                           |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript/Node.js reference engine** | `src/core/`        | Functional reference implementation for path policy, `fs.watch` monitoring, owned-process registration, quarantine, and asynchronous ledger writes.                                                                    |
| **Rust vanguard engine**                | `src/core-native/` | Compilable native foundation for canonical filesystem-boundary checks. Its manifest includes `notify`, `serde`, `serde_json`, and Unix process/signal support for the next native monitoring and telemetry milestones. |
| **AegisAgent dashboard**                | `src/dashboard/`   | Next.js App Router interface and local API layer for telemetry reads and registered-process containment.                                                                                                               |

The Rust vanguard is currently a foundational native implementation, not yet a
feature-complete replacement for the Node.js reference engine.

```text
krypton-security/
├── src/
│   ├── core/                         # Node.js watchdog and process isolation
│   ├── core-native/                  # Native Rust crate
│   │   ├── Cargo.toml
│   │   └── src/main.rs
│   └── dashboard/                    # AegisAgent Next.js application
│       ├── app/api/telemetry/        # Telemetry and containment endpoints
│       └── components/               # Encapsulated dashboard UI
├── **tests**/                        # Mirrored unit-test suites
├── tests_simulation/                 # Live injection simulations
├── sandbox_workspace/                # Quarantined agent operating zone
├── alerts.json                       # Local append-only telemetry ledger
└── FEATURES.md                       # Architectural milestone ledger
```

## Node.js Pathway

### Prerequisites

- Node.js
- npm

Install dependencies from the repository root:

```sh
npm install
```

Run the unit and API/component test suites:

```sh
npm run test
```

Format every tracked JavaScript, TypeScript, JSON, and Markdown source file:

```sh
npm run format
```

Verify formatting without modifying files:

```sh
npm run format:check
```

Run the Next.js, React, and TypeScript ESLint analysis:

```sh
npm run lint
```

Run both TypeScript compiler verification scopes:

```sh
npx tsc --noEmit
npx tsc --noEmit --project src/dashboard/tsconfig.json
```

Launch the AegisAgent dashboard development server:

```sh
npm run dev
```

Run the end-to-end indirect prompt-injection simulation separately:

```sh
npm run test:sim
```

The simulation creates an allowlisted temporary ticket inside the sandbox,
registers its mock child process, intercepts the attempted breakout before file
access, verifies the quarantine ledger entry, and removes its fixture during
shutdown.

## Rust Pathway

### Prerequisites

Install the Rust toolchain with the official [rustup](https://rustup.rs/)
installer on Unix-compatible systems, then load the Cargo environment:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Build the native crate in debug mode:

```sh
cd src/core-native
cargo build
```

Build an optimized native binary:

```sh
cargo build --release
```

Run the native Rust safety-validation test suite from `src/core-native`:

```sh
cargo test
```

From the repository root, the equivalent command is:

```sh
npm run test:rust
```

Verify Rust formatting and run Clippy with warnings treated as errors:

```sh
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
```

Debug and release binaries are emitted beneath `src/core-native/target/`, which
is excluded from source control.

## Runtime Configuration Contract

The current implementation uses repository-local defaults. The following
schema documents the shared contract; it is not yet loaded from a standalone
configuration file:

```json
{
  "sandboxWorkspace": "./sandbox_workspace",
  "telemetryLedger": "./alerts.json",
  "enforcementSignal": "SIGKILL",
  "dashboardPollIntervalMs": 5000
}
```

- `sandboxWorkspace` is the only authorized operating zone for monitored agent
  filesystem activity.
- `telemetryLedger` is a local, gitignored, append-only newline-delimited JSON
  store. The dashboard API also accepts a JSON-array ledger for compatibility.
- `enforcementSignal` records the immediate native process-isolation mechanism.
  Only explicitly registered workspace child PIDs are eligible for quarantine.
- `dashboardPollIntervalMs` reflects the current AegisAgent telemetry refresh
  interval.

A quarantine record currently includes an ISO timestamp, the target PID, the
resolved denied path or containment context, the `process_quarantined` action,
and the `SIGKILL` signal. The telemetry API returns records newest-first with the
live in-memory count of registered workspace processes.

## Security Boundary Model

- **Absolute path evaluation:** The Node.js engine resolves paths before policy
  checks; the Rust foundation canonicalizes existing paths to resolve physical
  filesystem aliases and parent traversal.
- **Sensitive endpoint denial:** Policy blocks high-risk segments such as
  `.ssh`, `.aws`, `.env`, and `.env.*`, even when nested inside the sandbox.
- **Fail-closed behavior:** Invalid or indeterminate path states are denied or
  surfaced as errors for enforcement callers to reject.
- **Least-privilege isolation:** Krypton signals only child PIDs explicitly
  registered in its owned-process registry.
- **Non-blocking telemetry:** Enforcement records are queued through a retained
  append stream, while dashboard reads use asynchronous filesystem APIs.
- **Local-only policy decisions:** Core filters do not call external APIs or
  models when deciding whether an operation is permitted.

## AegisAgent Command Center

The dashboard uses TanStack Table for its data-dense alert grid and Tailwind CSS
for its high-contrast dark console. Its **Force Isolate** action sends a
non-blocking request to `POST /api/telemetry/terminate`; the endpoint validates
the PID, rejects attempts to terminate the dashboard itself, and delegates only
registered workspace processes to Krypton's quarantine engine.
