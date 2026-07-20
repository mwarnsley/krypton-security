# Contributing to Krypton

Use Node 20.19.4 and Rust 1.97.0. Start from a reproducible install:

```sh
npm ci
```

Keep changes narrow, preserve fail-closed behavior, and never fabricate process
attribution from a portable filesystem event. New core utilities require
mirrored focused tests; reusable dashboard components require colocated tests
and directory barrels. Next.js `page.tsx`, `layout.tsx`, and `route.ts` files are
framework entry points and must not be re-exported through barrels.

Before requesting review:

```sh
npm run verify
npm run test:coverage
npm run security:audit
git diff --check
```

Security-sensitive paths are listed in `.github/CODEOWNERS`. Repository files
route review but do not enable branch rules, required signed commits, secret
scanning, or mandatory approvals; maintainers configure those controls in
GitHub.

Tests that exercise isolation must spawn disposable owned children. Never send a
signal to an arbitrary PID, the invoking shell, or another user's process. Never
commit runtime sockets, capabilities, telemetry, build output, coverage,
dependency directories, generated archives, or secret-like files.
