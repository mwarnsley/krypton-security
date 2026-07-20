const childProcess = require("node:child_process");
const path = require("node:path");

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
 * @returns {string} Trimmed command output.
 */
function run(command, args) {
  return childProcess.execFileSync(command, [...args], {
    cwd: path.resolve(process.cwd()),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

const status = run("git", ["status", "--porcelain"]);
if (status !== "") throw new Error("Release preflight requires a clean Git working tree.");
const tracked = run("git", ["ls-files"]).split("\n").filter(Boolean);
const forbidden = tracked.filter((file) => FORBIDDEN_TRACKED.some((pattern) => pattern.test(file)));
if (forbidden.length > 0) throw new Error(`Forbidden generated artifacts are tracked: ${forbidden.join(", ")}`);
const secrets = tracked.filter((file) => SECRET_LIKE.test(file));
if (secrets.length > 0) throw new Error(`Secret-like files are tracked: ${secrets.join(", ")}`);
childProcess.execFileSync("npm", ["run", "verify"], { cwd: process.cwd(), stdio: "inherit" });
process.stdout.write("Release preflight passed.\n");
