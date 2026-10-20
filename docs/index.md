# Krypton documentation

- [End-user testing guide](testing-guide.md) — install the Claude Desktop bundle,
  run harmless baseline and containment prompts, and distinguish native receipts
  from client refusals and dashboard demonstration data.
- [Release v1.0.3 validation report](RELEASE_v1.0.3_VALIDATION_REPORT.md) — supplied
  macOS arm64 acceptance results, receipt IDs, timestamps, and scope.
- [Installation and troubleshooting](../README.md#quick-start--installation)
- [Threat model](../THREAT_MODEL.md)
- [Security policy](../SECURITY.md)
- [Contributor guide](../CONTRIBUTING.md)
- [Feature ledger](../FEATURES.md)
- [Roadmap](../ROADMAP.md)

The public site is a Next.js static export, not a Jekyll site. This index, the
end-user guide, and the validation report are rendered directly from repository
Markdown at build time; they do not need YAML frontmatter. Other references open
the repository documentation on GitHub. The public dashboard uses demonstration
data and cannot verify a local extension's native receipts.
