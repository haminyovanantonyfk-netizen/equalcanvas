import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  "work",
  "coverage",
]);
async function walk(dir = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (ignored.has(entry.name)) continue;
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(name)));
    else files.push(name);
  }
  return files;
}
const files = await walk();
const problems = [];
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "GitHub credential",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,})\b/,
  ],
  ["cloud access ID", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["API credential", /\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}\b/],
  [
    "credential assignment",
    /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{16,}["']/i,
  ],
  ["personal Windows path", /[A-Z]:[\\/]Users[\\/][^\s"'<>]+/i],
  ["personal Unix path", /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//],
];
for (const file of files) {
  if (/^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(path.basename(file)))
    problems.push(`${file}: credential-like filename`);
  if (/\.(png|jpg|ico|woff2?)$/i.test(file)) continue;
  const content = await readFile(path.join(root, file), "utf8");
  for (const [label, pattern] of rules)
    if (pattern.test(content))
      problems.push(`${file}: ${label} detected (value redacted)`);
  if (file.startsWith("app" + path.sep) && /\.(js|html)$/.test(file)) {
    if (
      /\b(?:eval|Function)\s*\(/.test(content) ||
      /\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(/.test(content)
    )
      problems.push(`${file}: unsafe executable/HTML sink`);
    if (
      /https?:\/\//.test(content.replaceAll("http://www.w3.org/2000/svg", ""))
    )
      problems.push(`${file}: external URL in runtime code`);
  }
  if (file.endsWith(".js") || file.endsWith(".mjs"))
    execFileSync(process.execPath, ["--check", path.join(root, file)], {
      stdio: "pipe",
    });
}
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (Object.keys(pkg.dependencies || {}).length)
  problems.push("Unexpected production dependency");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${files.length} source files: syntax and repository safety checks passed. No matching secrets or personal paths found.`,
  );
