#!/usr/bin/env node
const path = require('node:path');
const { runCli } = require('./cli/runtime.cjs');

// Bare run is stdio MCP; run -- <command> retains the registered-child supervisor.
if (process.argv.length === 3 && process.argv[2] === 'run') {
  void require('./packaging/launch_mcpb.cjs').launchStandaloneMcpb({
    nativeBinaryPath: path.resolve(__dirname, 'core-native/target/release/krypton-core-native'),
  });
} else {
  void runCli((argv) => require('./core/supervisor.cjs').main(argv));
}
