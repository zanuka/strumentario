#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolContracts } from "@strumentario/server";
import { generateContractsSource, GENERATED_PATH } from "./generate.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(packageRoot, GENERATED_PATH);
const args = new Set(process.argv.slice(2));
const source = generateContractsSource(toolContracts);

if (args.has("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== source) {
    console.error(`${GENERATED_PATH} is out of date with the server's tool contracts. Run: pnpm --filter @strumentario/widget generate`);
    process.exit(1);
  }
  console.log(`${GENERATED_PATH} matches the server's tool contracts.`);
} else if (args.has("--dry-run")) {
  process.stdout.write(source);
} else {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
  console.log(`Wrote ${GENERATED_PATH}.`);
}
