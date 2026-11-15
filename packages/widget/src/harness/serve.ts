#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DATA_DIR_ENV, FileSystemPageStore, handleMcpHttpRequest, MCP_HTTP_PATH, mutatePage } from "@strumentario/server";

/**
 * Local MCP Apps-style harness: serves the React widget and the Strumentario MCP endpoint from one
 * origin, over a throwaway file store seeded with two pages. Not a host: no ui:// resource, no
 * postMessage bridge. It exists so the widget's real MCP calls can be exercised in a browser.
 *
 * Usage: pnpm --filter @strumentario/widget harness [--port 3002] [--data-dir <dir>]
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const port = Number(option("--port") ?? 3002);
const given = option("--data-dir");
const dataDir = given ?? (await mkdtemp(path.join(tmpdir(), "strumentario-widget-harness-")));
// The server reads its store location from the environment, so point it at the throwaway dir.
process.env[DATA_DIR_ENV] = dataDir;
const store = new FileSystemPageStore(dataDir);

for (const page of [
  { title: "Getting started", slug: "getting-started", body: "Install the toolkit and run the server." },
  { title: "Style guide", slug: "style-guide", body: "Write short sentences." },
]) {
  await mutatePage(store, { action: "create", slug: page.slug, page, dryRun: false, overwrite: true });
}

const bundle = await build({
  entryPoints: [path.join(packageRoot, "src/harness/main.tsx")],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const script = bundle.outputFiles[0]?.text ?? "";

const css = `
  body { font: 15px/1.45 system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1b1f24; }
  main { max-width: 980px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; } #tools { color: #57606a; margin: 0 0 16px; font-size: 13px; }
  .sw-root { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
  .sw-list, .sw-editor, .sw-empty { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; }
  h2 { font-size: 15px; margin: 0 0 8px; } ul { list-style: none; padding: 0; margin: 0; }
  .sw-list li button { width: 100%; text-align: left; margin: 2px 0; } .sw-list li button[aria-current="true"] { border-color: #0969da; }
  button { font: inherit; padding: 4px 10px; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  input, textarea { font: inherit; width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid #d0d7de; border-radius: 6px; }
  .sw-field { margin: 8px 0; } .sw-field label { display: block; font-weight: 600; font-size: 13px; }
  .sw-validation { margin: 8px 0; font-size: 13px; } .sw-validation li { color: #cf222e; }
  .sw-actions { display: flex; gap: 8px; margin: 8px 0; } .sw-preview table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .sw-preview th, .sw-preview td { border-top: 1px solid #d0d7de; padding: 4px 6px; text-align: left; vertical-align: top; }
  .sw-preview tr[data-changed="true"] td:last-child { background: #dafbe1; } [role="alert"] { color: #cf222e; }
  @media (max-width: 700px) { .sw-root { grid-template-columns: 1fr; } }
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strumentario widget harness</title><style>${css}</style></head><body><main><h1>Strumentario pages (React widget)</h1><p id="tools">Connecting…</p><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`;

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === MCP_HTTP_PATH || pathname === "/healthz") {
    void handleMcpHttpRequest(request, response);
  } else if (pathname === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript" }).end(script);
  } else if (pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(html);
  } else {
    response.writeHead(404).end("Not found");
  }
});

await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
console.log(`Widget harness: http://127.0.0.1:${(server.address() as AddressInfo).port}/  (MCP at ${MCP_HTTP_PATH}, data in ${dataDir})`);

const stop = async () => {
  server.close();
  if (given === undefined) await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
