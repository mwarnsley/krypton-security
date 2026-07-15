# AGENTS.md - Operational Instructions for AI Coding Agents

You are an expert systems and security engineering agent working on **Krypton**,
a lightweight runtime boundary and isolation watchdog built to prevent indirect
prompt injections on local systems.

## 🛠️ Common Project Commands

- Install dependencies: `npm install`
- Run local compilation: `npx tsc`
- Run a no-output typecheck: `npx tsc --noEmit`
- Execute the mock attack simulation: `npx ts-node tests_simulation/test_injection.ts`

## ✅ Mandatory Deployment Quality Contract

Every workflow pass that changes source, configuration, tests, or documentation
must conclude with active confirmation runs of all applicable quality gates.
Before pushing to the main branch, agents and engineers must verify that every
command exits with zero errors:

- Run JavaScript and TypeScript lint analysis: `npm run lint`
- Run the root TypeScript verification: `npx tsc --noEmit`
- Run the dashboard TypeScript verification:
  `npx tsc --noEmit --project src/dashboard/tsconfig.json`
- Run the repository Prettier verification: `npm run format:check`
- Run Rust formatting verification:
  `cargo fmt --manifest-path src/core-native/Cargo.toml --check`
- Run Rust static analysis:
  `cargo clippy --manifest-path src/core-native/Cargo.toml --all-targets --all-features -- -D warnings`

Do not describe a workflow as deployment-ready when one of these checks was
skipped, failed, or produced unresolved warnings. Report the exact blocker and
leave the workflow explicitly incomplete until the zero-error contract passes.

## ⚡ Performance & Complexity Invariants

Because this software operates as a security filter in the local operating
system's execution pipeline, latency overhead must remain virtually
imperceptible.

- **Lookup Optimization:** Store high-risk directories and active tracking
  tables in native `Set` instances for average-case O(1) membership checks.
- **Complexity Accuracy:** Document the real end-to-end complexity. A `Set`
  lookup may be O(1), while path normalization and inspection are O(L) in path
  length. Never label a full algorithm O(1) solely because one lookup is O(1).
- **Avoid Nested Scans:** Do not introduce structural matrix scans or nested
  arrays with O(n²) behavior inside path or process tracking hooks.
- **Resource Management:** Use asynchronous, non-blocking streams such as
  `fs.appendFile` or writable pipelines for security telemetry. Never block the
  main event loop on log persistence.

## 🛡️ Strict Boundaries & Absolute Invariants

- **No External Network Calls Inside Core Filters:** Path verification must be
  local and deterministic. Never introduce external API or model lookups inside
  security validation middleware.
- **Fail-Closed Security Strategy:** Unknown errors or unhandled path states
  must resolve to denied access. Process-enforcement callers must quarantine the
  owned agent child rather than permit an uncertain operation.
- **Zero Human Distraction:** Background checks must run silently. Do not add
  interactive approval prompts or verification loops to execution hooks.
- **Least-Privilege Process Ownership:** Never signal an arbitrary PID. Process
  quarantine must be limited to explicitly registered child processes owned by
  the Krypton runtime.

## 📂 Finalized Repository Architecture Map

- `/src/config/`: Configuration maps, blocked targets, and initial static
  validation sets.
- `/src/core/`: Core security policy, process execution monitors, and path
  verification logic.
- `/src/utils/`: High-performance internal utilities such as non-blocking
  logging streams.
- `/src/index.ts`: Main entry point for the command-line interface.
- `/**tests**/`: Unit test root mirroring the exact subfolder layout of `/src/`.
- `/tests_simulation/`: End-to-end scripts that mimic prompt injection vectors
  and process quarantine behavior.
- `/sandbox_workspace/`: Quarantined operating zone for local AI agent code.
- `/alerts.json`: High-performance local threat-event ledger (`.gitignored`).

## 🧪 Testing and File Organization Rules

1. **Never Clutter the Root Directory:** Do not create loose source files in the
   root or directly under `/src/`. Place backend code in its designated
   `config`, `core`, or `utils` subdomain. `/src/index.ts` is the backend
   entry-point exception; dashboard code must follow the frontend directories
   defined below.
2. **Mirrored Unit Testing:** Every operational file created in `/src/core/` or
   `/src/utils/` must immediately receive a corresponding `.test.ts` file in the
   mirrored pathway under `/**tests**/`.
3. **Pure Function Separation:** Keep computational helpers separate from
   operating-system process handling so tests remain fast and deterministic.

## 📝 JSDoc & Code Documentation Standards

Every engineer or agent working on Krypton must enforce comprehensive inline
documentation to maximize IDE IntelliSense clarity.

1. **Utility & Core System Functions:** Place a full JSDoc block directly above
   every function declaration in `/src/core/` and `/src/utils/`, including
   internal helpers and exported functions.
2. **Required Elements:** Every block must include a clear summary sentence,
   explicit `@param` types and descriptions for every parameter, an explicit
   `@returns` definition, and a practical `@example` showing expected inputs and
   returns.
3. **Complexity Annotations:** Include a custom `@complexity` tag documenting
   both time and space complexity. Distinguish average-case primitive lookup
   cost from the total algorithm cost when they differ.

### Documentation Formatting Example

```typescript
/**
 * Resolves a given path against the core project root directory.
 *
 * @param {string} targetPath - The raw system or lexical path relative to the runtime.
 * @returns {string} The fully resolved absolute file path.
 * @complexity O(1) with respect to policy-set size; O(L) time and space in path length.
 * @example
 * resolveRequestedPath("./sandbox_workspace/file.txt");
 * // => "/absolute/project/root/sandbox_workspace/file.txt"
 */
```

## 🧪 Unit Testing Coverage Mandate

1. **Co-located Specs:** While integration simulation scripts live in
   `/tests_simulation/`, every core utility or process filtering asset inside
   `/src/` must be paired with an isolated unit test file inside `/**tests**/`.
2. **Target 100% Coverage:** Aim for maximum line, branch, and functional branch
   coverage where practical.
3. **Atomic `it` Blocks:** Prefer many small, highly specific `it` or `test`
   blocks over fewer, massive ones. Aim for a maximum of 1-3 `expect` assertions
   per `it` block. Each test must verify exactly one condition or state
   modification.
4. **Deterministic Parameter Matrices:** For functions processing variable
   inputs, such as path strings or process IDs, use exhaustive parameter
   matrices (for example, `test.each`) to test combinations of valid, invalid,
   and edge-case inputs cleanly.
5. **Mocking External System Effects:** Mock all active operating system side
   effects, including `process.kill`, file writing streams, and kernel events,
   inside unit tests. Unit tests must evaluate computational logic and access
   decisions, not execute actual destructive system calls.

## 🌐 Next.js & React Performance Architecture Standards

### 📂 File Structure & Colocation Rules

- Scale the dashboard folder structure intentionally using strict
  encapsulation:
  - **Single-File Pattern:** For standalone units, keep the source, test, and
    public API barrel together:

    ```text
    components/ui/Badge/Badge.tsx
    components/ui/Badge/Badge.test.tsx
    components/ui/Badge/index.ts
    ```

  - Every folder at every level must include an `index.ts` file acting as that
    directory's public API barrel interface.
- **Naming Conventions:**
  - React components use PascalCase (for example, `AlertRow.tsx`).
  - Hooks and utilities use camelCase (for example, `useTelemetry.ts`).

### 📝 React Component Documentation

- Do not include `@complexity` JSDoc annotations on visual React components.
- Every TypeScript property inside a component's Props interface must be
  individually documented using an inline JSDoc comment directly above the
  field declaration. Include an `@default` tag only when the component defines
  an explicit default value for that property.

```typescript
export interface BadgeProps {
  /** The concise status text displayed inside the badge. */
  readonly label: string;

  /**
   * The semantic visual treatment applied to the badge.
   *
   * @default "neutral"
   */
  readonly tone?: 'neutral' | 'positive' | 'critical';
}
```

### ⚡ Performance-First Component Development

- **State Colocation:** Keep state as local to individual components as possible
  to minimize the re-render blast radius.
- **Computation Optimization:** Wrap heavy alert-log sorting, text formatting,
  and grid-filtering computations inside `useMemo`.
- **Reference Stability:** Stabilize event-handler function references passed
  down to sub-components using `useCallback` when it prevents unnecessary child
  updates.
- **Composition vs Multi-Props:** Build components so layouts compose them via
  structured props such as `variant`, `tone`, and `size`, rather than writing
  messy, duplicate inline styles inside dashboard screen views.
- **Asynchronous Data Safety:** All filesystem reads or dashboard API polling
  routines must use asynchronous, non-blocking streams to keep the application
  main thread free and responsive.
