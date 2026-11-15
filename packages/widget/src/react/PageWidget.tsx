import type { FormEvent } from "react";
import { KEY_FIELD, PAGE_FIELDS, TOOL_META, type PageDraft } from "../generated/contracts.js";
import type { ToolCaller, WidgetController, WidgetState } from "../controller.js";
import { usePageWidget } from "./use-widget.js";

export interface PageWidgetProps {
  caller: ToolCaller;
  /** Fields rendered as a multi-line box. Presentation only; the field list itself comes from the contracts. */
  multilineFields?: ReadonlyArray<keyof PageDraft>;
  validateDelayMs?: number;
}

/** The whole widget: a page list on one side, an editor with live validation and a dry-run preview on the other. */
export function PageWidget({ caller, multilineFields = ["body"], validateDelayMs }: PageWidgetProps) {
  const { controller, state } = usePageWidget(caller, validateDelayMs);
  return (
    <div className="sw-root" data-testid="page-widget">
      <PageList controller={controller} state={state} />
      {state.mode === "none" ? (
        <p className="sw-empty">Pick a page to edit, or create one.</p>
      ) : (
        <PageEditor controller={controller} state={state} multilineFields={multilineFields} />
      )}
    </div>
  );
}

interface ViewProps {
  controller: WidgetController;
  state: WidgetState;
}

export function PageList({ controller, state }: ViewProps) {
  const { list } = state;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void controller.refresh(String(data.get("filter") ?? ""));
  };
  return (
    <section className="sw-list" aria-label="Pages">
      <h2>{TOOL_META.query.title}</h2>
      <form onSubmit={submit} role="search">
        <input name="filter" defaultValue={list.filter} placeholder="Filter by text" aria-label="Filter pages" />
        <button type="submit">Search</button>
        <button type="button" onClick={() => controller.startNew()}>
          New page
        </button>
      </form>
      {list.state === "pending" && <p role="status">Loading pages…</p>}
      {list.state === "failed" && <p role="alert">{list.message}</p>}
      {list.state === "ready" && (
        <>
          <p className="sw-count">
            {list.pages.length} of {list.total} {list.total === 1 ? "page" : "pages"}
          </p>
          <ul>
            {list.pages.map((page) => (
              <li key={page[KEY_FIELD]}>
                <button
                  type="button"
                  aria-current={state.base?.[KEY_FIELD] === page[KEY_FIELD]}
                  onClick={() => void controller.open(page[KEY_FIELD])}
                >
                  <strong>{page.title}</strong> <code>{page[KEY_FIELD]}</code>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function PageEditor({ controller, state, multilineFields }: ViewProps & { multilineFields: ReadonlyArray<keyof PageDraft> }) {
  const { draft, validation, preview, save, mode } = state;
  if (draft === null) return null;
  const canPreview = validation.state === "ready" && validation.valid && preview.state !== "pending";
  const canSave = preview.state === "ready" && save.state !== "saving";
  return (
    <section className="sw-editor" aria-label="Editor">
      <h2>{mode === "new" ? "New page" : `Editing ${state.base?.[KEY_FIELD] ?? ""}`}</h2>
      {PAGE_FIELDS.map((field) => {
        const locked = mode === "edit" && field.name === KEY_FIELD;
        const common = {
          id: `sw-${field.name}`,
          value: draft[field.name],
          disabled: locked,
          onChange: (event: { target: { value: string } }) => controller.edit(field.name, event.target.value),
        };
        return (
          <div key={field.name} className="sw-field">
            <label htmlFor={common.id}>{field.name}</label>
            {multilineFields.includes(field.name) ? <textarea rows={8} {...common} /> : <input {...common} />}
          </div>
        );
      })}

      <div className="sw-validation" role="status" aria-live="polite" data-state={validation.state}>
        {validation.state === "pending" && "Validating…"}
        {validation.state === "ready" && validation.valid && "Valid."}
        {validation.state === "ready" && !validation.valid && (
          <ul aria-label="Validation errors">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {validation.state === "failed" && <span role="alert">{validation.errors.join(" ")}</span>}
      </div>

      <div className="sw-actions">
        <button type="button" disabled={!canPreview} onClick={() => void controller.requestPreview()}>
          Preview save (dry run)
        </button>
        <button type="button" disabled={!canSave} onClick={() => void controller.confirmSave()}>
          Save
        </button>
        <button type="button" onClick={() => controller.close()}>
          Close
        </button>
      </div>

      {preview.state === "pending" && <p role="status">Running dry run…</p>}
      {preview.state === "failed" && <p role="alert">{preview.message}</p>}
      {preview.state === "ready" && preview.result?.ok && <PreviewPanel state={state} />}

      {save.state === "saved" && <p role="status">{save.message}</p>}
      {save.state === "failed" && (
        <p role="alert">
          {save.message}
          {save.conflict && state.base && (
            <>
              {" "}
              <button type="button" onClick={() => void controller.open(state.base![KEY_FIELD])}>
                Reload latest
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** What the dry run says would change; nothing has been written yet. */
export function PreviewPanel({ state }: { state: WidgetState }) {
  const result = state.preview.result;
  if (!result?.ok || !result.page) return null;
  const before = result.previous;
  const after = result.page;
  return (
    <div className="sw-preview" aria-label="Dry-run preview">
      <p>
        <strong>Dry run — nothing written yet.</strong> {result.action === "create" ? "Would create" : "Would update"} <code>{result.slug}</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Now</th>
            <th>After save</th>
          </tr>
        </thead>
        <tbody>
          {PAGE_FIELDS.map((field) => {
            const was = before?.[field.name];
            const changed = was !== after[field.name];
            return (
              <tr key={field.name} data-changed={changed}>
                <td>{field.name}</td>
                <td>{was ?? "—"}</td>
                <td>{after[field.name]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
