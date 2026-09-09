import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createZip, ZipError, type ZipEntry } from '../../src/packaging/zip.cjs';

const entry = (name: string, size = 0): ZipEntry => ({ name, data: Buffer.alloc(size) });

describe('bounded deterministic ZIP writer', () => {
  it('produces identical bytes regardless of caller order without mutating input', () => {
    const entries = Object.freeze([entry('z.txt'), entry('A.txt'), entry('a/b.txt')]);
    expect(createZip(entries)).toEqual(createZip([...entries].reverse()));
    expect(entries.map(({ name }) => name)).toEqual(['z.txt', 'A.txt', 'a/b.txt']);
  });

  it('produces an interoperable archive with exact data and portable deterministic metadata', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'krypton-zip-'));
    try {
      const archive = path.join(directory, 'test.zip');
      await writeFile(
        archive,
        createZip([
          { name: 'z/é.txt', data: Buffer.from('123456789') },
          { name: 'empty.txt', data: Buffer.alloc(0) },
          { name: 'A.bin', data: Buffer.from([0, 255, 128]) },
        ])
      );
      const result = spawnSync(
        'python3',
        [
          '-c',
          [
            'import json, sys, zipfile',
            'with zipfile.ZipFile(sys.argv[1]) as archive:',
            ' assert archive.testzip() is None',
            ' print(json.dumps([{"name": i.filename, "data": archive.read(i).hex(), "crc": i.CRC, "time": i.date_time, "method": i.compress_type, "flags": i.flag_bits, "system": i.create_system, "mode": i.external_attr >> 16} for i in archive.infolist()]))',
          ].join('\n'),
          archive,
        ],
        { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 }
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        {
          name: 'A.bin',
          data: '00ff80',
          crc: 0x81dda740,
          time: [1980, 1, 1, 0, 0, 0],
          method: 0,
          flags: 2048,
          system: 3,
          mode: 0o100644,
        },
        {
          name: 'empty.txt',
          data: '',
          crc: 0,
          time: [1980, 1, 1, 0, 0, 0],
          method: 0,
          flags: 2048,
          system: 3,
          mode: 0o100644,
        },
        {
          name: 'z/é.txt',
          data: '313233343536373839',
          crc: 0xcbf43926,
          time: [1980, 1, 1, 0, 0, 0],
          method: 0,
          flags: 2048,
          system: 3,
          mode: 0o100644,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('encodes an empty archive as a valid empty end record', () => {
    expect(createZip([]).toString('hex')).toBe('504b0506000000000000000000000000000000000000');
  });

  it.each([
    '',
    '/root',
    '../file',
    'a/../b',
    './file',
    'a/./b',
    'a//b',
    'a/',
    'C:/file',
    'a\\b',
    'x\0y',
    'x\ny',
    'a:stream',
    'a?',
    'a*',
    'a<',
    'a>',
    'a|',
    'a"',
    'a.',
    'a ',
    'CON',
    'aux.txt',
    'a/LPT1',
    '\ud800',
  ])('rejects unsafe entry names: %j', (name) => {
    expect(() => createZip([entry(name)])).toThrowError(ZipError);
    expect(() => createZip([entry(name)])).toThrowError(
      expect.objectContaining({ code: 'invalid_entry' })
    );
  });

  it.each([
    ['file', 'file'],
    ['FILE', 'file'],
    ['é', 'e\u0301'],
    ['a', 'a/b'],
    ['a/b', 'A'],
  ])('rejects colliding extraction paths %s and %s', (first, second) => {
    expect(() => createZip([entry(first), entry(second)])).toThrowError(
      expect.objectContaining({ code: 'invalid_entry' })
    );
  });

  it.each([null, {}, [null], [{ name: 'a', data: 'text' }], [{ name: 1, data: Buffer.alloc(0) }]])(
    'rejects malformed runtime inputs',
    (value) => {
      expect(() => createZip(value as unknown as ZipEntry[])).toThrowError(
        expect.objectContaining({ code: 'invalid_entry' })
      );
    }
  );

  it.each([2047, 2048])('accepts %i entries within the entry count bound', (count) => {
    expect(
      createZip(Array.from({ length: count }, (_, index) => entry(`${index}`))).length
    ).toBeGreaterThan(22);
  });

  it('redacts unexpected entry access failures', () => {
    const broken = {
      get name(): string {
        throw new Error('private input contents');
      },
      data: Buffer.alloc(0),
    };
    expect(() => createZip([broken])).toThrowError(
      expect.objectContaining({
        code: 'invalid_entry',
        message: 'ZIP entry validation failed.',
      })
    );
  });

  it('converts allocation failures to a bounded size-limit error', () => {
    const entries = [entry('file')];
    const allocation = vi.spyOn(Buffer, 'alloc').mockImplementationOnce(() => {
      throw new RangeError('private allocation details');
    });
    try {
      expect(() => createZip(entries)).toThrowError(
        expect.objectContaining({
          code: 'size_limit',
          message: 'ZIP resource limit exceeded.',
        })
      );
    } finally {
      allocation.mockRestore();
    }
  });

  it('rejects more than 2048 entries', () => {
    expect(() =>
      createZip(Array.from({ length: 2049 }, (_, index) => entry(`${index}`)))
    ).toThrowError(expect.objectContaining({ code: 'size_limit' }));
  });

  it.each([1023, 1024])('accepts a %i-byte entry name', (length) => {
    expect(createZip([entry('a'.repeat(length))]).length).toBe(98 + length * 2);
  });

  it.each(['a'.repeat(1025), 'é'.repeat(513)])(
    'bounds filename bytes before serialization',
    (name) => {
      expect(() => createZip([entry(name)])).toThrowError(
        expect.objectContaining({ code: 'size_limit' })
      );
    }
  );

  it.each([1048575, 1048576])('accepts a %i-byte file', (length) => {
    expect(createZip([entry('a', length)]).length).toBe(length + 100);
  });

  it('rejects a file above 1 MiB', () => {
    expect(() => createZip([entry('a', 1048577)])).toThrowError(
      expect.objectContaining({ code: 'size_limit' })
    );
  });

  it.each([1048575, 1048576])(
    'accepts the total payload immediately below or at 16 MiB: last file %i',
    (last) => {
      const entries = Array.from({ length: 15 }, (_, index) => entry(`${index}`, 1048576));
      entries.push(entry('last', last));
      expect(createZip(entries).length).toBeGreaterThan(15 * 1048576 + last);
    }
  );

  it('rejects total payload above 16 MiB', () => {
    const entries = Array.from({ length: 16 }, (_, index) => entry(`${index}`, 1048576));
    entries.push(entry('last', 1));
    expect(() => createZip(entries)).toThrowError(expect.objectContaining({ code: 'size_limit' }));
  });
});
