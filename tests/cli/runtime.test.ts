import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const runtime = path.resolve('src/cli/runtime.cjs');
const invoke = (body: string) =>
  spawnSync(
    process.execPath,
    [
      '--unhandled-rejections=strict',
      '-e',
      `const { runCli } = require(${JSON.stringify(runtime)}); ${body}`,
    ],
    { encoding: 'utf8', timeout: 5000 }
  );

describe('CLI terminal error ownership', () => {
  it('bounds a terminal diagnostic whose stream never calls back', () => {
    const child = invoke(
      'process.stderr.write = () => true; void runCli(async () => { throw null; });'
    );
    expect(child.status).toBe(1);
    expect(child.error).toBeUndefined();
  });
  it.each(['throw null', "throw new Error('private capability')"])(
    'owns command rejection: %s',
    (body) => {
      const child = invoke(`void runCli(async () => { ${body}; });`);
      expect(child.status).toBe(1);
      expect(child.stderr).toContain('command failed closed');
      expect(child.stderr).not.toContain('private capability');
    }
  );
  it('does not overwrite a stream failure with success', () => {
    const child = invoke(
      "void runCli(async () => { process.stdout.emit('error', new Error('broken')); return 0; });"
    );
    expect(child.status).toBe(1);
    expect(child.stderr).toBe('');
  });
  it('does not recurse or reject when stderr itself throws', () => {
    const child = invoke(
      'process.stderr.write = () => { throw null; }; void runCli(async () => { throw null; });'
    );
    expect(child.status).toBe(1);
    expect(child.stderr).toBe('');
  });
});
