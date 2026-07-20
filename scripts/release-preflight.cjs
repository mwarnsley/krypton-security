const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(process.cwd());
const LEGACY_LITERAL_TEST_DIRECTORY = `${'*'.repeat(2)}tests${'*'.repeat(2)}`;
const REQUIRED_DOCUMENTS = [
  'THREAT_MODEL.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/CONTRIBUTION_SECURITY.md',
  'ROADMAP.md',
  'VC.md',
];
const FORBIDDEN_TRACKED = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)__MACOSX\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)target\//,
  /(^|\/)alerts\.jsonl?$/,
  /(^|\/)\.krypton\/(?:runtime|telemetry)\//,
  /\.tsbuildinfo$/,
];
const SECRET_LIKE = /(^|\/)(?:\.env(?!\.example$)|id_(?:rsa|ed25519)|.*\.(?:key|pem|p12))$/i;

/**
 * Executes a bounded repository command and returns trimmed stdout.
 *
 * @param {string} command - Executable name.
 * @param {readonly string[]} args - Exact non-shell arguments.
 * @param {string} [cwd=REPOSITORY_ROOT] - Directory in which to run the command.
 * @param {'pipe' | 'inherit'} [output='pipe'] - Whether stdout is captured or inherited.
 * @returns {string} Trimmed command output when captured, otherwise an empty string.
 */
function run(command, args, cwd = REPOSITORY_ROOT, output = 'pipe') {
  const stdout = output === 'pipe' ? 'pipe' : 'inherit';
  const result = childProcess.execFileSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', stdout, 'inherit'],
  });

  return typeof result === 'string' ? result.trim() : '';
}

/**
 * Fails preflight unless a required repository-relative path exists.
 *
 * @param {string} repositoryPath - Repository-relative path to validate.
 * @returns {void}
 */
function requirePath(repositoryPath) {
  const resolved = path.resolve(REPOSITORY_ROOT, repositoryPath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || !fs.existsSync(resolved)) {
    throw new Error(`Required repository path is missing: ${repositoryPath}`);
  }
}

/**
 * Returns local file targets referenced through Markdown links.
 *
 * @param {string} markdown - README Markdown contents.
 * @returns {string[]} Repository-relative local link targets.
 */
function collectLocalLinks(markdown) {
  const links = [];
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const match of markdown.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (rawTarget === '' || rawTarget.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(rawTarget)) {
      continue;
    }

    const withoutFragment = rawTarget.split(/[?#]/, 1)[0];
    links.push(decodeURIComponent(withoutFragment));
  }

  return links;
}

/**
 * Runs npm's clean installer using only copied manifests in a disposable directory.
 *
 * @returns {void}
 */
function verifyCleanInstall() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'krypton-release-preflight-'));

  try {
    for (const manifest of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(REPOSITORY_ROOT, manifest), path.join(temporaryRoot, manifest));
    }
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], temporaryRoot, 'inherit');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const status = run('git', ['status', '--porcelain']);
if (status !== '') throw new Error('Release preflight requires a clean Git working tree.');

const tracked = run('git', ['ls-files']).split('\n').filter(Boolean);
const trackedSet = new Set(tracked);
const forbidden = tracked.filter((file) => FORBIDDEN_TRACKED.some((pattern) => pattern.test(file)));
if (forbidden.length > 0) {
  throw new Error(`Forbidden generated artifacts are tracked: ${forbidden.join(', ')}`);
}

const secrets = tracked.filter((file) => SECRET_LIKE.test(file));
if (secrets.length > 0) throw new Error(`Secret-like files are tracked: ${secrets.join(', ')}`);

requirePath('LICENSE');
if (!trackedSet.has('LICENSE')) throw new Error('The root LICENSE file must be tracked.');

for (const documentPath of REQUIRED_DOCUMENTS) requirePath(documentPath);
const readme = fs.readFileSync(path.join(REPOSITORY_ROOT, 'README.md'), 'utf8');
for (const linkedPath of collectLocalLinks(readme)) requirePath(linkedPath);
for (const documentPath of REQUIRED_DOCUMENTS) {
  if (!readme.includes(`](${documentPath})`)) {
    throw new Error(`README must link to required documentation: ${documentPath}`);
  }
}

const duplicateRoadmaps = tracked.filter(
  (file) => path.posix.basename(file) === 'ROADMAP.md' && file !== 'ROADMAP.md'
);
if (duplicateRoadmaps.length > 0) {
  throw new Error(`Duplicate ROADMAP.md files are tracked: ${duplicateRoadmaps.join(', ')}`);
}

const ambiguousVcFiles = tracked.filter(
  (file) => path.posix.basename(file) === 'VC.md' && file !== 'VC.md'
);
if (ambiguousVcFiles.length > 0) {
  throw new Error(`Ambiguous VC.md files are tracked: ${ambiguousVcFiles.join(', ')}`);
}

const literalTestPaths = tracked.filter((file) => {
  return file.split('/').includes(LEGACY_LITERAL_TEST_DIRECTORY);
});
if (literalTestPaths.length > 0) {
  throw new Error(
    `Literal ${LEGACY_LITERAL_TEST_DIRECTORY} paths are tracked: ${literalTestPaths.join(', ')}`
  );
}

verifyCleanInstall();
run('npm', ['run', 'verify'], REPOSITORY_ROOT, 'inherit');
process.stdout.write('Release preflight passed.\n');
