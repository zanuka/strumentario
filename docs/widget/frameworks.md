# Use the widget from a framework

`<strumentario-page-widget>` is a standard custom element, so Vue, Svelte, React 19 and plain HTML render it directly. There is one widget implementation (`packages/widget/src/element.ts`) and no per-framework copy of its rendering or state logic. Each framework only has to do three things:

1. **Register the element on the client**: `defineStrumentarioPageWidget()` (from `@strumentario/widget/element`).
2. **Pass `caller` as a DOM property**, not an attribute. It is an object (see `mcpToolCaller`), so as an attribute it would become `[object Object]`.
3. **Render it client-side only.** Custom elements need `HTMLElement` and `customElements`, which a server does not have.

The main entry (`@strumentario/widget`) re-exports the element, so a value import from it is client-only too; type imports (`import type { ToolCaller }`) are erased and safe anywhere.

The two attributes are plain strings: `multiline-fields` and `validate-delay-ms` (see [the widget README](README.md#layers)).

## What is verified

`packages/widget/fixtures/` holds a minimal Vue 3 app and a minimal Svelte 5 app. They are test fixtures, not published packages. `pnpm test` runs the same behavior suite (`src/widget-behavior.ts`: list, edit, live validate, dry-run preview, save, conflict and "Reload latest", and a failed list) against the element mounted plain, from Vue and from Svelte, over a real MCP server on an in-memory transport. `pnpm typecheck` type-checks both fixtures (`vue-tsc` and `svelte-check`).

| Integration point | Covered by |
|-------------------|------------|
| `caller` set as a property, never an attribute | `fixtures/vue-app/integration.test.ts`, `fixtures/svelte-app/integration.test.ts` |
| Vue treats the tag as a custom element | `isCustomElement` in `vitest.config.ts`; `integration.test.ts` mounts the SFC with it |
| `caller` set before the element is registered (client-only dynamic import) | `fixtures/vue-app/late-define.test.ts`, `fixtures/svelte-app/integration.test.ts` |
| Server rendering emits the bare tag; the element module cannot be imported on the server | `fixtures/vue-app/client-only.test.ts` |
| Types in templates and markup | `pnpm typecheck` over `fixtures/*-app` (a wrong `caller` is a type error) |

**Not verified:** Nuxt, SvelteKit, Vite dev servers or production builds, React, and any MCP Apps host. The Nuxt and SvelteKit snippets below follow those frameworks' documented client-only mechanisms but no Nuxt or SvelteKit app exists in this repo. React 19 and plain HTML are documented here and use the same element; they have no fixture. Vue and Svelte were exercised under jsdom, not in a browser.

## Types

The type declarations ship with the package, as types-only entries built from `StrumentarioPageWidgetProps`, whose `caller` is the generated `ToolCaller`:

- **Vue**: add `/// <reference types="@strumentario/widget/vue" />` (for example in `env.d.ts`). It augments `GlobalComponents`, so `:caller.prop="…"` is checked, and a wrong object is an error under `vue-tsc`.
- **Svelte**: add `/// <reference types="@strumentario/widget/svelte" />` (for example in `app.d.ts`). It augments `SvelteHTMLElements`, so `caller={…}` is checked by `svelte-check`.

The fixtures reference the files by relative path (`types/vue.d.ts`, `types/svelte.d.ts`) because TypeScript does not resolve a package's own name through a `reference types` directive. An installed package resolves them as written above.

## Vue 3

Tell the compiler the tag is a custom element, or Vue warns that it cannot resolve a component:

```ts
// vite.config.ts
import vue from "@vitejs/plugin-vue";
export default { plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "strumentario-page-widget" } } })] };
```

Set `caller` with `.prop` (or a template ref):

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import type { ToolCaller } from "@strumentario/widget";
defineProps<{ caller: ToolCaller }>();
onMounted(() => import("@strumentario/widget/element").then((m) => m.defineStrumentarioPageWidget()));
</script>

<template>
  <strumentario-page-widget :caller.prop="caller" validate-delay-ms="250" />
</template>
```

Registering in `onMounted` through a dynamic import keeps the module off the server. The element adopts a `caller` that was set before registration (this is tested), so the order does not matter. Without the dynamic import, a static `import "@strumentario/widget/element"` is fine in a client-only SPA.

**Nuxt**: wrap the use in `<ClientOnly>` (or name the component `*.client.vue`), and set `vue.compilerOptions.isCustomElement` in `nuxt.config.ts`.

## Svelte 5

Svelte sets a prop on a custom element as a DOM property when the element has a property of that name, so `caller={caller}` needs no extra syntax once the element is registered, and the set-before-registration case is covered by the element:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { ToolCaller } from "@strumentario/widget";
  let { caller }: { caller: ToolCaller } = $props();
  onMount(async () => (await import("@strumentario/widget/element")).defineStrumentarioPageWidget());
</script>

<strumentario-page-widget {caller} validate-delay-ms="250"></strumentario-page-widget>
```

**SvelteKit**: `onMount` runs only in the browser, so the dynamic import there is already client-only. The tag itself is still server-rendered as an empty element; wrap it in `{#if browser}` (from `$app/environment`) to render nothing on the server.

## React 19

React 19 passes props that exist on a custom element as properties, so `caller` needs no ref:

```tsx
import { useEffect } from "react";
import type { ToolCaller } from "@strumentario/widget";

export function PageWidget({ caller }: { caller: ToolCaller }) {
  useEffect(() => { void import("@strumentario/widget/element").then((m) => m.defineStrumentarioPageWidget()); }, []);
  return <strumentario-page-widget caller={caller} validate-delay-ms="250" />;
}
```

JSX typing for the tag is not shipped; declare it for your app (`declare module "react" { namespace JSX { interface IntrinsicElements { "strumentario-page-widget": … } } }`) from `StrumentarioPageWidgetProps`. This path has no fixture here. React 18 does not set object props on custom elements; use a ref there (`ref.current.caller = caller`).

## Plain HTML

```html
<strumentario-page-widget id="w" validate-delay-ms="250"></strumentario-page-widget>
<script type="module">
  import { defineStrumentarioPageWidget, mcpToolCaller } from "./widget.js";
  defineStrumentarioPageWidget();
  document.getElementById("w").caller = mcpToolCaller(client); // an MCP client, see the widget README
</script>
```

## Checking another framework

Before calling a framework supported, go through these steps and record what you ran:

1. **Mount the tag** in the smallest app the framework can build, as a test fixture (not a published package). Do not write a framework-specific widget.
2. **Run the shared suite.** In a jsdom test file, call `runWidgetBehaviorSuite("<framework>", mount)` from `src/widget-behavior.ts`, where `mount(caller)` renders the framework's host with the caller, `validate-delay-ms="0"`, attached to `document`, and returns `{ el, unmount }`. The same assertions must pass.
3. **Check property passing.** Assert `el.caller === caller` and `el.hasAttribute("caller") === false`. If the framework serialises objects to attributes, find its property syntax (a `.prop` modifier, a ref, a spread) and use it.
4. **Check registration.** Find how the framework's compiler learns the tag is a custom element (Vue needs `isCustomElement`; JSX frameworks need a typing), and make sure an unknown-tag warning is not suppressed globally.
5. **Check client-only rendering.** Confirm server rendering emits the bare tag without throwing, and that the element module is imported only on the client. Add a late-registration test: render, then `defineStrumentarioPageWidget()`, and assert the list loads.
6. **Add types** if the framework type-checks templates: an entry under `types/` built from `StrumentarioPageWidgetProps`, and a fixture that fails to type-check with a wrong `caller` (a type error, or an assertion on the type).
7. **Document** the result here, including what was not run.
