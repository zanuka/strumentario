// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCaller } from "../../src/controller.js";
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "../../src/element.js";
import { seed, startRig, type Rig } from "../../src/test-support.js";
import Host from "./Host.vue";

// The Vue integration points, one test each. Each runs in a fresh module graph per file, so the
// element is still unregistered when the first test mounts.
let rig: Rig;
beforeEach(async () => {
  rig = await startRig();
  await seed(rig);
});
afterEach(async () => {
  await rig.close();
});

describe("Vue integration points", () => {
  it("registration: the SFC compiler is told the tag is a custom element, so Vue renders it as is", () => {
    // vitest.config.ts sets compilerOptions.isCustomElement for this tag. Without it Vue would try to
    // resolve a component and warn "Failed to resolve component: strumentario-page-widget".
    const wrapper = mount(Host, { props: { caller: rig.caller }, attachTo: document.body });
    expect(wrapper.element.tagName.toLowerCase()).toBe("strumentario-page-widget");
    wrapper.unmount();
  });

  it("property passing: `caller` arrives as a DOM property and never as an attribute", () => {
    defineStrumentarioPageWidget();
    const wrapper = mount(Host, { props: { caller: rig.caller }, attachTo: document.body });
    const el = wrapper.element as unknown as StrumentarioPageWidget;
    expect(el.caller).toBe(rig.caller);
    expect(el.hasAttribute("caller")).toBe(false);
    wrapper.unmount();
  });

  it("property passing: a new `caller` from Vue restarts the widget with it", async () => {
    defineStrumentarioPageWidget();
    const wrapper = mount(Host, { props: { caller: rig.caller }, attachTo: document.body });
    const el = wrapper.element as unknown as StrumentarioPageWidget;
    const failing: ToolCaller = { call: () => Promise.reject(new Error("offline")) } as unknown as ToolCaller;
    await wrapper.setProps({ caller: failing });
    await el.controller!.idle();
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe("offline");
    wrapper.unmount();
  });
});
