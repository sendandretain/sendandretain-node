#!/usr/bin/env node
/**
 * Fails if `src/schema.d.ts` is stale relative to the committed `openapi.json`.
 *
 * The SDK regenerates its types from its OWN copy of the spec, so this repo
 * never reaches into a private source tree. Refreshing the API surface is a
 * two-step, reviewable change: drop in a new `openapi.json`, run `npm run gen`,
 * commit both. This script is what makes forgetting the second half loud.
 *
 * `openapi-typescript` is pinned exactly (not `^`) in devDependencies because
 * its output varies across versions — an unpinned range would turn a routine
 * `npm install` into phantom drift.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC_PATH = join(ROOT, "openapi.json");
const SCHEMA_PATH = join(ROOT, "src", "schema.d.ts");

/** Strip trailing whitespace and collapse blank-line runs so the comparison
 *  ignores cosmetic variance rather than reporting it as drift. */
function normalize(source) {
  return source
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "sendandretain-sdk-"));
  const tmpFile = join(dir, "schema.d.ts");

  let generated;
  try {
    await execFileAsync(
      process.execPath,
      [join(ROOT, "node_modules", "openapi-typescript", "bin", "cli.js"), SPEC_PATH, "-o", tmpFile],
      { cwd: ROOT, encoding: "utf8" }
    );
    generated = await readFile(tmpFile, "utf8");
  } catch (err) {
    console.error("openapi-typescript failed. Did you run `npm install`?");
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  let onDisk;
  try {
    onDisk = await readFile(SCHEMA_PATH, "utf8");
  } catch {
    console.error(`Could not read ${SCHEMA_PATH}. Run \`npm run gen\` to create it.`);
    process.exit(2);
  }

  if (normalize(generated) === normalize(onDisk)) {
    console.log("schema.sync OK — src/schema.d.ts matches openapi.json.");
    return;
  }

  console.error("schema.sync DRIFT — src/schema.d.ts is stale.");
  console.error("Fix: run `npm run gen` and commit the result.");
  process.exit(1);
}

await main();
