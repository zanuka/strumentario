import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, defineDomain, buildToolContracts, handbookDomain, toolContracts, FileSystemPageStore } from "@strumentario/server";
import { describe, expect, it } from "vitest";
import { generateContractsSource, GENERATED_PATH, schemaToType, WIDGET_TOOL_NAMES } from "./generate.js";
import { KEY_FIELD, PAGE_FIELDS, WIDGET_TOOLS } from "./generated/contracts.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("generated widget contracts (drift)", () => {
  it("the checked-in file is exactly what the server's contracts generate", async () => {
    const checkedIn = await readFile(path.join(packageRoot, GENERATED_PATH), "utf8");
    expect(
      checkedIn,
      "Out of date: run `pnpm --filter @strumentario/widget generate` and commit the result",
    ).toBe(generateContractsSource(toolContracts));
  });

  it("covers the query, validate and mutate tools the server really publishes over tools/list", async () => {
    const server = createMcpServer({ store: new FileSystemPageStore("/nonexistent-never-written") });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "drift", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const published = new Map(tools.map((tool) => [tool.name, tool]));
      expect([...WIDGET_TOOLS].sort()).toEqual([...WIDGET_TOOL_NAMES].sort());
      for (const name of WIDGET_TOOLS) {
        expect(published.has(name), `server does not publish ${name}`).toBe(true);
      }
      // The field list the editor renders is the one in the stored page the server returns.
      const query = published.get("query");
      const outputProperties = (query?.outputSchema as { properties: Record<string, { properties?: Record<string, unknown> }> }).properties;
      const storedFields = Object.keys(outputProperties["page"]?.properties ?? {}).filter((name) => name !== "revision");
      expect(PAGE_FIELDS.map((field) => field.name)).toEqual(storedFields);
      expect(KEY_FIELD).toBe(handbookDomain.keyField);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("a field added to the domain flows into the generated types and the field list", () => {
    const extended = defineDomain({
      ...handbookDomain,
      fields: [...handbookDomain.fields, { name: "summary", kind: "string", trim: true, minLength: 1, minLengthMessage: "must be a non-empty string" }],
    });
    const source = generateContractsSource(buildToolContracts(extended));
    expect(source).toContain("summary: string;");
    expect(source).toContain('{ name: "summary", required: true');
    expect(source).not.toBe(generateContractsSource(toolContracts));
  });

  it("fails with an actionable message when a contract is missing", () => {
    expect(() => generateContractsSource(toolContracts.filter((contract) => contract.name !== "validate"))).toThrow(/No "validate" tool contract/);
  });
});

describe("schemaToType", () => {
  it("renders optional and required properties, enums, arrays and open values", () => {
    const type = schemaToType({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "array", items: { type: "string", enum: ["x", "y"] } },
        c: { description: "open" },
      },
      required: ["a"],
    });
    expect(type).toContain("a: string;");
    expect(type).toContain('b?: Array<"x" | "y">;');
    expect(type).toContain("c?: unknown;");
  });
});
