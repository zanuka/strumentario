import { createWidgetController, type ToolCaller, type WidgetController, type WidgetState } from "./controller.js";
import { KEY_FIELD, PAGE_FIELDS, TOOL_META, type PageDraft } from "./generated/contracts.js";

/**
 * `<strumentario-page-widget>`: the widget as a vanilla custom element (shadow DOM, no framework).
 * It renders the framework-neutral controller's state and forwards user actions; every read and
 * write is still an MCP tool call through the `caller`. Usable from React, Vue, Svelte or plain HTML.
 *
 * Rendering updates in place: inputs the user is typing in are created once per open page and only
 * written to when the draft differs from what they show, so focus, caret and input survive the
 * live validation that re-renders around them.
 */

export const ELEMENT_NAME = "strumentario-page-widget";

export type { StrumentarioPageWidgetProps } from "./element-props.js";

const STYLE = `
  :host { display: block; font: 15px/1.45 system-ui, sans-serif; color: #1b1f24; }
  .root { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
  section, .empty { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; }
  h2 { font-size: 15px; margin: 0 0 8px; } ul { list-style: none; padding: 0; margin: 0; }
  .list li button { width: 100%; text-align: left; margin: 2px 0; } .list li button[aria-current="true"] { border-color: #0969da; }
  button { font: inherit; padding: 4px 10px; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  input, textarea { font: inherit; width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid #d0d7de; border-radius: 6px; }
  .field { margin: 8px 0; } .field label { display: block; font-weight: 600; font-size: 13px; }
  .validation { margin: 8px 0; font-size: 13px; } .validation li { color: #cf222e; }
  .actions { display: flex; gap: 8px; margin: 8px 0; } .preview table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .preview th, .preview td { border-top: 1px solid #d0d7de; padding: 4px 6px; text-align: left; vertical-align: top; }
  .preview tr[data-changed="true"] td:last-child { background: #dafbe1; } [role="alert"] { color: #cf222e; }
  [hidden] { display: none !important; }
  @media (max-width: 700px) { .root { grid-template-columns: 1fr; } }
`;

type Child = Node | string;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

export class StrumentarioPageWidget extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["multiline-fields", "validate-delay-ms"];
  }

  #caller: ToolCaller | undefined;
  #controller: WidgetController | undefined;
  #unsubscribe: (() => void) | undefined;
  #multiline: ReadonlyArray<string> = ["body"];
  #delay: number | undefined;
  #root: ShadowRoot;

  // Static parts of the list section.
  #listBody = h("div");
  #filter = h("input", { name: "filter", placeholder: "Filter by text", "aria-label": "Filter pages" });
  // The editor, rebuilt only when a different page (or a new one) is opened.
  #editorSlot = h("div");
  #editorKey: string | null = null;
  #fields = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  #title = h("h2");
  #validation = h("div", { class: "validation", role: "status", "aria-live": "polite" });
  #previewBtn = h("button", { type: "button" }, "Preview save (dry run)");
  #saveBtn = h("button", { type: "button" }, "Save");
  #closeBtn = h("button", { type: "button" }, "Close");
  #previewOut = h("div");
  #saveOut = h("div");
  #empty = h("p", { class: "empty" }, "Pick a page to edit, or create one.");

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.append(h("style", {}, STYLE), this.#buildSkeleton());
  }

  /** The MCP tool caller (see `mcpToolCaller`). Setting it (re)starts the widget and loads the list. */
  get caller(): ToolCaller | undefined {
    return this.#caller;
  }
  set caller(value: ToolCaller | undefined) {
    this.#caller = value;
    if (this.isConnected) this.#start();
  }

  /** The controller behind the element, for hosts and tests that want to drive it directly. */
  get controller(): WidgetController | undefined {
    return this.#controller;
  }

  connectedCallback(): void {
    this.#adoptEarlyCaller();
    this.#readAttributes();
    this.#start();
  }

  /**
   * A framework may set `caller` on the bare tag before this class is registered (a client-only
   * dynamic import, a lazy `defineStrumentarioPageWidget()`). That creates an own data property that
   * shadows the accessor once the element upgrades, so move the value onto the accessor.
   */
  #adoptEarlyCaller(): void {
    if (!Object.prototype.hasOwnProperty.call(this, "caller")) return;
    const early = Reflect.get(this, "caller") as ToolCaller | undefined;
    Reflect.deleteProperty(this, "caller");
    this.#caller = early;
  }

  disconnectedCallback(): void {
    this.#stop();
  }

  attributeChangedCallback(): void {
    this.#readAttributes();
  }

  #readAttributes(): void {
    const multiline = this.getAttribute("multiline-fields");
    this.#multiline = multiline === null ? ["body"] : multiline.split(",").map((name) => name.trim()).filter(Boolean);
    const delay = this.getAttribute("validate-delay-ms");
    this.#delay = delay === null || Number.isNaN(Number(delay)) ? undefined : Number(delay);
  }

  #stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#controller = undefined;
  }

  #start(): void {
    this.#stop();
    if (!this.#caller) return;
    this.#editorKey = null;
    const controller = createWidgetController({ caller: this.#caller, ...(this.#delay === undefined ? {} : { validateDelayMs: this.#delay }) });
    this.#controller = controller;
    this.#unsubscribe = controller.subscribe(() => this.#render(controller.getState()));
    this.#render(controller.getState());
    void controller.refresh();
  }

  #buildSkeleton(): HTMLElement {
    const form = h("form", { role: "search" });
    const search = h("button", { type: "submit" }, "Search");
    const create = h("button", { type: "button" }, "New page");
    form.append(this.#filter, search, create);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#controller?.refresh(this.#filter.value);
    });
    create.addEventListener("click", () => this.#controller?.startNew());

    this.#previewBtn.addEventListener("click", () => void this.#controller?.requestPreview());
    this.#saveBtn.addEventListener("click", () => void this.#controller?.confirmSave());
    this.#closeBtn.addEventListener("click", () => this.#controller?.close());

    const list = h("section", { class: "list", "aria-label": "Pages" }, h("h2", {}, TOOL_META.query.title), form, this.#listBody);
    return h("div", { class: "root", "data-testid": "page-widget" }, list, this.#editorSlot, this.#empty);
  }

  #buildEditor(): void {
    this.#fields.clear();
    const section = h("section", { "aria-label": "Editor" }, this.#title);
    for (const field of PAGE_FIELDS) {
      const control = this.#multiline.includes(field.name) ? h("textarea", { rows: "8" }) : h("input");
      control.id = `sw-${field.name}`;
      control.addEventListener("input", () => this.#controller?.edit(field.name, control.value));
      this.#fields.set(field.name, control);
      section.append(h("div", { class: "field" }, h("label", { for: control.id }, field.name), control));
    }
    section.append(this.#validation, h("div", { class: "actions" }, this.#previewBtn, this.#saveBtn, this.#closeBtn), this.#previewOut, this.#saveOut);
    this.#editorSlot.replaceChildren(section);
  }

  #render(state: WidgetState): void {
    this.#renderList(state);
    const editing = state.mode !== "none" && state.draft !== null;
    this.#empty.hidden = editing;
    this.#editorSlot.hidden = !editing;
    if (!editing) {
      this.#editorKey = null;
      return;
    }
    const key = `${state.mode}:${state.base?.[KEY_FIELD] ?? ""}`;
    if (key !== this.#editorKey) {
      this.#editorKey = key;
      this.#buildEditor();
    }
    this.#renderEditor(state, state.draft as PageDraft);
  }

  #renderList(state: WidgetState): void {
    const { list } = state;
    if (list.state === "pending") {
      this.#listBody.replaceChildren(h("p", { role: "status" }, "Loading pages…"));
    } else if (list.state === "failed") {
      this.#listBody.replaceChildren(h("p", { role: "alert" }, list.message ?? "The page list failed to load."));
    } else if (list.state === "ready") {
      const items = list.pages.map((page) => {
        const button = h("button", { type: "button", "aria-current": String(state.base?.[KEY_FIELD] === page[KEY_FIELD]) }, h("strong", {}, page.title), " ", h("code", {}, page[KEY_FIELD]));
        button.addEventListener("click", () => void this.#controller?.open(page[KEY_FIELD]));
        return h("li", {}, button);
      });
      this.#listBody.replaceChildren(
        h("p", {}, `${list.pages.length} of ${list.total} ${list.total === 1 ? "page" : "pages"}`),
        h("ul", {}, ...items),
      );
    } else {
      this.#listBody.replaceChildren();
    }
  }

  #renderEditor(state: WidgetState, draft: PageDraft): void {
    const { validation, preview, save, mode } = state;
    this.#title.textContent = mode === "new" ? "New page" : `Editing ${state.base?.[KEY_FIELD] ?? ""}`;
    for (const field of PAGE_FIELDS) {
      const control = this.#fields.get(field.name);
      if (!control) continue;
      // Only touch a control whose text differs from the draft (open, save, reload); typing already matches.
      if (control.value !== draft[field.name]) control.value = draft[field.name];
      control.disabled = mode === "edit" && field.name === KEY_FIELD;
    }

    this.#validation.dataset["state"] = validation.state;
    if (validation.state === "pending") {
      this.#validation.replaceChildren("Validating…");
    } else if (validation.state === "ready" && validation.valid) {
      this.#validation.replaceChildren("Valid.");
    } else if (validation.state === "ready") {
      this.#validation.replaceChildren(h("ul", { "aria-label": "Validation errors" }, ...validation.errors.map((error) => h("li", {}, error))));
    } else if (validation.state === "failed") {
      this.#validation.replaceChildren(h("span", { role: "alert" }, validation.errors.join(" ")));
    } else {
      this.#validation.replaceChildren();
    }

    this.#previewBtn.disabled = !(validation.state === "ready" && validation.valid && preview.state !== "pending");
    this.#saveBtn.disabled = !(preview.state === "ready" && save.state !== "saving");

    if (preview.state === "pending") this.#previewOut.replaceChildren(h("p", { role: "status" }, "Running dry run…"));
    else if (preview.state === "failed") this.#previewOut.replaceChildren(h("p", { role: "alert" }, preview.message ?? "The dry run failed."));
    else if (preview.state === "ready" && preview.result?.ok && preview.result.page) this.#previewOut.replaceChildren(this.#previewTable(state));
    else this.#previewOut.replaceChildren();

    if (save.state === "saved") {
      this.#saveOut.replaceChildren(h("p", { role: "status" }, save.message ?? "Saved."));
    } else if (save.state === "failed") {
      const alert = h("p", { role: "alert" }, save.message ?? "The save failed.");
      if (save.conflict && state.base) {
        const reload = h("button", { type: "button" }, "Reload latest");
        const baseKey = state.base[KEY_FIELD];
        reload.addEventListener("click", () => void this.#controller?.open(baseKey));
        alert.append(" ", reload);
      }
      this.#saveOut.replaceChildren(alert);
    } else {
      this.#saveOut.replaceChildren();
    }
  }

  #previewTable(state: WidgetState): HTMLElement {
    const result = state.preview.result;
    const after = result?.page;
    const before = result?.previous;
    const rows = PAGE_FIELDS.map((field) => {
      const was = before?.[field.name];
      const now = after?.[field.name] ?? "";
      return h("tr", { "data-changed": String(was !== now) }, h("td", {}, field.name), h("td", {}, was ?? "—"), h("td", {}, now));
    });
    return h(
      "div",
      { class: "preview", "aria-label": "Dry-run preview" },
      h("p", {}, h("strong", {}, "Dry run — nothing written yet."), ` ${result?.action === "create" ? "Would create" : "Would update"} `, h("code", {}, result?.slug ?? "")),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Field"), h("th", {}, "Now"), h("th", {}, "After save"))), h("tbody", {}, ...rows)),
    );
  }
}

/** Registers `<strumentario-page-widget>` once; safe to call again. */
export function defineStrumentarioPageWidget(name: string = ELEMENT_NAME): typeof StrumentarioPageWidget {
  if (!customElements.get(name)) customElements.define(name, StrumentarioPageWidget);
  return StrumentarioPageWidget;
}

declare global {
  interface HTMLElementTagNameMap {
    "strumentario-page-widget": StrumentarioPageWidget;
  }
}
