/**
 * Vue typings for `<strumentario-page-widget>`. Reference once (for example in `env.d.ts`):
 *
 *   /// <reference types="@strumentario/widget/vue" />
 *
 * Templates then type-check `:caller.prop="…"` against the generated `ToolCaller` and the two
 * attributes against `StrumentarioPageWidgetProps`. Vue still has to be told the tag is a custom
 * element at compile time: `compilerOptions.isCustomElement` (see docs/widget/frameworks.md).
 */
import type { DefineComponent } from "vue";
import type { StrumentarioPageWidgetProps } from "../dist/element-props.js";

declare module "vue" {
  interface GlobalComponents {
    "strumentario-page-widget": DefineComponent<StrumentarioPageWidgetProps>;
  }
}
