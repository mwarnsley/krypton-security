# Release and repository contracts

## Required CI checks

`.github/workflows/ci.yml` runs for pull requests targeting `main`, pushes to
`main`, and reusable workflow calls from the release pipeline. Its required job
name is **Phase 1 verification**. Do not rename it without migrating the required
status-check setting first. No path filter, tolerated failure or secret-bearing
`pull_request_target` event may bypass this gate.

The job uses Apple Silicon `macos-14`, Node 20.19.4, npm 10.8.2 and the
`rust-toolchain.toml` Rust 1.97.0 pin. It installs with `npm ci`, then checks every
npm advisory severity (including development dependencies), ESLint, both
TypeScript projects, Prettier/YAML and Rust formatting, Clippy, Vitest, native
tests, `test:sim`, `test:e2e`, dashboard token compliance, dashboard build and
MCPB build/ZIP integrity. Network, install, audit and test errors fail the job.
All jobs have time limits and use fresh hosted runners; tests own disposable
children and never use the maintainer's daemon or client settings.

The existing `quality.yml` workflow retains additional Linux coverage, npm/Rust
SBOM generation and pinned Rust advisory/license tools. Its jobs are named
**JavaScript and TypeScript** and **Native Rust core**. They supplement the
macOS gate; experimental Linux runtime support is not promoted by compilation.
`deploy.yml` continues to publish only the static demonstration dashboard.

## Activate strict main protection

Repository files do not activate GitHub settings. The repository owner must
configure an active branch ruleset for `refs/heads/main` and verify it in GitHub:

1. Require pull requests, at least one human approval, code-owner review, stale
   approval dismissal, approval after the latest push and resolved conversations.
2. Require signed commits. A verified signature proves control of a signing key;
   it does not prove that code or its author is trustworthy.
3. Require **Phase 1 verification**, **JavaScript and TypeScript**, and
   **Native Rust core**, selecting GitHub Actions as the expected source. Require
   the branch to be up to date before merging. Select checks after their first
   real PR execution so their names and source are verified.
4. Block force pushes and deletion. Apply the rules to administrators and bots;
   configure no routine bypass actors. Agents cannot approve their own changes
   or bypass reviews. Restrict creation/update/deletion of release tags to release
   maintainers using a separate tag ruleset.
5. Confirm an unapproved PR and a deliberately failing check cannot merge. Restore
   the fixture PR afterward. Record the ruleset URL and successful check run in
   release review notes. These controls remain unverified until this is done.

Do not enable merge queues without adding a `merge_group` CI trigger and verifying
the required check contexts for that event. Do not suppress a failing required
check to complete a release.

## Tagged draft releases

The product version is `package.json.version`; the MCPB manifest uses the same
version. The Rust crate's internal version is independent. Maintainers prepare
the product version/lockfile in a reviewed PR before creating an immutable
`vMAJOR.MINOR.PATCH` tag (valid SemVer prerelease/build identifiers are supported).
Tags must match the product version exactly and point to a commit reachable from
`main`. The broad Actions `v*.*.*` filter is followed by strict validation.

`.github/workflows/release.yml`:

1. Validates the tag and main ancestry, then runs the reusable CI workflow against
   that tag. The MCPB comes from this run's successful build, not another branch,
   an old local artifact or a mutable external download.
2. Builds with `cargo build --release --locked` for `aarch64-apple-darwin` on
   `macos-14` and `x86_64-apple-darwin` on `macos-15-intel`. `lipo -archs` must
   confirm the target architecture before upload. The native toolchain stays pinned.
3. Downloads exactly the three primary artifacts from that workflow run and
   computes/verifies SHA-256 checksums using the dependency-free
   `scripts/release-artifacts.cjs` contract.
4. Rechecks that the remote tag still resolves to the tested commit, then creates
   a **draft** GitHub Release with `gh release create --draft --verify-tag`.
   SemVer prerelease tags also set GitHub's `--prerelease` flag.
   Only this job has `contents: write`; only its final command receives `GH_TOKEN`.
   No personal PAT, signing key or repository secret is supplied to PR execution.
   Existing releases are never overwritten. A failed upload leaves a draft for
   owner inspection; do not publish a partial draft or replace an existing tag.

The release attaches these three primary assets, each matching `.sha256` sidecar,
and the combined `SHA256SUMS` file:

| Artifact                                   | Contract                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `krypton-core-native-aarch64-apple-darwin` | Optimized Apple Silicon Mach-O daemon                                  |
| `krypton-core-native-x86_64-apple-darwin`  | Optimized Intel Mach-O daemon                                          |
| `krypton-protected-fs.mcpb`                | Deterministic MCPB with server, supervisor and JavaScript dependencies |

Names are stable within each versioned release. Checksums cover primary assets;
checksum files do not recursively hash themselves. Checksum validation rejects
unknown, missing, empty, redirected or modified artifacts. Files must be regular
and each primary asset is bounded to 128 MiB. SHA-256 detects changed bytes; it
does not establish publisher identity. Binaries and MCPB remain unsigned and
unnotarized until a separate signing/key-management contract is implemented.

Download the assets and `SHA256SUMS` into one directory and run:

```sh
shasum -a 256 -c SHA256SUMS
```

After verifying the matching architecture, set the downloaded binary executable
with `chmod +x krypton-core-native-aarch64-apple-darwin` (or the Intel filename).
Run it from the configured Krypton checkout. The MCPB installer selects that
checkout and still requires its running native daemon; it does not install a
system service or expand the runtime's containment boundary.

Owner review, live macOS client/notification QA, signing policy and manual final
publication remain release gates. Local validation of YAML does not prove a
hosted Actions run, branch protection or a successful remote release upload.

## Local checks and artifact preparation

Use the pinned toolchains, `npm ci`, Python 3 and `unzip`. Run:

```sh
npm run verify
npm run format:check
npm run security:audit
npm run test:sim
npm run test:e2e
npm run build:mcpb
RELEASE_TAG=v1.0.0 npm run release:validate
```

Use the current package version in `RELEASE_TAG`. After copying the exact three
primary assets into a fresh directory, run `npm run release:checksums -- <dir>`
then `npm run release:verify-artifacts -- <dir>`. Existing checksum outputs are
rejected; retry using a new directory after investigating any failure. Source ZIP
distribution remains separate: `npm run release:package` requires a clean,
committed tree and includes tracked source only.

## Agent GitHub integration

Use a fine-grained PAT scoped only to `mwarnsley/krypton-security`, with a short
expiry and owner-approved permissions. Default to Metadata/Contents/Pull requests/
Actions/Checks read access as needed. Add Contents and Pull requests write only
for explicitly authorized branch/PR work; add Workflows write only for authorized
workflow edits. Actions write for reruns and Administration permissions for rules
are separate owner decisions, not baseline agent permissions.

For the official GitHub MCP server, use the host's secret provider: local stdio
servers accept `GITHUB_PERSONAL_ACCESS_TOKEN`; remote servers accept authenticated
headers at `https://api.githubcopilot.com/mcp/`. Configure read-only mode/tool
restrictions for review tasks. For `gh`, supply the fine-grained token through
`GH_TOKEN` from an external secret store. Confirm the account/repository with
`gh auth status` and `gh repo view mwarnsley/krypton-security`; never print token
values, enable shell tracing around them, or commit them in MCP JSON, `.env`,
workflow YAML, example files or logs. Client tool restrictions complement token
permissions; they cannot restrict direct API access granted by the token.

Agents may inspect diffs, checks and run logs within their authorized scope.
Creating comments, committing, pushing, merging, modifying rules or creating tags
requires explicit task authorization. A configured token does not grant that
authorization. Uncertain API responses must be investigated before retrying
mutations. Missing/expired credentials produce a clear diagnostic; never fall
back to another identity or a broader token. GitHub integration is development
tooling and must never enter local containment or enforcement loops.

References: [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[GitHub MCP configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md),
[fine-grained tokens with gh](https://cli.github.com/manual/gh_auth_login),
and [draft release creation](https://cli.github.com/manual/gh_release_create).
