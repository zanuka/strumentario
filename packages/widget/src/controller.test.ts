import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDraft, mcpToolCaller, type ToolCaller } from "./controller.js";
import { seed, startRig, type Rig } from "./test-support.js";

let rig: Rig;
beforeEach(async () => {
  rig = await startRig();
  await seed(rig);
});
afterEach(async () => {
  await rig.close();
});

describe("list", () => {
  it("lists pages through the query tool and filters by text", async () => {
    const widget = rig.controller();
    await widget.refresh();
    expect(widget.getState().list.pages.map((page) => page.slug).sort()).toEqual(["getting-started", "style-guide"]);
    expect(rig.calls[0]).toEqual({ name: "query", arguments: {} });

    await widget.refresh("style");
    expect(widget.getState().list.pages.map((page) => page.slug)).toEqual(["style-guide"]);
    expect(widget.getState().list.total).toBe(1);
    expect(rig.calls[1]).toEqual({ name: "query", arguments: { text: "style" } });
  });

  it("reports a failed list as a message, not a silent empty list", async () => {
    const broken: ToolCaller = { call: async () => Promise.reject(new Error("connection refused")) };
    const { createWidgetController } = await import("./controller.js");
    const widget = createWidgetController({ caller: broken });
    await widget.refresh();
    expect(widget.getState().list).toMatchObject({ state: "failed", message: "connection refused" });
  });
});

describe("edit with live validation", () => {
  it("opens a page at its current revision and validates it", async () => {
    const widget = rig.controller();
    await widget.open("getting-started");
    const state = widget.getState();
    expect(state.mode).toBe("edit");
    expect(state.base?.revision).toMatch(/\S/);
    expect(state.draft).toEqual({ title: "Getting started", slug: "getting-started", body: "Install the toolkit and run the server." });
    expect(state.validation).toMatchObject({ state: "ready", valid: true, errors: [] });
  });

  it("shows the server's validate errors for a bad draft and clears them when fixed", async () => {
    const widget = rig.controller();
    await widget.open("getting-started");
    widget.edit("title", "");
    await widget.idle();
    expect(widget.getState().validation.valid).toBe(false);
    expect(widget.getState().validation.errors.join(" ")).toMatch(/title/);
    widget.edit("title", "Getting started, again");
    await widget.idle();
    expect(widget.getState().validation).toMatchObject({ valid: true, errors: [] });
    expect(rig.calls.filter((call) => call.name === "validate").length).toBeGreaterThanOrEqual(3);
  });

  it("debounces keystrokes into one validate call and ignores a stale answer", async () => {
    const widget = rig.controller({ validateDelayMs: 20 });
    await widget.open("style-guide");
    rig.calls.length = 0;
    widget.edit("body", "a");
    widget.edit("body", "ab");
    widget.edit("body", "");
    await widget.idle();
    expect(rig.calls.filter((call) => call.name === "validate")).toHaveLength(1);
    expect(widget.getState().validation.valid).toBe(false);
  });

  it("does not let the key of a stored page be edited", async () => {
    const widget = rig.controller();
    await widget.open("style-guide");
    widget.edit("slug", "renamed");
    expect(widget.getState().draft?.slug).toBe("style-guide");
  });
});

describe("save through mutate, dry run first", () => {
  it("previews with dryRun: true, writes nothing, then writes on confirm and refreshes the list", async () => {
    const widget = rig.controller();
    await widget.refresh();
    await widget.open("style-guide");
    widget.edit("body", "Write short sentences. Prefer verbs.");
    await widget.idle();
    rig.calls.length = 0;

    await widget.requestPreview();
    const preview = widget.getState().preview;
    expect(preview.state).toBe("ready");
    expect(preview.result).toMatchObject({ ok: true, action: "update", dryRun: true });
    expect(rig.calls.filter((call) => call.name === "mutate").map((call) => call.arguments["dryRun"])).toEqual([true]);
    // Still the old content in the store.
    expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences.");

    await widget.confirmSave();
    expect(widget.getState().save.state).toBe("saved");
    const writes = rig.calls.filter((call) => call.name === "mutate" && call.arguments["dryRun"] === false);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.arguments).toMatchObject({ action: "update", slug: "style-guide", expectedRevision: expect.any(String), idempotencyKey: expect.any(String) });
    expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences. Prefer verbs.");
    expect(widget.getState().dirty).toBe(false);
    expect(widget.getState().list.pages.find((page) => page.slug === "style-guide")?.body).toBe("Write short sentences. Prefer verbs.");
  });

  it("refuses to write without a preview, and a changed draft invalidates the preview", async () => {
    const widget = rig.controller();
    await widget.open("style-guide");
    widget.edit("body", "New body");
    await widget.idle();

    await widget.confirmSave();
    expect(widget.getState().save).toMatchObject({ state: "failed" });
    expect(rig.calls.some((call) => call.name === "mutate")).toBe(false);

    await widget.requestPreview();
    expect(widget.getState().preview.state).toBe("ready");
    widget.edit("body", "Newer body");
    expect(widget.getState().preview.state).toBe("idle");
    await widget.idle();
    await widget.confirmSave();
    expect(rig.calls.some((call) => call.name === "mutate" && call.arguments["dryRun"] === false)).toBe(false);
    expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences.");
  });

  it("does not preview an invalid draft", async () => {
    const widget = rig.controller();
    widget.startNew();
    widget.edit("slug", "Not A Slug");
    widget.edit("title", "T");
    widget.edit("body", "B");
    await widget.idle();
    await widget.requestPreview();
    expect(widget.getState().preview).toMatchObject({ state: "failed" });
    expect(rig.calls.some((call) => call.name === "mutate")).toBe(false);
  });

  it("creates a new page", async () => {
    const widget = rig.controller();
    widget.startNew();
    expect(widget.getState().draft).toEqual(emptyDraft());
    widget.edit("title", "Release notes");
    widget.edit("slug", "release-notes");
    widget.edit("body", "Nothing yet.");
    await widget.idle();
    await widget.requestPreview();
    expect(widget.getState().preview.result).toMatchObject({ ok: true, action: "create", dryRun: true });
    await widget.confirmSave();
    expect(widget.getState().save.state).toBe("saved");
    expect((await rig.store.get("release-notes"))?.title).toBe("Release notes");
    expect(widget.getState().mode).toBe("edit");
  });

  it("surfaces a conflict when the page changed under the editor, and keeps the draft", async () => {
    const widget = rig.controller();
    await widget.open("style-guide");
    widget.edit("body", "My edit");
    await widget.idle();
    await widget.requestPreview();

    // Someone else saves first.
    const current = await rig.caller.call("query", { slug: "style-guide" });
    await rig.caller.call("mutate", {
      action: "update",
      slug: "style-guide",
      page: { title: "Style guide", slug: "style-guide", body: "Their edit" },
      dryRun: false,
      expectedRevision: current.page?.revision ?? "",
    });

    await widget.confirmSave();
    expect(widget.getState().save).toMatchObject({ state: "failed", conflict: true });
    expect(widget.getState().draft?.body).toBe("My edit");
    expect((await rig.store.get("style-guide"))?.body).toBe("Their edit");

    await widget.open("style-guide");
    expect(widget.getState().draft?.body).toBe("Their edit");
  });

  it("reuses one idempotency key for a repeated confirm of the same draft", async () => {
    let n = 0;
    const widget = rig.controller({ newIdempotencyKey: () => `key-${++n}` });
    await widget.open("style-guide");
    widget.edit("body", "Once");
    await widget.idle();
    await widget.requestPreview();
    await widget.confirmSave();
    const key = rig.calls.find((call) => call.name === "mutate" && call.arguments["dryRun"] === false)?.arguments["idempotencyKey"];
    expect(key).toBe("key-1");
  });
});

describe("mcpToolCaller", () => {
  it("explains a tool result that has no structured content", async () => {
    const caller = mcpToolCaller({ callTool: async () => ({ isError: true, content: [{ type: "text", text: "Forbidden" }] }) });
    await expect(caller.call("query", {})).rejects.toThrow(/returned no structured result: Forbidden/);
  });
});
