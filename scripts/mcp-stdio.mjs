#!/usr/bin/env node
// Launcher the host MCP configs (.mcp.json, .cursor/mcp.json, .codex/config.toml) point at.
// It lives in the repo, so a relative or workspace-rooted path works from any clone, and it
// turns an unbuilt checkout into an actionable message instead of a bare module-not-found.
// stdout carries only MCP protocol messages, so every diagnostic here goes to stderr.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "packages/server/dist/serve.js");

if (!existsSync(entry)) {
  console.error(`Strumentario server is not built (missing ${entry}). Run \`pnpm install && pnpm build\` in ${root}, then restart or reconnect the host.`);
  process.exit(1);
}

if (!process.argv.includes("--stdio")) process.argv.push("--stdio");
await import(pathToFileURL(entry).href);
