#!/bin/bash
# Source-checkout launcher. Client backups and merges belong to setup.cjs.
set -u
if ! cd -- "$(dirname -- "$0")/.."; then
  printf '%s\n' 'Krypton setup failed: checkout_unavailable.' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Krypton setup failed: node_missing. Install Node 20.19.4 and make node available on PATH, or use the standalone macOS MCPB.' >&2
  exit 1
fi
exec node src/cli/install.cjs "$@"
