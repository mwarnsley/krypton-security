#!/usr/bin/env node
'use strict';

const { runCli } = require('../cli/runtime.cjs');

/**
 * Loads the shared native simulation only when invoked, keeping imports side-effect free.
 * @returns {Promise<void>} Resolves after verification and owned fixture cleanup.
 * @complexity Bounded by the simulation's build, IPC and process deadlines.
 * @example await runSimulation(); // Real native IPC; disposable workspace only.
 */
async function runSimulation() {
  require('ts-node/register');
  const { runInjectionSimulation } = require('../../tests_simulation/test_injection.ts');
  await runInjectionSimulation();
}

/**
 * Runs containment checks and emits success only after cleanup completes.
 * @param {function(): Promise<void>} run - Disposable verification implementation.
 * @param {function(string): void} report - Terminal success reporter.
 * @returns {Promise<number>} Zero on success; rejects into the shared CLI error boundary.
 * @complexity O(1) wrapper state; native verification has explicit resource bounds.
 * @example await runE2E(); // Prints the checks and a final PASS line.
 */
async function runE2E(run = runSimulation, report = console.log) {
  await run();
  report('[PASS] Local E2E containment verification complete.');
  return 0;
}

if (require.main === module) void runCli(() => runE2E());

module.exports = { runE2E };
