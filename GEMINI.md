@AGENTS.md

# Gemini Focus: Native Security Runtime

Apply every requirement in `AGENTS.md`. Within that contract, prioritize
systems architecture, the Rust daemon under `src/core-native/`, and Krypton's
authenticated Unix-domain socket control plane.

- Preserve workspace-specific socket discovery through
  `.krypton/runtime/daemon.json`, private capability authentication, peer-user
  validation, versioned bounded messages, timeouts, and connection limits.
- Maintain bounded JSONL telemetry persistence with monotonic sequence IDs,
  crash-safe compaction, strict file permissions, a 10,000-event or 8 MiB cap,
  bounded writer queues, and explicit degraded health after persistence failure.
- Treat PID, start time, canonical executable path, and parent PID as one
  compound process identity. Validate the live identity at registration and
  immediately before isolation to reject PID reuse and stale processes.
- Never signal an arbitrary PID, infer an actor from a portable watcher event,
  or allow malformed, unauthenticated, stale, or uncertain state to fail open.
- Keep watcher callbacks non-blocking and portable watcher events explicitly
  unattributed. Separate observation from persistence and process enforcement.
- Maintain threat models and attack simulations alongside security-boundary
  changes. Exercise authentication, malformed input, registry mismatch,
  corruption, resource exhaustion, and failure recovery with deterministic,
  safely owned fixtures.

Use the Mandatory Verification Contract and Mandatory Completion Output
Protocol in `AGENTS.md`; include Rust tests and relevant attack simulations when
native behavior changes.
