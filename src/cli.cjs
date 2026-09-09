#!/usr/bin/env node
const { main } = require('./core/supervisor.cjs');

void main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write(
      '[KRYPTON] Supervisor failed; native supervision could not be confirmed.\n'
    );
    process.exitCode = 1;
  }
);
