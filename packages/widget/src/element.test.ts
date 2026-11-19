// @vitest-environment jsdom
import { defineStrumentarioPageWidget, type StrumentarioPageWidget } from "./element.js";
import { runWidgetBehaviorSuite } from "./widget-behavior.js";

runWidgetBehaviorSuite("plain DOM", (caller) => {
  defineStrumentarioPageWidget();
  const el = document.createElement("strumentario-page-widget") as StrumentarioPageWidget;
  el.setAttribute("validate-delay-ms", "0");
  document.body.append(el);
  el.caller = caller;
  return { el, unmount: () => el.remove() };
});
