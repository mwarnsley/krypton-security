# AGENTS.md

Universal operational specification for every AI coding agent working in the
Krypton repository. These requirements apply regardless of editor, model, or
client. Model-specific instruction files may narrow an agent's area of focus,
but they must import and obey this file.

Krypton is a local runtime boundary and isolation watchdog for reducing the
risk of indirect prompt injection. Its security decisions must remain local,
deterministic, bounded, attributable only when supported by evidence, and
fail-closed.

## 1. Operating Principles

1. **Read before write.** Read `AGENTS.md` and the relevant source,
   configuration, tests, `README.md`, `FEATURES.md`, `ROADMAP.md`, manifests,
   and workspace files before editing. Do not modify a file whose applicable
   context has not been inspected during the current task.
2. **Make the smallest correct change.** Prefer a narrow, reviewable diff that
   solves the stated problem. Do not redesign, reformat, rename, or refactor
   unrelated code.
3. **Do not allow silent scope creep.** Record adjacent defects or opportunities
   as follow-up items unless they are necessary to complete the requested task.
4. **Do not invent APIs.** Confirm every function, hook, prop, command, package
   API, configuration key, event field, and protocol value against current
   source, installed dependencies, or authoritative documentation before use.
5. **Preserve established architecture.** Reuse the repository's existing
   modules, public barrels, primitives, patterns, tokens, types, and test
   locations. Do not create competing directory trees or bypass package
   boundaries.
6. **Protect local work.** Inspect `git status` and relevant diffs before
   editing. Existing modified or untracked files belong to the user unless the
   task proves otherwise. Never discard, overwrite, stage, commit, or push them
   without explicit authorization.
7. **No Automatic Commits or Pushes:** AI agents must NEVER run 'git commit' or
   'git push' autonomously after making changes, running fixes, or executing
   verification commands. Agents must leave verified changes in the working
   tree and commit/push ONLY when the human engineer explicitly instructs to do
   so.
8. **Never commit secrets.** Do not place `.env` contents, credentials, tokens,
   capabilities, private keys, runtime socket metadata, or other secrets in
   source files, logs, fixtures, documentation examples, commits, or release
   archives. Use clearly fake placeholders in examples.
9. **Keep security validation deterministic and local.** Core path, process,
   registry, enforcement, and telemetry-validation loops must not call remote
   APIs, model providers, analytics services, or other network resources.
10. **Fail closed.** Unknown errors, malformed inputs, stale identities,
    unavailable registries, corrupt telemetry, and unhandled path states must
    deny access or report degraded health. An enforcement caller may isolate
    only an owned, registered Krypton child whose live identity still matches.
11. **Do not add human interaction to enforcement hooks.** Security checks run
    silently and with bounded latency. Do not add approval prompts, retry
    dialogs, or other interactive loops to the execution path.
12. **Report evidence, not assumptions.** Distinguish commands actually run
    from commands merely recommended. Never describe work as complete,
    verified, or deployment-ready while a required gate is skipped, failing,
    or warning.
13. **Universal Documentation & FAQ Synchronization Protocol:** Whenever runtime
    commands, installation steps, operating system support boundaries,
    architectural mechanics, CLI flags, or security invariants are added,
    modified, or deprecated, AI agents MUST update all relevant documentation
    across the repository in the same change. This includes:
    1. `README.md` Quickstart, Installation, and FAQ sections.
    2. `FEATURES.md` and `ROADMAP.md`.
    3. The ExplainerDrawer component
       (`src/dashboard/components/patterns/ExplainerDrawer/`) and its FAQ tab.
    4. Applicable inline JSDoc and code comments.

    Documentation and FAQs must never be allowed to drift or contradict the
    live codebase.

## 2. Mandatory Verification Contract

Every pass that changes source, configuration, tests, or documentation must end
with fresh runs of all commands below from the repository root. Every command
must exit with status zero and without unresolved warnings:

1. JavaScript and TypeScript lint:

   ```sh
   npm run lint
   ```

2. Root TypeScript verification:

   ```sh
   npx tsc --noEmit
   ```

3. Dashboard TypeScript verification:

   ```sh
   npx tsc --noEmit --project src/dashboard/tsconfig.json
   ```

4. Repository Prettier verification:

   ```sh
   npm run format:check
   ```

5. Rust formatting verification:

   ```sh
   cargo fmt --manifest-path src/core-native/Cargo.toml --check
   ```

6. Rust static analysis:

   ```sh
   cargo clippy --manifest-path src/core-native/Cargo.toml --all-targets --all-features -- -D warnings
   ```

7. JavaScript and TypeScript test suite:

   ```sh
   npm test -- --run
   ```

8. Dashboard design-system compliance:

   ```sh
   npm run design-system:check
   ```

Run additional focused tests while implementing. Changes to Rust behavior must
also run `npm run rust:test`; release work must follow the release-specific
checks documented in `README.md` and `package.json`. `npm run verify` is the
authoritative aggregate repository gate, but a completion report must still
name the individual results required above.

Do not hide a failure behind a pre-existing-error claim. Record the exact
command, exit status, and relevant error, and leave the workflow explicitly
incomplete. Do not commit or push merely because verification passes.

### Mandatory Completion Output Protocol

Every completion response must include:

1. **File change rundown.** List every file created, modified, moved, or removed,
   grouped by subsystem, with a concise explanation of the change.
2. **Package and configuration rundown.** List packages, lockfiles, manifests,
   scripts, environment contracts, and protocol contracts changed. State
   explicitly when none changed.
3. **Tests added or updated.** Identify each relevant test file and the behavior
   covered. State explicitly when no tests changed and why.
4. **Verification results.** Report every applicable formatting, lint,
   typecheck, test, build, Rust, design-system, simulation, or manual check with
   its exact command and PASS or FAIL result.
5. **Step-by-step verification and testing guide.** Give a reproducible sequence
   for another engineer to validate the change, including setup, command,
   interaction, expected output, and environment limitations.
6. **Remaining TODOs and risks.** Identify unresolved blockers, skipped checks,
   platform limitations, security implications, and follow-up work. State
   explicitly when none remain.

## 3. Folder Architecture Map

Preserve this repository layout. Align code within these locations; do not
reshape the tree or create alternate roots.

```text
/
├── src/
│   ├── index.ts                 # TypeScript CLI and runtime entry point
│   ├── config/                  # Runtime configuration and blocked-target policy
│   ├── core/                    # Path policy, process execution, and isolation
│   ├── core-native/             # Rust daemon, watcher, registry, telemetry, IPC
│   │   ├── Cargo.toml
│   │   └── src/
│   ├── dashboard/               # Next.js 16 AegisAgent Command Center
│   │   ├── app/                 # App Router pages and local API routes
│   │   ├── components/
│   │   │   ├── primitives/      # Semantic design-system building blocks
│   │   │   ├── patterns/        # Composed reusable dashboard assemblies
│   │   │   └── ui/              # Established dashboard UI modules
│   │   ├── server/              # Server-only telemetry and native clients
│   │   ├── types/               # Shared dashboard TypeScript contracts
│   │   └── utils/               # Dashboard-local helpers
│   └── utils/                   # Non-blocking logging and shared TS utilities
├── tests/                       # Unit tests mirroring src/core and src/utils
├── tests_simulation/            # End-to-end prompt-injection simulations
├── sandbox_workspace/           # Quarantined operating zone for agent code
└── .krypton/                    # Private, generated, gitignored runtime state
    ├── runtime/
    │   ├── daemon.json          # Socket discovery and daemon metadata
    │   ├── daemon.sock          # Workspace-specific Unix control socket
    │   └── capability           # Private daemon capability material
    └── telemetry/
        └── alerts.jsonl         # Bounded native telemetry ledger
```

### Directory responsibilities

- `/src/core/` owns TypeScript security policy, component-aware path
  evaluation, protected process launch, and process-isolation client behavior.
- `/src/core-native/` owns the Rust daemon, authenticated Unix-domain socket
  server, watcher, live compound process registry, signal delivery, and durable
  native telemetry.
- `/src/dashboard/` owns the Next.js 16 AegisAgent Command Center. Routing and
  server-only behavior remain in `app/` and `server/`; reusable visual elements
  remain in the existing `components/primitives/`, `components/patterns/`, and
  `components/ui/` tiers.
- `/src/config/` owns runtime configuration, sensitive-path definitions, and
  blocked-target sets.
- `/src/utils/` owns non-blocking telemetry streams, logging helpers, and
  framework-independent TypeScript utilities.
- `/sandbox_workspace/` is the only quarantined operating zone for locally
  launched AI agent code.
- `/tests/` mirrors `/src/core/` and `/src/utils/`. For example,
  `src/core/pathPolicy.ts` maps to `tests/core/pathPolicy.test.ts`.
- `/tests_simulation/` contains end-to-end attack and quarantine simulations;
  it does not replace isolated unit coverage.
- `/.krypton/` is generated runtime state. Never treat its socket, capability,
  discovery document, or ledger as tracked source or safe fixture content.

### Dashboard colocation and public API rules

- Preserve the existing dashboard component tiers. Do not move primitives into
  patterns or patterns into route files merely to satisfy a local refactor.
- A reusable component uses a dedicated PascalCase directory containing:

  ```text
  ComponentName/
  ├── ComponentName.tsx
  ├── ComponentName.test.tsx
  └── index.ts
  ```

- Every dashboard component directory and component-tree level exposes an
  `index.ts` public barrel consistent with the existing tree.
- React components use PascalCase. Hooks, helpers, and utilities use camelCase.
- Consumers outside a component tree import through its public barrel when an
  established barrel exists. Do not create circular imports by routing an
  internal sibling dependency through its own root barrel.
- Keep shared React components platform-neutral. Route handlers, Node.js APIs,
  filesystem access, and native IPC remain in explicitly server-side modules.

## 4. Performance and Complexity Invariants

Krypton runs in security-sensitive local execution paths. Latency, memory, file
growth, and queue growth must be explicit and bounded.

1. **Membership structures.** Store repeated policy membership and live process
   identity indexes in native `Set` or `Map` structures for average-case O(1)
   membership by the canonical key. Do not replace them with repeated linear
   array scans.
2. **Complexity accuracy.** A `Set.has` or `Map.get` operation is average-case
   O(1), but path resolution, normalization, canonicalization, comparison, and
   inspection are O(L) in path or identity length. Document the full algorithm,
   not only its cheapest primitive.
3. **No nested hot-path scans.** Do not introduce O(n²) structural scans in path
   checks, watcher callbacks, process registration, identity validation,
   telemetry normalization, or dashboard polling. Use indexed maps, sets, and
   single-pass transforms.
4. **Non-blocking TypeScript telemetry.** Use asynchronous persistence such as
   `fs.appendFile`, promise-based filesystem APIs, or an established writable
   stream. Never use synchronous file writes in TypeScript security hot paths.
5. **Bounded native telemetry.** Keep writer queues bounded and persistence off
   watcher callbacks. Preserve crash-safe JSONL compaction and degraded-health
   reporting when persistence fails.
6. **Hard resource limits.** The native JSONL ledger retains at most 10,000
   events or 8 MiB, whichever limit is reached first. Dashboard client state
   retains at most 500 rows. API pages and table rendering must remain bounded
   by their established lower limits.
7. **React computation.** Memoize materially expensive normalization, sorting,
   filtering, and derived table data with `useMemo`. Stabilize event handlers
   passed through memoized or effect-sensitive boundaries with `useCallback`.
   Do not add blanket memoization when it provides no stable boundary.
8. **Async lifecycle safety.** Polling must preserve one request in flight,
   abort on unmount, pause while hidden, reject stale responses, and avoid
   unbounded retry or accumulation behavior.

## 5. Security Boundary Invariants

1. **Compound process identity is mandatory.** A process identity consists of
   PID, operating-system start time, canonical executable path, and parent PID.
   PID alone is never sufficient authority.
2. **Register before enforcement.** Krypton may isolate only a child process it
   explicitly launched or accepted into its private registry after validating
   the complete live identity.
3. **Revalidate before signaling.** Immediately before isolation, inspect the
   live process and compare the complete identity with the registered record.
   Reject PID reuse, changed executables, changed parents, stale generations,
   missing processes, unknown registrations, and daemon self-targeting.
4. **Never signal arbitrary PIDs.** User-supplied telemetry, dashboard data,
   watcher events, or an untrusted request cannot independently authorize a
   signal. Registry ownership and live identity equality are required.
5. **Use authenticated workspace-specific IPC.** Native control uses the Unix
   socket discovered from `.krypton/runtime/daemon.json`, a private capability,
   versioned bounded messages, peer-user checks, and timeouts. Do not add a fixed
   loopback control port or unauthenticated fallback.
6. **Portable watcher events remain unattributed.** Generic filesystem watcher
   events do not prove which process performed an action. Persist them as
   `unattributed`; never fabricate, infer, broadcast, or reuse actor PIDs.
7. **Native and demonstration evidence must remain distinct.** Native telemetry
   is durable evidence produced by the daemon. Static or fallback data must
   remain explicitly `source: "mock"`, must not claim daemon reachability, and
   must not be described as native detection or enforcement evidence.
8. **Fail closed on boundary uncertainty.** Invalid paths, invalid ledger data,
   identity mismatches, registry lock failures, IPC authentication failures,
   timeouts, and malformed payloads must deny the operation or surface degraded
   state. Do not silently downgrade to permissive behavior.
9. **Bound every externalized value.** Validate payload size, string length,
   queue size, connection count, page size, read window, and response size at
   the trust boundary before allocation or processing.
10. **Keep secrets private at rest.** Runtime directories and files must retain
    least-privilege permissions. Never expose capabilities or discovery data in
    browser bundles, telemetry rows, logs, fixtures, or errors.

## 6. Testing Standards

1. **Mirror TypeScript core tests.** Every operational source file created or
   materially changed under `/src/core/` or `/src/utils/` must have a
   corresponding isolated test under the matching `/tests/` path.
2. **Colocate dashboard tests.** Every created or materially changed reusable
   dashboard component, hook, helper, or route with meaningful behavior must
   have a colocated `*.test.ts` or `*.test.tsx` file in the same module
   directory.
3. **Keep tests atomic.** Each `it` or `test` block verifies one condition or
   state transition and normally contains one to three `expect` assertions.
   Split unrelated behavior into separate cases.
4. **Use deterministic parameter matrices.** Use `test.each` for families of
   valid, invalid, malformed, boundary, and adversarial inputs. Include exact
   threshold values and one value on either side where relevant.
5. **Test failure paths.** Cover malformed input, empty data, unavailable
   resources, corrupt ledgers, stale identities, PID reuse, timeouts, aborted
   requests, queue pressure, rejected writes, and denied access where applicable.
6. **Mock destructive operating-system effects.** Unit tests must mock
   `process.kill`, native signals, filesystem mutations, watcher events, child
   processes, sockets, and other host effects. Never signal a real arbitrary
   process or delete a real user file during a unit test.
7. **Use disposable integration state.** Tests that must exercise real
   filesystem or process behavior use bounded temporary directories and
   explicitly owned disposable children. Teardown must be idempotent and must
   never target the repository root, home directory, or an unresolved path.
8. **Eliminate nondeterminism.** Freeze time, seed fixtures, mock network and
   environment state, and restore spies, timers, globals, and modules after each
   test. Tests must not depend on the current clock, internet, execution order,
   or a developer's existing `.krypton/` state.
9. **Assert behavior, not implementation.** Prefer externally observable policy
   decisions, typed payloads, state transitions, and side-effect boundaries.
   Snapshots may supplement but never replace focused behavioral assertions.
10. **Maintain simulation coverage.** Security workflow changes must update the
    relevant `/tests_simulation/` scenario in addition to unit coverage when the
    behavior crosses policy, process, daemon, or telemetry boundaries.
11. **Maximize practical coverage.** Exercise every meaningful exported branch
    and failure mode in changed security code. Coverage numbers do not justify
    brittle or implementation-coupled tests.

## 7. JSDoc and Code Documentation Conventions

Documentation must explain trust boundaries, observable behavior, and real
complexity without decorating visual component declarations.

### Rule A: React components

- Do not place full function-level JSDoc blocks on visual React component
  functions. The Props interface is the component's documentation contract.
- Every property in a component Props interface must have an inline JSDoc
  comment directly above the field.
- Add `@default` only when the component itself defines an explicit default.
- Document callback timing, accessibility meaning, environment restrictions,
  and native/mock differences when they are part of the prop contract.

```typescript
export interface StatusCardProps {
  /** The operator-facing label rendered as the card heading. */
  readonly label: string;

  /**
   * The semantic health treatment applied to the card.
   *
   * @default "neutral"
   */
  readonly tone?: 'neutral' | 'healthy' | 'critical';
}
```

### Rule B: non-component functions

Every function, method, helper, and hook declared in `/src/core/` and
`/src/utils/`, including internal helpers, requires a full JSDoc block directly
above its declaration. Apply the same standard to materially complex dashboard
and server helpers.

Each block must contain:

1. A clear summary sentence.
2. One typed `@param` entry for every parameter, including callback parameters.
3. An explicit `@returns` entry, including `void`, `Promise<void>`, or possible
   error outcomes when relevant.
4. An accurate `@complexity` entry for total time and auxiliary space. State
   average-case Set/Map lookup separately from O(L) path or identity processing.
5. A practical `@example` showing a representative invocation and expected
   return, state transition, or rejection.

```typescript
/**
 * Resolves a requested path against the protected workspace root.
 *
 * @param {string} targetPath - The raw lexical path supplied by the caller.
 * @returns {string} The canonical absolute path evaluated by policy.
 * @complexity O(L) time and space in the normalized path length L; subsequent
 * policy-set membership is O(1) average case.
 * @example
 * resolveRequestedPath('./sandbox_workspace/file.txt');
 * // => '/absolute/project/root/sandbox_workspace/file.txt'
 */
```

Do not claim O(1) for a full algorithm merely because one internal operation is
a Set or Map lookup. Keep comments synchronized with real error, side-effect,
and complexity behavior.

## 8. Design System and Token Enforcement

The dashboard must consume the established Krypton semantic design system and
theme primitives.

1. **No hardcoded colors.** Do not add hexadecimal, RGB, HSL, named color, or
   arbitrary Tailwind color values inside dashboard React components. Use the
   approved semantic Krypton tokens and primitive variants.
2. **No raw pixel padding or magic layout styles.** Do not add literal pixel
   padding, margin, gap, radius, border, shadow, or typography values in JSX,
   inline styles, CSS modules, or arbitrary Tailwind utilities. Use established
   spacing, sizing, radius, typography, elevation, and layout tokens.
3. **Use primitives before custom markup.** Extend an existing primitive or
   semantic variant when a reusable interaction is missing. Do not duplicate
   button, select, card, badge, tooltip, switch, or table behavior in a route.
4. **Keep primitives encapsulated.** Primitives remain domain-neutral and own
   accessibility, focus, disabled, busy, and semantic visual states. Patterns
   compose primitives; pages compose patterns and own route-level data flow.
5. **Use semantic state names.** Prefer tokens such as surface, foreground,
   muted, border, accent, success, warning, and critical over palette-specific
   names. Native, degraded, and mock states must remain distinguishable without
   relying on color alone.
6. **Accessibility is mandatory.** Interactive controls require semantic roles,
   accessible names, keyboard operation, visible focus, and disabled or busy
   states where applicable. Decorative icons must be hidden from assistive
   technology.
7. **Enforce mechanically.** Run `npm run design-system:check` after every
   dashboard change. Fix violations at the approved token or primitive layer;
   do not weaken, bypass, or suppress the checker to make a change pass.
