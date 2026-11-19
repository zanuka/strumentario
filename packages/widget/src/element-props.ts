import type { ToolCaller } from "./controller.js";

/**
 * What a framework template may set on `<strumentario-page-widget>`. `caller` is an object, so it
 * is a DOM property, never an attribute; the other two are attributes (and also settable as strings).
 * The `./vue` and `./svelte` type entries build their element typings from this one interface, so the
 * tool types behind `caller` (`ToolCaller`, from the generated contracts) are shared, not copied.
 */
export interface StrumentarioPageWidgetProps {
  caller?: ToolCaller | undefined;
  /** Comma-separated field names rendered as text areas (default `body`). */
  "multiline-fields"?: string;
  /** Debounce before live `validate`, in milliseconds. */
  "validate-delay-ms"?: string | number;
}
