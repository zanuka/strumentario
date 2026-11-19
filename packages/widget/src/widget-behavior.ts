import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCaller } from "./controller.js";
import type { StrumentarioPageWidget } from "./element.js";
import { seed, startRig, type Rig } from "./test-support.js";

/**
 * A mounted `<strumentario-page-widget>`. Each host (plain DOM, Vue, Svelte) mounts the same element
 * with the given caller and `validate-delay-ms="0"`, attached to `document`, and hands back the element.
 */
export interface MountedWidget {
  el: StrumentarioPageWidget;
  unmount(): void;
}
export type MountWidget = (caller: ToolCaller) => Promise<MountedWidget> | MountedWidget;

/**
 * The widget behavior contract, run unchanged against every way of mounting the element:
 * list, edit, live validate, dry-run preview, save, conflict and "Reload latest".
 * Needs a jsdom environment (`// @vitest-environment jsdom` in the calling file).
 */
export function runWidgetBehaviorSuite(host: string, mount: MountWidget): void {
  describe(`<strumentario-page-widget> mounted from ${host}`, () => {
    let rig: Rig;
    let mounted: MountedWidget;
    let el: StrumentarioPageWidget;

    beforeEach(async () => {
      rig = await startRig();
      await seed(rig);
      mounted = await mount(rig.caller);
      el = mounted.el;
    });
    afterEach(async () => {
      mounted.unmount();
      await rig.close();
    });

    const q = <T extends Element>(selector: string): T | null => el.shadowRoot!.querySelector<T>(selector);
    const button = (label: string | RegExp): HTMLButtonElement => {
      const found = [...el.shadowRoot!.querySelectorAll("button")].find((b) => (typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? "")));
      if (!found) throw new Error(`no button ${label}`);
      return found;
    };
    const type = (field: string, value: string) => {
      const input = q<HTMLInputElement>(`#sw-${field}`)!;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const settle = async () => {
      await el.controller!.idle();
      await Promise.resolve();
    };

    it("completes list, edit, validate, dry-run preview and save through MCP calls", async () => {
      await settle();
      expect(q("ul")!.querySelectorAll("button")).toHaveLength(2);

      button(/Style guide/).click();
      await settle();
      expect(q<HTMLInputElement>("#sw-slug")!.disabled).toBe(true);
      expect(q(".validation")!.textContent).toBe("Valid.");

      type("body", "");
      await settle();
      expect(q('[aria-label="Validation errors"]')!.textContent).toMatch(/body/);
      expect(button(/Preview save/).disabled).toBe(true);

      type("body", "Write short sentences. Prefer verbs.");
      await settle();
      expect(q(".validation")!.textContent).toBe("Valid.");
      expect(button("Save").disabled).toBe(true);

      button(/Preview save/).click();
      await settle();
      expect(q('[aria-label="Dry-run preview"]')!.textContent).toMatch(/nothing written yet/i);
      expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences.");
      expect(button("Save").disabled).toBe(false);

      button("Save").click();
      await settle();
      expect(el.shadowRoot!.textContent).toMatch(/Saved "style-guide"/);
      expect((await rig.store.get("style-guide"))?.body).toBe("Write short sentences. Prefer verbs.");
      expect(rig.calls.filter((c) => c.name === "mutate").map((c) => c.arguments["dryRun"])).toEqual([true, false]);
    });

    it("keeps the same input element, focus and caret while live validation re-renders", async () => {
      await settle();
      button(/Getting started/).click();
      await settle();
      const body = q<HTMLTextAreaElement>("#sw-body")!;
      body.focus();
      body.value = "Install the toolkit, then run the server.";
      body.setSelectionRange(7, 7);
      body.dispatchEvent(new Event("input", { bubbles: true }));
      // Re-renders happen for "Validating…" and for the result.
      expect(q("#sw-body")).toBe(body);
      await settle();
      expect(q("#sw-body")).toBe(body);
      expect(el.shadowRoot!.activeElement).toBe(body);
      expect(body.value).toBe("Install the toolkit, then run the server.");
      expect(body.selectionStart).toBe(7);
      expect(q(".validation")!.textContent).toBe("Valid.");
    });

    it("renders editor fields from the generated contract and locks the key only on stored pages", async () => {
      await settle();
      button("New page").click();
      for (const name of ["title", "slug", "body"]) expect(q(`#sw-${name}`)).toBeTruthy();
      expect(q<HTMLInputElement>("#sw-slug")!.disabled).toBe(false);
      expect(q("#sw-body")!.tagName).toBe("TEXTAREA");
      button("Close").click();
      expect(q<HTMLElement>("section[aria-label=Editor]")!.parentElement!.hidden).toBe(true);
      expect(q<HTMLElement>(".empty")!.hidden).toBe(false);
    });

    it("shows a conflict, keeps the draft and reloads on request", async () => {
      await settle();
      button(/Style guide/).click();
      await settle();
      type("body", "My edit");
      await settle();
      button(/Preview save/).click();
      await settle();
      const current = await rig.caller.call("query", { slug: "style-guide" });
      await rig.caller.call("mutate", { action: "update", slug: "style-guide", page: { title: "Style guide", slug: "style-guide", body: "Their edit" }, dryRun: false, expectedRevision: current.page?.revision ?? "" });
      button("Save").click();
      await settle();
      expect(q('[role="alert"]')!.textContent).toMatch(/Reload latest/);
      expect(q<HTMLTextAreaElement>("#sw-body")!.value).toBe("My edit");
      button("Reload latest").click();
      await settle();
      expect(q<HTMLTextAreaElement>("#sw-body")!.value).toBe("Their edit");
    });

    it("shows a failed list as an alert", async () => {
      const failing = await mount({ call: () => Promise.reject(new Error("offline")) } as never);
      await failing.el.controller!.idle();
      await Promise.resolve();
      expect(failing.el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe("offline");
      failing.unmount();
    });
  });
}
