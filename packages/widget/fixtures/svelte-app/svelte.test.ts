// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "../../src/element.js";
import { runWidgetBehaviorSuite } from "../../src/widget-behavior.js";
import Host from "./Host.svelte";

// The shared behavior suite, with the element rendered by Svelte markup.
runWidgetBehaviorSuite("Svelte", (caller) => {
  defineStrumentarioPageWidget();
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(Host, { target, props: { caller } });
  flushSync();
  const el = target.querySelector("strumentario-page-widget") as StrumentarioPageWidget;
  return {
    el,
    unmount: () => {
      void unmount(app);
      target.remove();
    },
  };
});
