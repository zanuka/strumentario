/**
 * Svelte typings for `<strumentario-page-widget>`. Reference once (for example in `app.d.ts`):
 *
 *   /// <reference types="@strumentario/widget/svelte" />
 *
 * Markup then type-checks `caller={…}` (set as a DOM property, because the element has a `caller`
 * property) against the generated `ToolCaller`.
 */
import type { HTMLAttributes } from "svelte/elements";
import type { StrumentarioPageWidgetProps } from "../dist/element-props.js";

declare module "svelte/elements" {
  interface SvelteHTMLElements {
    "strumentario-page-widget": HTMLAttributes<HTMLElement> & StrumentarioPageWidgetProps;
  }
}
