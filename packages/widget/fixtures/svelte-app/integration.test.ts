// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "../../src/element.js";
import { seed, startRig, type Rig } from "../../src/test-support.js";
import Host from "./Host.svelte";

// The Svelte integration points. The first test runs before the element is registered, which is the
// client-only pattern (the element module is imported after Svelte has rendered the tag): Svelte sets
// `caller` on the not-yet-upgraded element and the element must adopt it on upgrade.
let rig: Rig;
let target: HTMLDivElement;
beforeEach(async () => {
  rig = await startRig();
  await seed(rig);
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => {
  target.remove();
  await rig.close();
});

it("client-only: adopts a `caller` that Svelte set before the element was registered", async () => {
  expect(customElements.get("strumentario-page-widget")).toBeUndefined();
  const app = mount(Host, { target, props: { caller: rig.caller } });
  flushSync();
  const el = target.querySelector("strumentario-page-widget") as StrumentarioPageWidget;
  expect(el.hasAttribute("caller")).toBe(false);

  defineStrumentarioPageWidget();
  await el.controller!.idle();
  await Promise.resolve();
  expect(el.caller).toBe(rig.caller);
  expect(el.shadowRoot!.querySelector("ul")!.querySelectorAll("button")).toHaveLength(2);
  void unmount(app);
});

it("property passing: `caller` arrives as a DOM property and never as an attribute", () => {
  defineStrumentarioPageWidget();
  const app = mount(Host, { target, props: { caller: rig.caller } });
  flushSync();
  const el = target.querySelector("strumentario-page-widget") as StrumentarioPageWidget;
  expect(el.caller).toBe(rig.caller);
  expect(el.hasAttribute("caller")).toBe(false);
  void unmount(app);
});
