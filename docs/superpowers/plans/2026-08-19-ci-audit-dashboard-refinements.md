# CI Audit and Dashboard Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the JavaScript and Rust CI scanner blockers and refine the AegisAgent table, cursor, audit-mode, timestamp, and simulated row-action behavior.

**Architecture:** Dependency and CI changes remain confined to the npm manifests and the existing quality workflow. Dashboard behavior stays inside the established page, primitive, and pattern modules: shared controls own cursor semantics, the shared data table owns cell alignment and empty-state layout, the page owns audit-mode notification routing, and `AlertTable` preserves verified native isolation while exposing non-native mock actions only for non-actionable rows.

**Tech Stack:** Node.js 20.19.4, npm 10.8.2, Next.js 16, React 19, TypeScript, TanStack Table, Radix Dropdown Menu, Sonner, date-fns, Vitest, Rust, cargo-audit.

**Spec:** `AGENTS.md` plus the approved CI scanner and dashboard refinement request in the current engineering task.

## Global Constraints

- Preserve the existing repository and dashboard component folder structure.
- Keep native and simulated telemetry explicitly distinct.
- Never send a native isolation request without a verified compound process identity.
- Use the exact requested audit-mode toast titles and descriptions.
- Use semantic Krypton tokens; add no inline styles, arbitrary visual utilities, or hardcoded colors.
- Run every requested JavaScript, TypeScript, test, coverage, design-system, and Rust gate before release.
- Produce only the single explicitly authorized commit after all gates pass.

---

### Task 1: Lockfile and Rust scanner remediation

**Files:**

- Review: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**

- Consumes: npm advisory metadata and the RustSec `cargo-audit` 0.22.2 release.
- Produces: a reproducible npm graph with no high-severity findings and a locked cargo-audit installation that parses current advisory vectors.

- [x] **Step 1: Activate the pinned JavaScript toolchain**

Run:

```sh
source /Users/marcuswarnsley/.nvm/nvm.sh
nvm use 20.19.4
node --version
npm --version
```

Expected: Node `v20.19.4` and npm `10.8.2`.

- [x] **Step 2: Apply the supported npm advisory repairs**

Run:

```sh
npm audit fix
```

Expected: Next.js, PostCSS, Sharp, and vulnerable transitive packages resolve to fixed versions without `--force`.

- [x] **Step 3: Pin the current locked Rust scanner**

Change the workflow install segment to:

```yaml
cargo install cargo-audit --locked --force --version 0.22.2
```

Keep the existing locked cargo-deny and cargo-cyclonedx versions unchanged.

- [x] **Step 4: Verify install reproducibility and audit status**

Run:

```sh
npm ci
npm run security:audit
```

Expected: clean install succeeds and the high-severity audit exits zero.

### Task 2: Shared table layout and cursor contracts

**Files:**

- Modify: `src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.test.tsx`
- Modify: `src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.tsx`
- Modify: `src/dashboard/components/primitives/KryptonButton/KryptonButton.test.tsx`
- Modify: `src/dashboard/components/primitives/KryptonButton/KryptonButton.tsx`
- Modify: `src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.test.tsx`
- Modify: `src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.tsx`
- Modify: `src/dashboard/components/patterns/InfoTooltip/InfoTooltip.test.tsx`

**Interfaces:**

- Consumes: existing Krypton semantic classes and native HTML disabled behavior.
- Produces: consistent middle-aligned cells, a two-axis centered empty state, and inherited pointer/not-allowed cursor behavior.

- [x] **Step 1: Add failing shared-layout and cursor tests**

Add literal markup assertions that require:

```text
align-middle px-krypton-space-4 py-krypton-space-3
cursor-pointer disabled:cursor-not-allowed
```

For the empty row, require a tokenized fixed-height flex wrapper with `items-center justify-center`.

- [x] **Step 2: Run focused tests and confirm the new assertions fail**

Run:

```sh
npm test -- --run src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.test.tsx src/dashboard/components/primitives/KryptonButton/KryptonButton.test.tsx src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.test.tsx src/dashboard/components/patterns/InfoTooltip/InfoTooltip.test.tsx
```

Expected: failures identify missing middle alignment, centered empty-state structure, or cursor classes.

- [x] **Step 3: Implement the shared contracts**

Add `cursor-pointer disabled:cursor-not-allowed` to both button primitive base-class strings and remove the conflicting disabled pointer suppression. Apply identical tokenized padding plus `align-middle` to `<th>` and `<td>`. Render the empty copy inside a full-width flex wrapper with a stable token-compatible height and two-axis centering.

- [x] **Step 4: Re-run focused tests**

Run:

```sh
npm test -- --run src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.test.tsx src/dashboard/components/primitives/KryptonButton/KryptonButton.test.tsx src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.test.tsx src/dashboard/components/patterns/InfoTooltip/InfoTooltip.test.tsx
```

Expected: all focused primitive and data-table tests pass.

### Task 3: Timestamp, audit-mode notification, and simulated actions

**Files:**

- Modify: `src/dashboard/components/patterns/AlertTable/AlertTable.test.tsx`
- Modify: `src/dashboard/components/patterns/AlertTable/AlertTable.tsx`
- Modify: `src/dashboard/app/page.test.tsx`
- Modify: `src/dashboard/app/page.tsx`

**Interfaces:**

- Consumes: `SecurityAlert`, verified `ProcessIdentityPayload`, Sonner `toast.info`, and existing Radix menu primitives.
- Produces: `MM/DD/YYYY • hh:mm:ss A` local timestamps, exact demo audit notifications, and mock-only actions for rows without verified native identity.

- [x] **Step 1: Add failing behavioral tests**

Add tests requiring the local timestamp literal:

```text
07/14/2026 • 08:00:00 AM
```

Add parameterized tests requiring these exact Sonner calls:

```typescript
toast.info('Audit-Only Mode enabled (Simulation)', {
  description: 'Policy violations will be logged without active process termination.',
});

toast.info('Enforcement Mode enabled (Simulation)', {
  description: 'Policy violations will trigger immediate process quarantine.',
});
```

Add alert-table assertions that a simulated/unattributed row has an enabled menu trigger and offers `View Raw Payload`, `Copy Process Details`, and `Inspect Sandbox Boundary`, while verified native rows retain `Force Isolate` and `Download Signature`.

- [x] **Step 2: Run focused tests and confirm failure**

Run:

```sh
npm test -- --run src/dashboard/app/page.test.tsx src/dashboard/components/patterns/AlertTable/AlertTable.test.tsx
```

Expected: failures identify the old date layout, missing demo toast router, and disabled mock-row action trigger.

- [x] **Step 3: Implement the minimal behavior**

Change the date-fns format token to `MM/dd/yyyy • hh:mm:ss a` and synchronize its JSDoc example. Add one documented helper that dispatches the exact simulation toast based on the selected boolean, and call it only after local demo state routing. In `AlertTable`, enable the trigger for non-native rows and select between a mock-only menu and the existing verified native action menu; mock selections must not call `/api/telemetry/terminate`.

- [x] **Step 4: Re-run focused tests**

Run:

```sh
npm test -- --run src/dashboard/app/page.test.tsx src/dashboard/components/patterns/AlertTable/AlertTable.test.tsx
```

Expected: all page and AlertTable tests pass.

### Task 4: Formatting, full verification, and authorized release

**Files:**

- Review: every modified path from Tasks 1-3
- Stage: only the reviewed task files and this implementation plan

**Interfaces:**

- Consumes: the complete working-tree diff.
- Produces: one verified commit on `main`, pushed to `origin/main`.

- [x] **Step 1: Format the modified source and documentation**

Run:

```sh
npx prettier --write .github/workflows/quality.yml package.json package-lock.json docs/superpowers/plans/2026-08-19-ci-audit-dashboard-refinements.md src/dashboard/app/page.tsx src/dashboard/app/page.test.tsx src/dashboard/components/patterns/AlertTable/AlertTable.tsx src/dashboard/components/patterns/AlertTable/AlertTable.test.tsx src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.tsx src/dashboard/components/patterns/KryptonDataTable/KryptonDataTable.test.tsx src/dashboard/components/primitives/KryptonButton/KryptonButton.tsx src/dashboard/components/primitives/KryptonButton/KryptonButton.test.tsx src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.tsx src/dashboard/components/primitives/KryptonIconButton/KryptonIconButton.test.tsx src/dashboard/components/patterns/InfoTooltip/InfoTooltip.test.tsx
git diff --check
```

- [x] **Step 2: Run the complete gate suite**

Run:

```sh
npm run format:check
npm run lint
npx tsc --noEmit
npx tsc --noEmit --project src/dashboard/tsconfig.json
npm test -- --run
npm run test:coverage
npm run design-system:check
cargo fmt --manifest-path src/core-native/Cargo.toml --check
cargo clippy --manifest-path src/core-native/Cargo.toml --all-targets --all-features -- -D warnings
npm run security:audit
```

Expected: every command exits zero with no unresolved warning.

- [x] **Step 3: Audit release contents**

Run:

```sh
git status --short
git diff --check
git diff --stat
git diff
```

Expected: only approved task files are present and no secret/runtime artifacts are included.

- [x] **Step 4: Create and push the authorized commit**

Run:

```sh
git add .
git diff --cached --check
git commit -m "fix: resolve CI audit scanners and refine dashboard UI interactions"
git push origin main
```

Expected: the commit is created on `main`, the push succeeds without force, and local `HEAD` equals `origin/main`.
