// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "../../src/element.js";
import { runWidgetBehaviorSuite } from "../../src/widget-behavior.js";
import Host from "./Host.vue";

// The shared behavior suite, with the element rendered by a Vue template.
runWidgetBehaviorSuite("Vue", (caller) => {
  defineStrumentarioPageWidget();
  const wrapper = mount(Host, { props: { caller }, attachTo: document.body });
  const el = wrapper.element as unknown as StrumentarioPageWidget; // single root: the element itself
  return { el, unmount: () => wrapper.unmount() };
});
