# Vulnerability & Contribution Security Matrix

Krypton treats every contribution as untrusted until its identity, provenance,
review path, and execution behavior are verified. This defense-in-depth model is
designed to contain AI bots, automated poisoning scripts, and rogue malicious
pull requests before they can compromise maintainers, CI runners, release
artifacts, or the runtime boundary itself.

## Contribution threat matrix

| Threat                                     | Primary attack path                                                                 | Required control                                       | Enforcement outcome                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| AI bots impersonating trusted contributors | Forged author metadata, copied identities, or unverified automated commits          | Cryptographic Identity Verification                    | Reject unverified commits and prevent spoofed authors from entering protected branches.          |
| Automated poisoning scripts                | Malicious test fixtures, dependency hooks, or exploit payloads executed by CI       | Hermetic CI/CD Test Isolation                          | Confine execution to disposable, non-root runners with no persistent credentials or host access. |
| Rogue malicious pull requests              | Hidden changes to native enforcement, exploit utilities, workflows, or dependencies | Split-Domain Code Ownership and mandatory human review | Block merging until the designated security owners approve every protected-path change.          |
| Compromised third-party automation         | Mutable action tags redirected to attacker-controlled code                          | Immutable Actions Architecture                         | Execute only the reviewed action revision identified by its full cryptographic commit SHA.       |

## Core security pillars

### Cryptographic Identity Verification

Strictly require GPG- or SSH-signed commits on protected branches to completely
eliminate author identity spoofing. Branch protection must reject unsigned or
unverified contributions regardless of whether the contributor is a human,
bot, or service account.

### Hermetic CI/CD Test Isolation

Run every integration test suite that executes exploit behaviors inside a
non-root, ephemeral, isolated environment. Test runners must start from a clean
image, receive only the minimum required permissions, expose no reusable release
credentials, and be destroyed after the job so a malicious payload cannot
hijack the runner or persist into later workflows.

### Immutable Actions Architecture

Hardcode the full, unique cryptographic commit SHA for every third-party GitHub
Action. Mutable version tags, branches, and floating references are prohibited
because an upstream rewrite must never change the code executed by an already
reviewed Krypton workflow.

### Split-Domain Code Ownership

Enforce explicit path-based code owners and mandatory human reviews for every
change to the Rust system core (`/src/core-native/`) or exploit utility
algorithms (`/src/utils/`). Automation may propose changes, but it must not
self-approve, bypass the designated owners, or merge changes to either protected
domain.

## Merge boundary

A contribution is eligible to merge only when its commit identity is verified,
all referenced automation is immutable, exploit-capable tests pass inside the
hermetic runner boundary, and every protected path has the required human owner
approval. Any missing or indeterminate control fails closed and blocks the
merge.
