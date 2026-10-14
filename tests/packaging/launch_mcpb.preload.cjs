'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const mcpbRuntime = require('../../src/packaging/mcpb_runtime.cjs');
const processIsolation = require('../../src/core/processIsolation.cjs');
const mcpServer = require('../../src/core/mcp/server.cjs');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('invalid launcher test environment');
  return value;
}

function parsedEnvironment(name) {
  const value = JSON.parse(requiredEnvironment(name));
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid launcher test environment');
  return value;
}

const signals = requiredEnvironment('KRYPTON_TEST_SIGNALS_PATH');
if (!path.isAbsolute(signals)) throw new Error('invalid launcher test environment');

const serverMode = requiredEnvironment('KRYPTON_TEST_SERVER_MODE');
if (!['throw', 'stdout', 'stderr'].includes(serverMode))
  throw new Error('invalid launcher test environment');

const runtime = parsedEnvironment('KRYPTON_TEST_RUNTIME');
const ready = parsedEnvironment('KRYPTON_TEST_READY');
const discovery = parsedEnvironment('KRYPTON_TEST_DISCOVERY');
const child = new cp.ChildProcess();

Object.defineProperty(child, 'pid', { value: 424242 });
child.kill = (signal) => {
  fs.appendFileSync(signals, signal + '\n');
  child.signalCode = signal;
  queueMicrotask(() => {
    child.emit('exit', null, signal);
    child.emit('close', null, signal);
  });
  return true;
};

process.kill = () => {
  throw new Error('arbitrary PID signaling forbidden');
};
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process, 'arch', { value: 'arm64' });
cp.spawn = () => child;

mcpbRuntime.prepareStandaloneRuntime = async () => runtime;
processIsolation.dispatchNativeControl = async () => ready;
processIsolation.discoverNativeEndpoint = async () => discovery;
mcpServer.serve = async () => {
  if (serverMode === 'throw') throw new Error('private capability /private/workspace');
  if (serverMode === 'stdout') {
    process.stdout.emit('error', new Error('private capability'));
    return;
  }
  process.stderr.emit('error', new Error('private capability'));
};
