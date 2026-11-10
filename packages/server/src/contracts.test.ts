import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildToolContracts, toolContracts, type ToolContract } from "./contracts.js";
import { defineDomain } from "./domain.js";
import { HANDBOOK_PAGE_SCHEMA_URI, handbookDomain, handbookPageJsonSchema } from "./schema.js";
import { createMcpServer } from "./server.js";
import type { PageStore } from "./store.js";

const emptyStore = { list: async () => [], get: async () => undefined } as unknown as PageStore;

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

async function connect() {
  const server = createMcpServer({ store: emptyStore });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "drift-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** Human-readable differences between what a server lists and what the contracts say. */
function findContractDrift(
  listed: readonly ListedTool[],
  contracts: readonly ToolContract[],
): string[] {
  const drift: string[] = [];
  for (const contract of contracts) {
    const tool = listed.find((candidate) => candidate.name === contract.name);
    if (!tool) {
      drift.push(`${contract.name}: contract has no registered tool`);
      continue;
    }
    const pairs: Array<[string, unknown, unknown]> = [
      ["title", tool.title, contract.title],
      ["description", tool.description, contract.description],
      ["annotations", tool.annotations, contract.annotations],
      ["inputSchema", tool.inputSchema, contract.inputSchema],
      ["outputSchema", tool.outputSchema, contract.outputSchema],
    ];
    for (const [field, actual, expected] of pairs) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        drift.push(`${contract.name}.${field} differs from the generated contract`);
      }
    }
  }
  for (const tool of listed) {
    if (!contracts.some((contract) => contract.name === tool.name)) {
      drift.push(`${tool.name}: registered tool has no generated contract`);
    }
  }
  return drift;
}

// JSON.stringify comparison above is key-order sensitive; normalise both sides first.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, canonical(inner)]),
    );
  }
  return value;
}

function listedTools(tools: ListedTool[]): ListedTool[] {
  return tools.map((tool) => canonical(tool) as ListedTool);
}

function canonicalContracts(contracts: readonly ToolContract[]): ToolContract[] {
  return contracts.map((contract) => canonical(contract) as ToolContract);
}

describe("tool contracts", () => {
  it("covers exactly the primitives the handbook domain declares, with stable names", () => {
    expect(toolContracts.map((tool) => tool.name)).toEqual(["query", "mutate", "validate", "scaffold", "repair"]);
    expect(handbookDomain.primitives).toEqual(["query", "mutate", "validate", "scaffold", "repair"]);
  });

  it("matches every tool the MCP server registers (drift test)", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(findContractDrift(listedTools(tools as ListedTool[]), canonicalContracts(toolContracts))).toEqual([]);
  });

  it("fails when a registered tool's schema is changed by hand", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tampered = (tools as ListedTool[]).map((tool) =>
      tool.name === "query"
        ? {
            ...tool,
            inputSchema: {
              ...tool.inputSchema,
              properties: {
                ...(tool.inputSchema["properties"] as Record<string, unknown>),
                sneaky: { type: "string" },
              },
            },
          }
        : tool,
    );

    expect(findContractDrift(listedTools(tampered), canonicalContracts(toolContracts))).toEqual([
      "query.inputSchema differs from the generated contract",
    ]);
  });

  it("fails when a tool is added or removed without a contract", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const listed = tools as ListedTool[];

    expect(
      findContractDrift(listedTools([...listed, { ...listed[0]!, name: "extra" }]), canonicalContracts(toolContracts)),
    ).toEqual(["extra: registered tool has no generated contract"]);
    expect(
      findContractDrift(listedTools(listed.slice(1)), canonicalContracts(toolContracts)),
    ).toEqual([`${listed[0]!.name}: contract has no registered tool`]);
  });

  it("serves the resource JSON Schema generated from the same domain", async () => {
    const client = await connect();
    const result = await client.readResource({ uri: HANDBOOK_PAGE_SCHEMA_URI });
    const text = (result.contents[0] as { text: string }).text;

    expect(JSON.parse(text)).toEqual(handbookPageJsonSchema);
    expect(handbookPageJsonSchema).toMatchObject({
      required: ["title", "slug", "body"],
      additionalProperties: false,
    });
  });
});

describe("one definition drives every surface", () => {
  const extended = defineDomain({
    ...handbookDomain,
    fields: [
      ...handbookDomain.fields,
      { name: "summary", kind: "string", trim: true, minLength: 1 },
    ],
  });

  it("a field added to the definition shows up in the tool contracts with no other edit", () => {
    const contracts = buildToolContracts(extended);
    const query = contracts.find((tool) => tool.name === "query")!;
    const mutate = contracts.find((tool) => tool.name === "mutate")!;
    const stored = (query.outputSchema["properties"] as Record<string, any>)["page"];

    expect(Object.keys(stored.properties)).toEqual(["title", "slug", "body", "summary", "revision"]);
    expect(stored.required).toContain("summary");
    expect((mutate.inputSchema["properties"] as Record<string, any>)["page"].description).toContain(
      "{ title, slug, body, summary }",
    );
    expect(buildToolContracts(handbookDomain)).toEqual(toolContracts);
  });

  it("rejects a key field that is not declared", () => {
    expect(() => defineDomain({ ...handbookDomain, keyField: "missing" })).toThrow(/keyField "missing"/);
  });
});
