import {
  KEY_FIELD,
  PAGE_FIELDS,
  type MutateInput,
  type MutateOutput,
  type PageDraft,
  type StoredPage,
  type ToolInputs,
  type ToolOutputs,
  type WidgetToolName,
} from "./generated/contracts.js";

/**
 * The widget's behaviour with no framework in it. Every read and write is an MCP tool call
 * (query, validate, mutate) through a `ToolCaller`; a React, Vue or Svelte layer only renders
 * `getState()` and forwards user actions. There is no second API: this is the contract the CLI,
 * the evals and the AI SDK path call too.
 */

export interface ToolCaller {
  call<N extends WidgetToolName>(name: N, args: ToolInputs[N]): Promise<ToolOutputs[N]>;
}

/** The slice of an MCP SDK `Client` the widget needs, so a host bridge or a test double can stand in. */
export interface McpClientLike {
  /** Resolves to a `tools/call` result (`structuredContent`, `content`, `isError`); typed loosely so the SDK's result union fits. */
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<object>;
}

/** Adapts an MCP client (or any host bridge with `callTool`) to a `ToolCaller` over `tools/call`. */
export function mcpToolCaller(client: McpClientLike): ToolCaller {
  return {
    async call(name, args) {
      const result = (await client.callTool({ name, arguments: args as Record<string, unknown> })) as { structuredContent?: unknown; content?: unknown };
      if (result.structuredContent !== undefined && result.structuredContent !== null) {
        return result.structuredContent as never;
      }
      throw new Error(`The ${name} tool returned no structured result${describeContent(result.content)}. Check that the server is Strumentario and that your token allows ${name}.`);
    },
  };
}

function describeContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const text = content.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join(" ");
  return text ? `: ${text}` : "";
}

export type RequestState = "idle" | "pending" | "ready" | "failed";

export interface ValidationState {
  state: RequestState;
  valid: boolean;
  errors: string[];
}

export interface PreviewState {
  state: RequestState;
  /** The dry-run result from mutate (nothing was written). */
  result: MutateOutput | null;
  /** What the preview was computed for; a changed draft invalidates it. */
  draft: PageDraft | null;
  message: string | null;
}

export interface SaveState {
  state: "idle" | "saving" | "saved" | "failed";
  message: string | null;
  /** Set when the store refused the write because the page changed under the editor. */
  conflict: boolean;
}

export interface WidgetState {
  list: { state: RequestState; pages: StoredPage[]; total: number; filter: string; message: string | null };
  /** The page being edited: `new` has no stored counterpart, `edit` was opened at `base.revision`. */
  mode: "none" | "new" | "edit";
  base: StoredPage | null;
  draft: PageDraft | null;
  dirty: boolean;
  validation: ValidationState;
  preview: PreviewState;
  save: SaveState;
}

export interface WidgetControllerOptions {
  caller: ToolCaller;
  /** Pause after the last keystroke before validate runs. Default 250 ms; tests pass 0. */
  validateDelayMs?: number;
  /** Retry token for the write, so a repeated confirm never writes twice. Defaults to a random UUID. */
  newIdempotencyKey?: () => string;
}

export interface WidgetController {
  getState(): WidgetState;
  subscribe(listener: () => void): () => void;
  /** query: list pages, optionally filtered by text. */
  refresh(filter?: string): Promise<void>;
  /** query: open one page, with its current revision, for editing. */
  open(key: string): Promise<void>;
  startNew(): void;
  /** Changes one field of the draft and schedules a validate call. */
  edit(field: keyof PageDraft, value: string): void;
  /** validate: check the draft now (what the debounce does on its own). */
  validateNow(): Promise<void>;
  /** mutate with dryRun: true. Nothing is written. */
  requestPreview(): Promise<void>;
  /** mutate with dryRun: false. Only allowed for a draft whose dry-run preview succeeded. */
  confirmSave(): Promise<void>;
  /** Drops the draft and goes back to the list. */
  close(): void;
  /** Resolves once no validate, preview or save call is waiting on a timer or the server. */
  idle(): Promise<void>;
}

const IDLE_VALIDATION: ValidationState = { state: "idle", valid: false, errors: [] };
const IDLE_PREVIEW: PreviewState = { state: "idle", result: null, draft: null, message: null };
const IDLE_SAVE: SaveState = { state: "idle", message: null, conflict: false };

export function emptyDraft(): PageDraft {
  return Object.fromEntries(PAGE_FIELDS.map((field) => [field.name, ""])) as PageDraft;
}

function draftOf(page: StoredPage): PageDraft {
  return Object.fromEntries(PAGE_FIELDS.map((field) => [field.name, page[field.name]])) as PageDraft;
}

function sameDraft(a: PageDraft | null, b: PageDraft | null): boolean {
  return a !== null && b !== null && PAGE_FIELDS.every((field) => a[field.name] === b[field.name]);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWidgetController(options: WidgetControllerOptions): WidgetController {
  const { caller } = options;
  const delay = options.validateDelayMs ?? 250;
  const newKey = options.newIdempotencyKey ?? (() => globalThis.crypto.randomUUID());

  let state: WidgetState = {
    list: { state: "idle", pages: [], total: 0, filter: "", message: null },
    mode: "none",
    base: null,
    draft: null,
    dirty: false,
    validation: IDLE_VALIDATION,
    preview: IDLE_PREVIEW,
    save: IDLE_SAVE,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let validationRun = 0;
  let listRun = 0;
  let openRun = 0;
  let inflight = 0;
  const waiters: Array<() => void> = [];
  /** The write key for the draft currently being saved; reused on a repeated confirm. */
  let writeKey: { draft: PageDraft; key: string } | null = null;

  function set(patch: Partial<WidgetState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  /** Counts an operation as in flight until its last state update, so idle() never resolves early. */
  function tracked<A extends unknown[]>(operation: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
    return (...args) => {
      inflight += 1;
      return operation(...args).finally(() => {
        inflight -= 1;
        settle();
      });
    };
  }

  function settle(): void {
    if (inflight === 0 && timer === undefined) {
      for (const resolve of waiters.splice(0)) resolve();
    }
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function refresh(filter = state.list.filter): Promise<void> {
    const run = ++listRun;
    set({ list: { ...state.list, state: "pending", filter, message: null } });
    try {
      const result = await caller.call("query", filter.trim() === "" ? {} : { text: filter.trim() });
      if (run !== listRun) return;
      if (!result.ok || !result.pages) {
        set({ list: { ...state.list, state: "failed", message: result.error?.message ?? "The query tool returned no pages." } });
        return;
      }
      set({ list: { state: "ready", pages: result.pages, total: result.total ?? result.pages.length, filter, message: null } });
    } catch (error) {
      if (run !== listRun) return;
      set({ list: { ...state.list, state: "failed", message: messageOf(error) } });
    }
  }

  async function open(key: string): Promise<void> {
    const run = ++openRun;
    clearTimer();
    validationRun += 1;
    try {
      const result = await caller.call("query", { [KEY_FIELD]: key });
      if (run !== openRun) return;
      if (!result.ok || !result.page) {
        set({ save: { state: "failed", message: result.error?.message ?? `Page "${key}" was not found.`, conflict: false } });
        return;
      }
      set({
        mode: "edit",
        base: result.page,
        draft: draftOf(result.page),
        dirty: false,
        validation: IDLE_VALIDATION,
        preview: IDLE_PREVIEW,
        save: IDLE_SAVE,
      });
      writeKey = null;
      await validateNow();
    } catch (error) {
      if (run !== openRun) return;
      set({ save: { state: "failed", message: messageOf(error), conflict: false } });
    }
  }

  function startNew(): void {
    openRun += 1;
    clearTimer();
    validationRun += 1;
    writeKey = null;
    set({ mode: "new", base: null, draft: emptyDraft(), dirty: false, validation: IDLE_VALIDATION, preview: IDLE_PREVIEW, save: IDLE_SAVE });
  }

  function edit(field: keyof PageDraft, value: string): void {
    if (state.draft === null) return;
    // The key identifies the stored page, so it can only be chosen when creating one.
    if (state.mode === "edit" && field === KEY_FIELD) return;
    const draft = { ...state.draft, [field]: value };
    validationRun += 1;
    writeKey = null;
    set({
      draft,
      dirty: true,
      validation: { ...state.validation, state: "pending" },
      preview: IDLE_PREVIEW,
      save: IDLE_SAVE,
    });
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void trackedValidate();
    }, delay);
  }

  async function validateNow(): Promise<void> {
    clearTimer();
    const draft = state.draft;
    if (draft === null) return;
    const run = ++validationRun;
    set({ validation: { ...state.validation, state: "pending" } });
    try {
      const result = await caller.call("validate", { instance: draft });
      if (run !== validationRun) return; // a newer edit superseded this answer
      set({ validation: { state: "ready", valid: result.valid, errors: result.errors } });
    } catch (error) {
      if (run !== validationRun) return;
      set({ validation: { state: "failed", valid: false, errors: [messageOf(error)] } });
    }
  }

  function mutateArgs(draft: PageDraft, dryRun: boolean): MutateInput {
    const key = draft[KEY_FIELD];
    if (state.mode === "edit" && state.base) {
      return { action: "update", [KEY_FIELD]: state.base[KEY_FIELD], page: draft, dryRun, expectedRevision: state.base.revision } as MutateInput;
    }
    return { action: "create", [KEY_FIELD]: key, page: draft, dryRun } as MutateInput;
  }

  async function requestPreview(): Promise<void> {
    const draft = state.draft;
    if (draft === null) return;
    await validateNow();
    if (state.draft !== draft) return;
    if (!state.validation.valid) {
      set({ preview: { state: "failed", result: null, draft, message: "Fix the validation errors before previewing the save." } });
      return;
    }
    set({ preview: { state: "pending", result: null, draft, message: null }, save: IDLE_SAVE });
    try {
      const result = await caller.call("mutate", mutateArgs(draft, true));
      if (!sameDraft(state.draft, draft)) return;
      if (!result.ok) {
        set({ preview: { state: "failed", result, draft, message: result.error?.message ?? "The dry run was refused." } });
        return;
      }
      set({ preview: { state: "ready", result, draft, message: null } });
    } catch (error) {
      if (!sameDraft(state.draft, draft)) return;
      set({ preview: { state: "failed", result: null, draft, message: messageOf(error) } });
    }
  }

  async function confirmSave(): Promise<void> {
    const { draft, preview } = state;
    if (draft === null || preview.state !== "ready" || !sameDraft(preview.draft, draft) || preview.result?.ok !== true) {
      set({ save: { state: "failed", message: "Preview the change first: saving is only allowed for the draft you just previewed.", conflict: false } });
      return;
    }
    if (state.save.state === "saving") return;
    if (writeKey === null || !sameDraft(writeKey.draft, draft)) writeKey = { draft, key: newKey() };
    set({ save: { state: "saving", message: null, conflict: false } });
    try {
      const result = await caller.call("mutate", { ...mutateArgs(draft, false), idempotencyKey: writeKey.key });
      if (!result.ok || !result.page) {
        set({ save: { state: "failed", message: result.error?.message ?? "The write was refused.", conflict: result.error?.code === "conflict" || result.error?.code === "already_exists" } });
        return;
      }
      writeKey = null;
      set({
        mode: "edit",
        base: result.page,
        draft: draftOf(result.page),
        dirty: false,
        preview: IDLE_PREVIEW,
        save: { state: "saved", message: `Saved "${result.page[KEY_FIELD]}" at revision ${result.page.revision.slice(0, 8)}.`, conflict: false },
      });
      await refresh();
    } catch (error) {
      set({ save: { state: "failed", message: messageOf(error), conflict: false } });
    }
  }

  function close(): void {
    openRun += 1;
    clearTimer();
    validationRun += 1;
    writeKey = null;
    set({ mode: "none", base: null, draft: null, dirty: false, validation: IDLE_VALIDATION, preview: IDLE_PREVIEW, save: IDLE_SAVE });
    settle();
  }

  const trackedValidate = tracked(validateNow);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: tracked(refresh),
    open: tracked(open),
    startNew,
    edit,
    validateNow: trackedValidate,
    requestPreview: tracked(requestPreview),
    confirmSave: tracked(confirmSave),
    close,
    idle() {
      if (inflight === 0 && timer === undefined) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
