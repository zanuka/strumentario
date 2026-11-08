import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { AGENT_HEADER, DEFAULT_HOST, DEFAULT_PORT, JOURNAL_URI, loadConfig, runServer } from "@strumentario/server";

/** Stable process exit codes; documented in the README. */
export const EXIT = {
  ok: 0,
  /** The tool reported an error or the input failed validation. */
  tool: 1,
  /** Bad command line: unknown command or option, missing or malformed input. */
  usage: 2,
  /** The server was unreachable, or rejected the token. */
  connection: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliContext {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Aborting stops `serve`. Other commands ignore it. */
  signal?: AbortSignal;
}

const DEFAULT_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/mcp`;

const HELP = `strumentario — thin MCP client for the Strumentario server

Usage:
  strumentario serve [--stdio]                      Start the Streamable HTTP server, or serve over stdio
  strumentario tools                                List tools and input schemas (from the server)
  strumentario call <tool> [--input '<json>' | --input-file <path>]
                                                    Call a tool; --help after <tool> shows its schema
  strumentario resource <uri>                       Read a resource
  strumentario journal [--since <cursor>] [--limit <n>]
                                                    Read the change journal of mutate calls; pass the printed cursor as --since to continue

Options:
  --url <url>       MCP endpoint (default: $STRUMENTARIO_URL or ${DEFAULT_URL})
  --token <token>   Bearer token (default: $STRUMENTARIO_TOKEN or $MCP_AUTH_TOKEN)
  --agent <id>      Agent identity, sent as the ${AGENT_HEADER} header (default: $STRUMENTARIO_AGENT)
  --json            Machine-readable output only on stdout; diagnostics go to stderr
  --stdio           serve: speak MCP over stdin/stdout instead of HTTP (diagnostics go to stderr)
  --dry-run         serve: print the resolved config and exit. call: set dryRun: true when the tool accepts it, or write: false for scaffold
  -h, --help        Show this help

Exit codes: 0 success, 1 tool or validation error, 2 usage error, 3 connection or auth error.
`;

class UsageError extends Error {}

const OPTIONS = {
  url: { type: "string" },
  token: { type: "string" },
  agent: { type: "string" },
  since: { type: "string" },
  limit: { type: "string" },
  input: { type: "string" },
  "input-file": { type: "string" },
  json: { type: "boolean" },
  stdio: { type: "boolean" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

interface Settings {
  url: string;
  token: string | undefined;
  agent: string | undefined;
  json: boolean;
  dryRun: boolean;
  stdio: boolean;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function runCli(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return usageFailure(ctx, (error as Error).message);
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (values.help && !(command === "call" && rest.length > 0)) {
    ctx.stdout(HELP);
    return EXIT.ok;
  }
  if (command === undefined) {
    ctx.stderr(HELP);
    return EXIT.usage;
  }

  const settings: Settings = {
    url: nonEmpty(values.url) ?? nonEmpty(ctx.env.STRUMENTARIO_URL) ?? DEFAULT_URL,
    token:
      nonEmpty(values.token) ?? nonEmpty(ctx.env.STRUMENTARIO_TOKEN) ?? nonEmpty(ctx.env.MCP_AUTH_TOKEN),
    agent: nonEmpty(values.agent) ?? nonEmpty(ctx.env.STRUMENTARIO_AGENT),
    json: values.json ?? false,
    dryRun: values["dry-run"] ?? false,
    stdio: values.stdio ?? false,
  };

  try {
    switch (command) {
      case "serve":
        expectArgs(command, rest, 0);
        return await serve(ctx, settings);
      case "tools":
        expectArgs(command, rest, 0);
        return await withClient(ctx, settings, (client) => tools(ctx, settings, client));
      case "call": {
        expectArgs(command, rest, 1);
        const [tool] = rest;
        if (tool === undefined) {
          throw new UsageError("call needs a tool name. Run `strumentario tools` to list them.");
        }
        const input = values.help ? {} : await readInput(values.input, values["input-file"]);
        return await withClient(ctx, settings, (client) =>
          values.help ? toolHelp(ctx, settings, client, tool) : call(ctx, settings, client, tool, input),
        );
      }
      case "resource": {
        expectArgs(command, rest, 1);
        const [uri] = rest;
        if (uri === undefined) {
          throw new UsageError("resource needs a URI, for example strumentario://pages/<slug>.");
        }
        return await withClient(ctx, settings, (client) => resource(ctx, settings, client, uri));
      }
      case "journal": {
        expectArgs(command, rest, 0);
        const uri = journalUri(values.since, values.limit);
        return await withClient(ctx, settings, (client) => journal(ctx, settings, client, uri));
      }
      default:
        throw new UsageError(`Unknown command "${command}". Run \`strumentario --help\` for the list.`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return usageFailure(ctx, error.message);
    }
    ctx.stderr(`Unexpected error: ${errorMessage(error)}\n`);
    return EXIT.tool;
  }
}

function usageFailure(ctx: CliContext, message: string): ExitCode {
  ctx.stderr(`${message}\nRun \`strumentario --help\` for usage.\n`);
  return EXIT.usage;
}

function expectArgs(command: string, rest: string[], max: number): void {
  if (rest.length > max) {
    throw new UsageError(`Unexpected argument "${rest[max]}" for ${command}.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readInput(inline: string | undefined, file: string | undefined): Promise<Record<string, unknown>> {
  if (inline !== undefined && file !== undefined) {
    throw new UsageError("Pass either --input or --input-file, not both.");
  }
  let raw = inline;
  if (file !== undefined) {
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      throw new UsageError(`Cannot read --input-file ${file}: ${errorMessage(error)}`);
    }
  }
  if (raw === undefined) {
    return {};
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`Tool input is not valid JSON: ${errorMessage(error)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UsageError("Tool input must be a JSON object, for example --input '{\"slug\":\"intro\"}'.");
  }
  return value as Record<string, unknown>;
}

// --- serve ---------------------------------------------------------------

async function serve(ctx: CliContext, settings: Settings): Promise<ExitCode> {
  if (settings.dryRun) {
    let config;
    try {
      config = loadConfig(ctx.env);
    } catch (error) {
      ctx.stderr(`Invalid configuration: ${errorMessage(error)}\n`);
      return EXIT.usage;
    }
    if (settings.stdio || config.transport === "stdio") {
      const stdioConfig = { transport: "stdio", agent: config.agent ?? null };
      ctx.stdout(settings.json ? `${JSON.stringify(stdioConfig)}\n` : `Would serve MCP over stdio (agent: ${config.agent ?? "none"})\n`);
      return EXIT.ok;
    }
    const resolved = {
      host: config.host,
      port: config.port,
      auth: [config.authToken, config.readToken, config.writeToken].some((token) => token !== undefined),
      url: `http://${config.host}:${config.port}/mcp`,
    };
    ctx.stdout(settings.json ? `${JSON.stringify(resolved)}\n` : `Would listen on ${resolved.url} (auth: ${resolved.auth ? "bearer token" : "none"})\n`);
    return EXIT.ok;
  }

  const code = await runServer({
    env: ctx.env,
    signal: ctx.signal ?? new AbortController().signal,
    stdio: settings.stdio,
    // The server is long-running; its startup lines are diagnostics, not results.
    log: (message) => ctx.stderr(`${message}\n`),
    error: (message) => ctx.stderr(`${message}\n`),
  });
  return code === 0 ? EXIT.ok : code === 2 ? EXIT.usage : EXIT.tool;
}

// --- MCP client commands -------------------------------------------------

async function withClient(
  ctx: CliContext,
  settings: Settings,
  run: (client: Client) => Promise<ExitCode>,
): Promise<ExitCode> {
  const headers: Record<string, string> = {};
  if (settings.token) {
    headers.authorization = `Bearer ${settings.token}`;
  }
  if (settings.agent) {
    headers[AGENT_HEADER] = settings.agent;
  }

  let url: URL;
  try {
    url = new URL(settings.url);
  } catch {
    throw new UsageError(`--url "${settings.url}" is not a valid URL, for example ${DEFAULT_URL}.`);
  }

  const client = new Client({ name: "strumentario-cli", version: "0.0.0" });
  try {
    // The SDK transport types its optional sessionId loosely; this repo compiles with exactOptionalPropertyTypes.
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }) as Transport);
  } catch (error) {
    return connectionFailure(ctx, settings, error);
  }

  try {
    return await run(client);
  } catch (error) {
    if (error instanceof McpError) {
      ctx.stderr(`Server rejected the request: ${error.message}\nRun \`strumentario tools\` to check tool names and input schemas.\n`);
      return EXIT.tool;
    }
    return connectionFailure(ctx, settings, error);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function connectionFailure(ctx: CliContext, settings: Settings, error: unknown): ExitCode {
  const message = errorMessage(error);
  const code = (error as { code?: unknown }).code;
  const unauthorized =
    code === 401 || code === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message);
  const hint = unauthorized
    ? "The server requires a bearer token. Pass --token or set STRUMENTARIO_TOKEN to the server's MCP_AUTH_TOKEN (or MCP_WRITE_TOKEN for writes, MCP_READ_TOKEN for read-only access)."
    : `Is the server running? Start it with \`strumentario serve\`, or point --url / STRUMENTARIO_URL at it.`;
  ctx.stderr(`Cannot reach ${settings.url}: ${message}\n${hint}\n`);
  return EXIT.connection;
}

function emit(ctx: CliContext, settings: Settings, value: unknown): void {
  ctx.stdout(`${JSON.stringify(value, null, settings.json ? undefined : 2)}\n`);
}

async function tools(ctx: CliContext, settings: Settings, client: Client): Promise<ExitCode> {
  const { tools: list } = await client.listTools();
  if (settings.json) {
    emit(ctx, settings, { tools: list });
    return EXIT.ok;
  }
  for (const tool of list) {
    ctx.stdout(`${tool.name}${tool.description ? ` — ${tool.description}` : ""}\n`);
    ctx.stdout(`${indent(JSON.stringify(tool.inputSchema, null, 2))}\n\n`);
  }
  return EXIT.ok;
}

async function toolHelp(ctx: CliContext, settings: Settings, client: Client, name: string): Promise<ExitCode> {
  const { tools: list } = await client.listTools();
  const tool = list.find((candidate) => candidate.name === name);
  if (!tool) {
    ctx.stderr(`Unknown tool "${name}". Available: ${list.map((t) => t.name).join(", ") || "(none)"}.\n`);
    return EXIT.tool;
  }
  if (settings.json) {
    emit(ctx, settings, tool);
  } else {
    ctx.stdout(`${tool.name}${tool.title ? ` — ${tool.title}` : ""}\n${tool.description ?? ""}\n\nInput schema:\n${indent(JSON.stringify(tool.inputSchema, null, 2))}\n`);
  }
  return EXIT.ok;
}

function indent(text: string): string {
  return text.replace(/^/gm, "  ");
}

async function call(
  ctx: CliContext,
  settings: Settings,
  client: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<ExitCode> {
  let args = input;
  if (settings.dryRun) {
    // Generic and schema-driven: a tool that declares dryRun gets it forced on; one that
    // declares write (scaffold) gets it forced off. Either way nothing is written.
    const { tools: list } = await client.listTools();
    const tool = list.find((candidate) => candidate.name === name);
    const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (properties && "dryRun" in properties) {
      args = { ...input, dryRun: true };
    } else if (properties && "write" in properties) {
      args = { ...input, write: false };
    }
  }

  const result = await client.callTool({ name, arguments: args });
  const structured = result.structuredContent;
  emit(ctx, settings, structured ?? result.content);

  if (result.isError) {
    ctx.stderr(`Tool "${name}" reported an error. Check the name with \`strumentario tools\` and the input with \`strumentario call ${name} --help\`.\n`);
    return EXIT.tool;
  }
  if (typeof structured === "object" && structured !== null && (structured as { valid?: unknown }).valid === false) {
    ctx.stderr(`Tool "${name}" reported the input as invalid; see the errors in the output.\n`);
    return EXIT.tool;
  }
  return EXIT.ok;
}

function journalUri(since: string | undefined, limit: string | undefined): string {
  const params: string[] = [];
  if (since !== undefined) {
    if (!/^\d+$/.test(since)) {
      throw new UsageError(`--since "${since}" is not a journal cursor. Use the cursor printed by a previous \`strumentario journal\`.`);
    }
    params.push(`since=${since}`);
  }
  if (limit !== undefined) {
    if (!/^\d+$/.test(limit) || Number(limit) < 1) {
      throw new UsageError(`--limit "${limit}" must be a positive integer.`);
    }
    params.push(`limit=${limit}`);
  }
  return params.length > 0 ? `${JOURNAL_URI}?${params.join("&")}` : JOURNAL_URI;
}

async function journal(ctx: CliContext, settings: Settings, client: Client, uri: string): Promise<ExitCode> {
  const result = await client.readResource({ uri });
  const item = result.contents[0];
  if (!item || !("text" in item)) {
    ctx.stderr(`The server returned no journal at ${uri}. Check that it is a Strumentario server with the default file store.\n`);
    return EXIT.tool;
  }
  emit(ctx, settings, JSON.parse(item.text));
  return EXIT.ok;
}

async function resource(ctx: CliContext, settings: Settings, client: Client, uri: string): Promise<ExitCode> {
  const result = await client.readResource({ uri });
  if (settings.json) {
    emit(ctx, settings, result);
    return EXIT.ok;
  }
  for (const item of result.contents) {
    ctx.stdout(`${"text" in item ? item.text : `(binary ${item.mimeType ?? "data"}, ${item.blob.length} base64 chars; use --json)`}\n`);
  }
  return EXIT.ok;
}
