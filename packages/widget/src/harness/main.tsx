import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createRoot } from "react-dom/client";
import { mcpToolCaller } from "../controller.js";
import { PageWidget } from "../react/index.js";

/** Local harness: the widget talks to the Strumentario server over Streamable HTTP, exactly as a host's MCP client would. */
const client = new Client({ name: "strumentario-widget-harness", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)) as Transport);

const { tools } = await client.listTools();
const label = document.getElementById("tools");
if (label) label.textContent = `Connected over MCP. Server tools: ${tools.map((tool) => tool.name).join(", ")}`;

const root = document.getElementById("root");
if (root) createRoot(root).render(<PageWidget caller={mcpToolCaller(client)} />);
