// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageWidget } from "./react/index.js";
import { seed, startRig, type Rig } from "./test-support.js";

let rig: Rig;
beforeEach(async () => {
  rig = await startRig();
  await seed(rig);
});
afterEach(async () => {
  cleanup();
  await rig.close();
});

describe("PageWidget (React) over real MCP calls", () => {
  it("completes list, edit, validate, dry-run preview and save", async () => {
    render(<PageWidget caller={rig.caller} validateDelayMs={0} />);

    // list (query)
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("button")).toHaveLength(2);

    // open + edit (query by key, then validate)
    fireEvent.click(within(list).getByText("Style guide"));
    const body = await screen.findByLabelText("body");
    await waitFor(() => expect(screen.getByRole("status", { name: "" })).toBeTruthy());
    fireEvent.change(body, { target: { value: "" } });

    // live validate feedback from the server's validate tool
    const errors = await screen.findByLabelText("Validation errors");
    expect(errors.textContent).toMatch(/body/);
    const previewButton = screen.getByRole("button", { name: /preview save/i });
    expect((previewButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(body, { target: { value: "Write short sentences. Prefer verbs." } });
    await screen.findByText("Valid.");
    expect((previewButton as HTMLButtonElement).disabled).toBe(false);
    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true); // nothing to save until previewed

    // dry run: shown, nothing written
    fireEvent.click(previewButton);
    const preview = await screen.findByLabelText("Dry-run preview");
    expect(preview.textContent).toMatch(/nothing written yet/i);
    expect(preview.textContent).toMatch(/Prefer verbs/);
    expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences.");
    expect(saveButton.disabled).toBe(false);

    // save (mutate, dryRun: false)
    fireEvent.click(saveButton);
    await screen.findByText(/Saved "style-guide"/);
    expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences. Prefer verbs.");
    const mutations = rig.calls.filter((call) => call.name === "mutate").map((call) => call.arguments["dryRun"]);
    expect(mutations).toEqual([true, false]);
  });

  it("renders the editor fields from the generated contract, locking the key on stored pages", async () => {
    render(<PageWidget caller={rig.caller} validateDelayMs={0} />);
    fireEvent.click(await screen.findByText("New page"));
    for (const name of ["title", "slug", "body"]) expect(await screen.findByLabelText(name)).toBeTruthy();
    expect((screen.getByLabelText("slug") as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Close"));
    fireEvent.click(await screen.findByText("Getting started"));
    await waitFor(() => expect((screen.getByLabelText("slug") as HTMLInputElement).disabled).toBe(true));
  });

  it("shows a failed list as an alert", async () => {
    const caller = { call: () => Promise.reject(new Error("offline")) } as never;
    render(<PageWidget caller={caller} />);
    expect((await screen.findByRole("alert")).textContent).toBe("offline");
  });
});
