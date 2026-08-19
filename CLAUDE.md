@AGENTS.md

# Claude Focus: AegisAgent Command Center

Apply every requirement in `AGENTS.md`. Within that contract, prioritize the
Next.js 16 dashboard under `src/dashboard/` and the AegisAgent Command Center's
UI and UX architecture.

- Preserve the existing `app/`, `server/`, `types/`, `utils/`, and component
  hierarchy. Keep primitives domain-neutral, patterns compositional, and route
  files responsible for route-level state and data flow.
- Enforce semantic Krypton design tokens and primitive encapsulation. Do not add
  hardcoded colors, raw pixel padding, arbitrary visual values, or duplicated
  primitive behavior.
- Maintain accessible roles, names, keyboard interaction, focus treatment,
  disabled and busy states, and hidden decorative icons.
- Treat native, degraded-native, and static/mock environments as distinct state
  machines. Never present demonstration data as native telemetry or enforcement
  evidence.
- Keep React state synchronized across polling, visibility changes, aborts,
  stale responses, optimistic mutations, rollback, and bounded client history.
- Use `useMemo` for materially expensive derived data and `useCallback` when
  referential stability protects a real child or effect boundary.
- Keep frontend tests atomic and colocated. Cover environment transitions,
  accessibility contracts, user-visible state, deterministic mock scenarios,
  async failures, and rollback behavior.

Use the Mandatory Verification Contract and Mandatory Completion Output
Protocol in `AGENTS.md`; do not substitute a narrower frontend-only gate.
