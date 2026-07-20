const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const archiveArgument = process.argv[2];
if (!archiveArgument) {
  throw new Error('Usage: node scripts/inspect-release-archive.cjs <archive.zip>');
}

const archivePath = path.resolve(process.cwd(), archiveArgument);
if (!fs.statSync(archivePath, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(`Release archive does not exist: ${archiveArgument}`);
}

const listing = childProcess.execFileSync('unzip', ['-Z1', archivePath], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const entries = listing.split(/\r?\n/).filter(Boolean);
if (entries.length === 0) throw new Error('Release archive is empty.');

/**
 * Returns the publication rule violated by an archive entry, if any.
 *
 * @param {string} entry - Raw entry name read without extracting the ZIP.
 * @returns {string | undefined} Failure reason, or undefined when the entry is allowed.
 */
function violationFor(entry) {
  if (entry.includes('\\')) return 'backslash path separator';
  if (entry.startsWith('/') || entry.startsWith('//') || /^[A-Za-z]:\//.test(entry)) {
    return 'absolute path';
  }

  const components = entry.split('/').filter(Boolean);
  if (components.includes('..')) return 'parent traversal';
  if (components.includes('.git')) return '.git metadata';
  if (components.includes('__MACOSX')) return '__MACOSX metadata';
  if (components.includes('.DS_Store')) return '.DS_Store metadata';
  if (components.includes('coverage')) return 'coverage output';
  if (components.includes('node_modules')) return 'dependency directory';
  if (components.includes('.next')) return 'Next.js build output';
  if (components.includes('target')) return 'native build output';
  if (components.some((component) => component.endsWith('.tsbuildinfo'))) {
    return 'TypeScript build metadata';
  }
  if (components.some((component) => /^alerts\.jsonl?$/.test(component))) {
    return 'runtime alert ledger';
  }
  if (
    components.some((component, index) => {
      return component === '.krypton' && ['runtime', 'telemetry'].includes(components[index + 1]);
    })
  ) {
    return 'Krypton runtime capability or telemetry data';
  }
  if (components.some((component) => component.startsWith('unauthorized_breakout_test'))) {
    return 'local breakout-test residue';
  }
  if (/\.zip$/i.test(components.at(-1) ?? '')) return 'nested generated ZIP';

  if (entry.startsWith('sandbox_workspace/')) {
    const allowed = new Set(['sandbox_workspace/', 'sandbox_workspace/.gitkeep']);
    if (!allowed.has(entry)) return 'local sandbox residue';
  }

  return undefined;
}

const violations = entries.flatMap((entry) => {
  const reason = violationFor(entry);
  return reason ? [`${entry} (${reason})`] : [];
});

if (violations.length > 0) {
  throw new Error(`Forbidden release archive entries:\n${violations.join('\n')}`);
}

process.stdout.write(`Release archive inspection passed (${entries.length} entries).\n`);
