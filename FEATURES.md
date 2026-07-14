# Krypton feature ledger

This ledger tracks active Krypton capabilities and architectural milestones.
Add future work as a new phase so scope, status, and verification remain clear.

## Active milestones

| Phase | Status | Feature |
| --- | --- | --- |
| Phase 1 | Active | **Local Directory Watchdog & Process Isolation** — Intercepts unauthorized out-of-bounds path traversal and terminates rogue agent child processes via OS-level `SIGKILL` execution. |

### Phase 1 verification

- Resolves requested paths to absolute paths before evaluating access.
- Allows paths contained by `/sandbox_workspace`.
- Denies paths outside the sandbox and sensitive endpoints such as `.ssh`,
  `.aws`, and `.env`.
- Terminates a quarantined child process with `SIGKILL`.
- Appends a structured event to the local `alerts.json` ledger without blocking
  the main event loop.

## Planned milestones

Add future phases below using the same shape:

```markdown
### Phase N: Milestone name

- **Status:** Planned | Active | Complete
- **Objective:** Concise architectural outcome.
- **Verification:** Observable evidence that the milestone works.
```
