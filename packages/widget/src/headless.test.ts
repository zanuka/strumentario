import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { runCli } from "@strumentario/cli";
import { createMcpHttpServer, shutdownHttpServer } from "@strumentario/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWidgetController, mcpToolCaller } from "./controller.js";

let dir: string;
let server: Server;
let url: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "strumentario-widget-headless-"));
  process.env["STRUMENTARIO_DATA_DIR"] = dir;
  server = createMcpHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  client = new Client({ name: "widget-headless-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)) as Transport);
});

afterEach(async () => {
  delete process.env["STRUMENTARIO_DATA_DIR"];
  await client.close().catch(() => undefined);
  await shutdownHttpServer(server);
  await rm(dir, { recursive: true, force: true });
});

async function cli(tool: string, input: unknown, expectedCode = 0): Promise<unknown> {
  let stdout = "";
  const code = await runCli(["call", tool, "--json", "--url", url, "--input", JSON.stringify(input)], {
    env: {},
    stdout: (text) => (stdout += text),
    stderr: () => undefined,
  });
  expect(code, stdout).toBe(expectedCode);
  return JSON.parse(stdout);
}

describe("the same tools work headless from the CLI", () => {
  it("the CLI sees what the widget saves, and the widget sees what the CLI saves, over the same HTTP server", async () => {
    const widget = createWidgetController({ caller: mcpToolCaller(client), validateDelayMs: 0 });

    // CLI creates, widget lists and edits.
    await cli("mutate", { action: "create", slug: "from-cli", page: { title: "From CLI", slug: "from-cli", body: "Written headless." }, dryRun: false });
    await widget.refresh();
    expect(widget.getState().list.pages.map((page) => page.slug)).toEqual(["from-cli"]);
    await widget.open("from-cli");
    widget.edit("body", "Edited in the widget.");
    await widget.idle();
    await widget.requestPreview();
    await widget.confirmSave();
    expect(widget.getState().save.state).toBe("saved");

    // CLI reads the widget's write back through query.
    const read = (await cli("query", { slug: "from-cli" })) as { structuredContent?: { page?: { body: string } }; page?: { body: string } };
    const page = read.structuredContent?.page ?? read.page;
    expect(page?.body).toBe("Edited in the widget.");

    // The validate verdict is the same from both surfaces.
    const draft = { title: "", slug: "from-cli", body: "x" };
    const viaCli = (await cli("validate", { instance: draft }, 1)) as { structuredContent?: unknown };
    const viaWidget = await mcpToolCaller(client).call("validate", { instance: draft });
    expect(viaWidget.valid).toBe(false);
    // The CLI exits 1 on an invalid draft and prints the same verdict the widget shows.
    expect(viaCli.structuredContent ?? viaCli).toEqual(viaWidget);
  });
});
