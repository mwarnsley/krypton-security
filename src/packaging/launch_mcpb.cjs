#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runCli } = require('../cli/runtime.cjs');

// Reuse the MCP host's exact Node executable; GUI hosts need no shell or PATH shim.
// The manifest supplies the selected checkout through KRYPTON_PROJECT_ROOT.
void runCli(() =>
  require('../core/supervisor.cjs').main([
    'run',
    '--',
    process.execPath,
    path.resolve(__dirname, '../core/mcp/server.cjs'),
  ])
);
