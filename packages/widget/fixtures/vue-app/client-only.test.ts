// @vitest-environment node
import { renderToString } from "vue/server-renderer";
import { createSSRApp, h } from "vue";
import { expect, it } from "vitest";
import Host from "./Host.vue";

// Custom elements are client-only. On the server (Nuxt SSR, or any renderToString) there is no
// HTMLElement or customElements, so the element module must not be imported there.
it("server-rendering the host emits the bare tag, with no widget content and no caller", async () => {
  const html = await renderToString(createSSRApp({ render: () => h(Host, { caller: { call: async () => ({}) } as never }) }));
  expect(html).toBe('<strumentario-page-widget validate-delay-ms="0"></strumentario-page-widget>');
});

it("importing the element module on the server fails: import it only on the client", async () => {
  await expect(import("../../src/element.js")).rejects.toThrow(/HTMLElement is not defined/);
});
