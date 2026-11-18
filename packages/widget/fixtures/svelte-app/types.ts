import type { SvelteHTMLElements } from "svelte/elements";
import type { ToolCaller } from "../../src/controller.js";

// Type-check proof for the Svelte typings: `caller` on the element is the generated ToolCaller
// (markup is checked by svelte-check against the same declaration; Svelte markup has no
// expect-error directive for attribute values, so the negative case is asserted on the type).
type Props = SvelteHTMLElements["strumentario-page-widget"];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const callerIsToolCaller: Equal<NonNullable<Props["caller"]>, ToolCaller> = true;
const wrongCallerRejected: ({ call: number } extends NonNullable<Props["caller"]> ? false : true) = true;
export { callerIsToolCaller, wrongCallerRejected };
