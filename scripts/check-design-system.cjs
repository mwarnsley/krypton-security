const fs = require("node:fs");
const path = require("node:path");

const PRIMITIVES_ROOT = path.resolve(
  process.cwd(),
  "src/dashboard/components/primitives",
);
const FORBIDDEN_PATTERNS = [
  [/\b(?:bg|border|fill|ring|shadow|text)-(?:black|white)(?:\b|\/)/, "raw black/white utility"],
  [/\b(?:bg|border|fill|ring|shadow|text)-(?:slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d+/, "generic palette utility"],
  [/\b(?:bg|border|fill|ring|rounded|shadow|text|tracking)-\[/, "arbitrary visual utility"],
  [/readonly\s+(?:className|style)\??\s*:/, "public raw style prop"],
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
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

const failures = [];
for (const file of sourceFiles(PRIMITIVES_ROOT)) {
  const contents = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of FORBIDDEN_PATTERNS) {
    if (pattern.test(contents)) failures.push(`${path.relative(process.cwd(), file)}: ${label}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Primitive token compliance passed.\n");
}
