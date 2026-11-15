import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createWidgetController, type ToolCaller, type WidgetController, type WidgetState } from "../controller.js";

/** Subscribes a component to a framework-neutral controller. The only React-specific state logic in the package. */
export function useWidgetState(controller: WidgetController): WidgetState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

/** Creates a controller for a caller and loads the page list once. */
export function usePageWidget(caller: ToolCaller, validateDelayMs?: number): { controller: WidgetController; state: WidgetState } {
  const controller = useMemo(
    () => createWidgetController({ caller, ...(validateDelayMs === undefined ? {} : { validateDelayMs }) }),
    [caller, validateDelayMs],
  );
  useEffect(() => {
    void controller.refresh();
  }, [controller]);
  return { controller, state: useWidgetState(controller) };
}
