const fs = require("node:fs");
const path = require("node:path");

const DASHBOARD_ROOT = path.resolve(process.cwd(), "src/dashboard");
const FORBIDDEN_PATTERNS = [
  [/#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})\b/i, "hardcoded hexadecimal color"],
  [/\b(?:bg|border|fill|ring|shadow|text)-(?:black|white)(?:\b|\/)/, "raw black/white utility"],
  [/\b(?:bg|border|fill|ring|shadow|text)-(?:slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d+/, "generic palette utility"],
  [/\b(?:bg|border|fill|gap|h|m[trblxy]?|p[trblxy]?|ring|rounded|shadow|text|tracking|w)-\[/, "arbitrary visual or layout utility"],
  [/readonly\s+(?:className|style)\??\s*:/, "public raw style prop"],
  [/\bstyle=\{\{/, "inline magic style"],
];

/**
 * Recursively returns TypeScript source files beneath one directory.
 *
 * @param {string} directory - Directory to inspect.
 * @returns {string[]} TypeScript and TSX source paths.
 */
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return [".next", "out"].includes(entry.name) ? [] : sourceFiles(target);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

const failures = [];
for (const file of sourceFiles(DASHBOARD_ROOT)) {
  const contents = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of FORBIDDEN_PATTERNS) {
    if (pattern.test(contents)) failures.push(`${path.relative(process.cwd(), file)}: ${label}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Dashboard token compliance passed.\n");
}
