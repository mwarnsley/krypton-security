# Security policy

## Supported versions

Security fixes are applied to the current `main` branch. No older release line
is presently supported because Krypton has not published a stable signed
release.

## Report a vulnerability

Do not open a public issue for an active vulnerability. Use GitHub private
vulnerability reporting for this repository when available. If that feature is
not enabled, contact the repository owner privately through the contact method
on the owner's GitHub profile and include:

- affected commit or version;
- platform and configuration;
- reproducible steps or proof of concept;
- expected and observed security boundary;
- impact and suggested mitigation, if known.

Do not include real credentials, third-party personal data, or destructive
payloads. Use disposable fixtures and owned child processes.

## Response process

The maintainer should acknowledge a report, reproduce it privately, assess the
affected boundary, prepare tests and a fix, and coordinate disclosure after a
patched revision is available. Timelines depend on severity and maintainer
availability; no guaranteed response SLA is currently published.

## Release integrity

The repository defines tagged draft-release automation for Intel/Apple Silicon
native binaries and the MCPB bundle, with verified per-file SHA-256 checksums and
`SHA256SUMS`. See [release contracts](docs/RELEASE.md). Hosted execution and final
publication must be verified separately. Checksums detect changed bytes; they
do not authenticate the publisher. Until signing credentials and a documented
key-rotation process exist, consumers must not treat an unsigned archive or
binary as an authenticated Krypton release.
