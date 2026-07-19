# Krypton: High-Performance Runtime Security & Workspace Telemetry Engine

Krypton is an open-source, developer-first runtime protection agent for local
workspaces. It is designed to stop supply-chain attacks at the execution
boundary—for example, a zero-day package or malicious lifecycle script escaping
`node_modules` to inspect credentials, modify files outside the repository, or
launch unauthorized background activity.

The system bridges a native Rust security daemon with a tokenized Next.js
management dashboard. The daemon consumes low-latency, kernel-backed filesystem
notifications, applies deterministic workspace and process-ownership policies,
and publishes local telemetry without placing model inference or external
network calls inside the enforcement path. The dashboard converts those events
into sortable, paginated security records with process attestation, severity,
target context, and controlled isolation actions.

> Krypton is a local runtime boundary, not a malware classifier. It evaluates
> what a process attempts to do and whether that action remains inside its
> delegated workspace authority.

## Architecture

```text
[Local Developer Workspace Processes]
                  │
                  │  Low-latency kernel-backed monitoring
                  ▼
[Native Rust Security Daemon]
                  │
                  │  Telemetry event stream + bounded loopback IPC
                  ▼
[Next.js API Layer Route]
                  │
                  │  Automatic high-fidelity mock stream fallback
                  │  Semantic telemetry normalization
                  ▼
[Krypton UI Primitives & Patterns Dashboard]
                  │
                  └─ Tokenized controls, sorting, pagination,
                     severity, attestation, and isolation receipts
```

### Runtime components

| Component                   | Location                               | Responsibility                                                                                                                     |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript reference engine | `src/core/`                            | Workspace policy evaluation, owned-process registration, quarantine orchestration, and asynchronous telemetry.                     |
| Native Rust daemon          | `src/core-native/`                     | Canonical path enforcement, kernel-backed filesystem observation, bounded telemetry persistence, rate limiting, and local IPC.     |
| Telemetry API               | `src/dashboard/app/api/telemetry/`     | Native daemon health checks, ledger parsing, process attestation, response normalization, and resilient mock fallback.             |
| Dashboard primitives        | `src/dashboard/components/primitives/` | Closed, token-backed buttons, inputs, selectors, toggles, tooltips, typography, loading states, and TanStack table infrastructure. |
| Dashboard patterns          | `src/dashboard/components/patterns/`   | Operator-facing telemetry tables, security cards, help surfaces, and containment actions.                                          |

## Quickstart

### Requirements

- Node.js 20.19 or newer
- npm
- Rust and Cargo only when running the native daemon

### 1. Clone and install

```sh
git clone https://github.com/mwarnsley/krypton-security.git
cd krypton-security
npm install
```

### 2. Start the dashboard

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

If the native Rust daemon has not been compiled or started on first boot, the
Next.js telemetry API detects that the local IPC endpoint is unavailable,
flags the response as `source: "mock"`, and automatically switches to a
high-fidelity mock event stream. This lets developers immediately experience
the complete interactive dashboard, including sorting, pagination, process
names, severity tiers, targeted paths, and attestation tracking.

The fallback includes realistic hostile and healthy activity:

- A high-severity attempt to read `~/.aws/credentials` from an
  `Ephemeral Shell Task`.
- A critical background network-boundary bypass during an unvetted
  `npm install` lifecycle.
- Benign ESLint and Next.js build activity for healthy-workspace contrast.

## Run with the native daemon

Install Rust with [rustup](https://rustup.rs/), then build and start the daemon
from the repository root:

```sh
cargo build --manifest-path src/core-native/Cargo.toml
cargo run --manifest-path src/core-native/Cargo.toml
```

In a second terminal, start the dashboard:

```sh
npm run dev
```

The dashboard probes the daemon through the fixed loopback endpoint at
`127.0.0.1:9000` using a bounded `HEALTH` transaction. Native telemetry remains
local; the enforcement filter does not call external APIs or remote models.

## Security model

Krypton applies defense in depth at the local execution boundary:

- **Canonical workspace boundaries:** Paths are resolved before policy
  evaluation to prevent traversal and filesystem-alias bypasses.
- **Sensitive-target denial:** Credentials and configuration targets such as
  `.ssh`, `.aws`, `.env`, and `.env.*` are denied.
- **Fail-closed decisions:** Invalid paths, indeterminate states, and ownership
  failures do not silently permit execution.
- **Least-privilege quarantine:** Krypton signals only explicitly registered,
  runtime-owned child processes. Arbitrary PIDs are rejected.
- **Local-only enforcement:** Core filters do not depend on remote APIs, model
  inference, or cloud availability.
- **Non-blocking evidence:** Native telemetry uses a bounded queue and dedicated
  writer path so persistence does not block filesystem monitoring.
- **Bounded IPC:** Health, audit-mode, and isolation commands use a strict local
  grammar, fixed receipt sizes, and timeouts.

### Enforcement modes

- **Audit-Only Mode** records boundary violations without terminating the
  registered process. This is the default training and policy-baselining mode.
- **Active Enforcement** can quarantine an owned child process after verified
  policy or rate-limit conditions.

Krypton never infers an attacker PID from a filesystem event. Kernel-backed
event streams provide paths and event kinds, so process isolation remains gated
by Krypton's explicit owned-child registry.

## Telemetry contract

The dashboard consumes one shared `SecurityAlert` schema:

| Field                | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `timestamp`          | ISO-8601 event time.                                                 |
| `targetProcessId`    | Positive operating-system process identifier.                        |
| `processName`        | Executable or developer tool associated with the event.              |
| `attemptedPath`      | Normalized filesystem or network target.                             |
| `severity`           | `critical`, `high`, `medium`, `low`, or `info`.                      |
| `origin_attribution` | Dependency, task, script, or ephemeral-shell attestation tag.        |
| `attemptedAction`    | Machine-readable observed or denied action.                          |
| `enforcementStatus`  | `OBSERVED`, `INTERCEPTED`, `QUARANTINED`, or `AUTOMATED_QUARANTINE`. |
| `triggerSignature`   | Deterministic policy signature responsible for the event.            |
| `id`                 | Stable table-row identity.                                           |

The `AlertTable` pattern maps the contract into sortable Timestamp, Process ID,
Process Name, Targeted Directory, Severity, and Attestation Tag columns. The
table supports page sizes of 10, 25, 50, 75, 100, or all available rows.

### Telemetry API behavior

`GET /api/telemetry` follows this order:

1. Send a bounded health probe to the native daemon.
2. If reachable, asynchronously read and normalize the local telemetry ledger.
3. Attest distinct PID/path pairs and return native events newest first.
4. If the daemon, ledger, parser, registry, or attestation layer is unavailable,
   return HTTP 200 with a non-empty high-fidelity mock stream.

Fallback responses include:

```json
{
  "activeProcessCount": 0,
  "alerts": [
    {
      "id": "mock-zero-day-aws-credentials",
      "timestamp": "2026-07-19T12:00:00.000Z",
      "targetProcessId": 48217,
      "processName": "bash",
      "attemptedPath": "~/.aws/credentials",
      "severity": "high",
      "origin_attribution": "Ephemeral Shell Task",
      "attemptedAction": "credential_access_attempt",
      "enforcementStatus": "INTERCEPTED",
      "triggerSignature": "SENSITIVE_CREDENTIAL_PATH"
    }
  ],
  "nativeDaemonReachable": false,
  "source": "mock"
}
```

## Runtime configuration

The native daemon reads `krypton.config.json` from the repository root:

```json
{
  "sandbox_path": "sandbox_workspace",
  "rate_limit_window_seconds": 5,
  "rate_limit_max_breakouts": 3
}
```

| Setting                     | Description                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox_path`              | Repository-relative workspace authorized for monitored agent activity. Absolute, empty, and parent-traversing values are rejected. |
| `rate_limit_window_seconds` | Sliding window used to track repeated breakout activity.                                                                           |
| `rate_limit_max_breakouts`  | Maximum breakout count before an owned process becomes eligible for automated quarantine.                                          |

## Design system

The dashboard uses a semantic Tailwind token matrix defined in
`src/dashboard/tailwind.config.js`. Krypton primitives consume named background,
surface, border, accent, alert, warning, radius, spacing, and technical-mono
tokens. Public primitive APIs deliberately omit raw `className` and inline
`style` overrides; layout code selects typed variants and sizes instead.

Core primitives include:

- `KryptonButton` and `KryptonIconButton`
- `KryptonInput`, `KryptonSelect`, `KryptonToggle`, and `KryptonCheckbox`
- `KryptonTypography` and `KryptonTooltip`
- `KryptonLoadingSpinner`
- `KryptonDataTable`

## Development and verification

```sh
# JavaScript, React, API, and component tests
npm run test

# Safe mock attack simulation
npm run test:sim

# Lint and TypeScript verification
npm run lint
npx tsc --noEmit
npx tsc --noEmit --project src/dashboard/tsconfig.json

# Formatting verification
npm run format:check
cargo fmt --manifest-path src/core-native/Cargo.toml --check

# Native tests and static analysis
npm run test:rust
cargo clippy --manifest-path src/core-native/Cargo.toml \
  --all-targets --all-features -- -D warnings

# Production dashboard build
npx next build src/dashboard
```

The attack simulation uses a disposable registered child process and controlled
fixtures. Do not test process quarantine against an unrelated shell or arbitrary
PID.

## Repository layout

```text
krypton-security/
├── **tests**/                         # Mirrored TypeScript unit tests
├── sandbox_workspace/                # Authorized local agent workspace
├── src/
│   ├── config/                        # Security policy configuration
│   ├── core/                          # TypeScript reference enforcement engine
│   ├── core-native/                   # Native Rust daemon
│   ├── dashboard/
│   │   ├── app/api/telemetry/         # Health, telemetry, audit, and isolation routes
│   │   ├── components/primitives/     # Token-bound UI primitives
│   │   ├── components/patterns/       # Composed dashboard security patterns
│   │   ├── types/                     # Shared telemetry contracts
│   │   ├── ROADMAP.md                 # Dashboard DevSecOps roadmap
│   │   └── VC.md                      # Contribution security matrix
│   └── utils/                         # Non-blocking telemetry utilities
├── tests_simulation/                  # Controlled integration simulations
├── AGENTS.md                          # Engineering and security invariants
├── FEATURES.md                        # Capability and milestone ledger
├── krypton.config.json                # Native runtime profile
└── README.md
```

## Contribution and supply-chain guardrails

| Reference                                                                                                                           | Status          | Coverage                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| [Contribution Security Matrix](src/dashboard/VC.md)                                                                                 | Required policy | Signed contributor identity, hermetic CI, immutable Actions, and split-domain ownership.      |
| [Phase 5: Ironclad DevSecOps & Supply Chain Hardening](src/dashboard/ROADMAP.md#phase-5-ironclad-devsecops--supply-chain-hardening) | Planned         | Signed commits, path-based CODEOWNERS, CodeQL, SHA-pinned dependencies, and isolated runners. |

Security-sensitive changes to `src/core-native/` and `src/utils/` should receive
explicit human review. Automated contributors may propose changes but should
not self-approve or bypass protected-path ownership.

## Current scope and limitations

- The native daemon currently uses the Rust `notify` abstraction and supported
  operating-system event backends. It is not a custom kernel extension.
- Process enforcement is implemented for supported Unix signal semantics;
  cross-platform termination abstraction remains roadmap work.
- The loopback IPC channel is local and bounded but does not yet implement the
  planned rotating cryptographic handshake.
- The high-fidelity fallback is demonstration data. Consumers integrating the
  API should inspect `source` and `nativeDaemonReachable` before treating events
  as production evidence.

## License

Krypton is currently declared under the ISC license in `package.json`. Add a
standalone license file before publishing a formal release artifact.
