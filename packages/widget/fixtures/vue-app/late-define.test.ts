// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "../../src/element.js";
import { seed, startRig } from "../../src/test-support.js";
import Host from "./Host.vue";

// Client-only pattern: the framework renders the tag first and the element module is imported and
// registered afterwards (for example in onMounted, or a dynamic import inside <ClientOnly>). Vue sets
// `caller` on the not-yet-upgraded element; the element must adopt it on upgrade. This file never
// registers the element before mounting, which is why it is separate from the other Vue tests.
it("adopts a `caller` that Vue set before the element was registered", async () => {
  const rig = await startRig();
  await seed(rig);
  expect(customElements.get("strumentario-page-widget")).toBeUndefined();
  const wrapper = mount(Host, { props: { caller: rig.caller }, attachTo: document.body });
  const el = wrapper.element as unknown as StrumentarioPageWidget;
  expect(Object.prototype.hasOwnProperty.call(el, "caller")).toBe(true);

  defineStrumentarioPageWidget();
  await el.controller!.idle();
  await Promise.resolve();
  expect(Object.prototype.hasOwnProperty.call(el, "caller")).toBe(false);
  expect(el.caller).toBe(rig.caller);
  expect(el.shadowRoot!.querySelector("ul")!.querySelectorAll("button")).toHaveLength(2);
  wrapper.unmount();
  await rig.close();
});
