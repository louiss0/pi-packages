/**
 * typecheck.mjs — Run `tsc --noEmit` and fail on our diagnostics only.
 *
 * TypeScript type-checks every file in the program, and the program includes
 * whatever an import reaches. `@juanibiapina/pi-extension-settings` ships raw
 * `.ts` sources — no `.d.ts`, a single `"."` export — so those sources are
 * compiled as part of ours, and `skipLibCheck` (which covers declaration files
 * only) does not reach them. Twelve diagnostics inside it are not ours to fix
 * and not ours to be blocked by.
 *
 * So this script partitions what `tsc` reports: a diagnostic is a failure when
 * it names a file in this package, and a note when it names a file in
 * `node_modules`. Third-party diagnostics are still printed, so a dependency
 * that grows new ones is visible here rather than silently absorbed.
 *
 * Usage: `node scripts/typecheck.mjs [tsconfig.json ...]`
 * Exits 1 on the first config with an error of ours; 0 otherwise.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const packageRoot = resolve(import.meta.dirname, "..");
const configs =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["tsconfig.json", "tsconfig.spec.json"];

/** A `tsc` diagnostic header: a path, a position, a code, and a message. */
const HEADER = /^\S.*\(\d+,\d+\): error TS\d+:/;

/**
 * True when `line` reports a diagnostic in a file under node_modules.
 *
 * `tsc` prints paths with forward slashes on every platform, so both
 * separators are tested rather than the host's `sep`.
 */
function isThirdParty(line) {
  return line.includes("/node_modules/") || line.includes("\\node_modules\\");
}

/**
 * Group `tsc` output into diagnostics: a header line names a file and a
 * code, and the indented lines after it are that diagnostic's detail.
 *
 * The grouping is what lets a detail line be judged by the file it belongs
 * to — an indented continuation never repeats the path, so classifying line by
 * line would file every third-party explanation under us. Lines that precede
 * the first header are dropped: they are tsc's banner, not diagnostics.
 */
function groupDiagnostics(lines) {
  const groups = [];
  let current;
  for (const line of lines) {
    if (HEADER.test(line)) {
      current = [line];
      groups.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return groups;
}

/** The `name@version` a diagnostic's path points into, pnpm store layout included. */
function packageNameOf(header) {
  // pnpm lays a package out as `node_modules/.pnpm/<name>@<version>/node_modules/<name>/…`;
  // the segment after the LAST node_modules is the package we would name.
  const segments = header.split(/[/\\]/);
  const last = segments.lastIndexOf("node_modules");
  return segments.slice(last + 1, last + 3).join("/");
}

let failed = false;

for (const config of configs) {
  const result = spawnSync(
    "npx",
    ["tsc", "-p", config, "--noEmit", "--pretty", "false"],
    { cwd: packageRoot, encoding: "utf8", shell: true },
  );

  if (result.error) {
    console.error(`typecheck: could not run tsc for ${config}`);
    console.error(result.error.message);
    process.exit(1);
  }

  const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const groups = groupDiagnostics(lines);

  if (result.status === 0) {
    console.log(`typecheck: ${config} — clean`);
    continue;
  }

  const ours = groups.filter((g) => !isThirdParty(g[0]));
  const theirs = groups.filter((g) => isThirdParty(g[0]));

  if (groups.length === 0) {
    // tsc failed without a diagnostic we can read: a config error, or a crash.
    failed = true;
    console.error(`typecheck: ${config} — tsc exited ${result.status}\n`);
    console.error(lines.join("\n"));
  }

  if (ours.length > 0) {
    failed = true;
    console.error(`typecheck: ${config} — ${ours.length} error(s)\n`);
    for (const group of ours) console.error(group.join("\n"));
  }

  if (theirs.length > 0) {
    const packages = new Set(theirs.map((group) => packageNameOf(group[0])));
    console.warn(
      `typecheck: ${config} — ignoring ${theirs.length} error(s) in ${[...packages].join(", ")} (third-party sources in our program)`,
    );
  }
}

process.exit(failed ? 1 : 0);
