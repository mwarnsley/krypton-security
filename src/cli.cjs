#!/usr/bin/env node
const { runCli } = require('./cli/runtime.cjs');

void runCli((argv) => require('./core/supervisor.cjs').main(argv));
