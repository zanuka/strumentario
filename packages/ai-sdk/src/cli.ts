#!/usr/bin/env node
import { connectMcpClient } from "./connect.js";
import { selectModel } from "./model.js";
import { runWorkflow } from "./workflow.js";

const HELP = `strumentario-ai: run query, then validate, then mutate (dry run) through the Vercel AI SDK, calling a running Strumentario MCP server.

Usage: strumentario-ai [--url <mcp-url>] [--slug <slug>] [--write]

  --url    MCP endpoint (default: STRUMENTARIO_MCP_URL or http://127.0.0.1:3001/mcp)
  --slug   page to work on (default: intro)
  --write  let mutate write. Without it every mutate call is forced to dryRun: true.

Needs ANTHROPIC_API_KEY or OPENAI_API_KEY; without one it prints how to set it and exits 0.
Start the server first: pnpm --filter @strumentario/server serve
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    process.stderr.write(`${name} needs a value.\n`);
    process.exit(1);
  }
  return value;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  const selection = selectModel();
  if (!selection.ok) {
    process.stdout.write(`${selection.message}\n`);
  } else {
    try {
      const url = flag(args, "--url");
      const slug = flag(args, "--slug");
      const client = await connectMcpClient(url ? { url } : {});
      try {
        process.stdout.write(`model: ${selection.label}\n\n`);
        const { calls } = await runWorkflow({
          client,
          model: selection.model,
          ...(slug ? { slug } : {}),
          write: args.includes("--write"),
          onText: (delta) => process.stdout.write(delta),
        });
        process.stdout.write("\n\ntool calls over MCP:\n");
        for (const call of calls) process.stdout.write(`  ${call.isError ? "ERR" : "ok "} ${call.tool} ${JSON.stringify(call.arguments)}\n`);
      } finally {
        await client.close().catch(() => undefined);
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
