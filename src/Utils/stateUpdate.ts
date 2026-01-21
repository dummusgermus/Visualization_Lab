/**
 * Maps backend state updates to frontend AppState and triggers re-render
 */

import { normalizeScenarioLabel } from "../main";

export type StateUpdateCallback = (updates: Record<string, any>) => void;

let globalStateUpdateCallback: StateUpdateCallback | null = null;

/**
 * Register a callback that will be called when state updates are received from the backend
 */
export function registerStateUpdateCallback(
    callback: StateUpdateCallback,
): void {
    globalStateUpdateCallback = callback;
}

/**
 * Apply state updates from the backend to the application state
 * Maps backend field names to frontend AppState field names
 */
export function updateState(
    newState: Record<string, any> | null | undefined,
): void {
    if (!newState || !globalStateUpdateCallback) {
        return;
    }

    const updates: Record<string, any> = {};

    // Map backend fields to frontend fields
    if (newState.mode !== undefined) {
        updates.mode = newState.mode;
    }
    if (newState.model !== undefined) {
        updates.model = newState.model;
    }
    if (newState.selectedScenario !== undefined) {
        updates.scenario = newState.selectedScenario;
    }
    if (newState.selectedDate !== undefined) {
        updates.date = newState.selectedDate;
    }
    if (newState.variable !== undefined) {
        updates.variable = newState.variable;
    }
    if (newState.palette !== undefined) {
        updates.palette = newState.palette;
    }

    // Compare mode fields
    if (newState.compareMode !== undefined) {
        updates.compareMode = newState.compareMode;
    }
    if (newState.scenario1 !== undefined) {
        updates.compareScenarioA = newState.scenario1;
    }
    if (newState.scenario2 !== undefined) {
        updates.compareScenarioB = newState.scenario2;
    }
    if (newState.model1 !== undefined) {
        updates.compareModelA = newState.model1;
    }
    if (newState.model2 !== undefined) {
        updates.compareModelB = newState.model2;
    }
    if (newState.date1 !== undefined) {
        updates.compareDateStart = newState.date1;
    }
    if (newState.date2 !== undefined) {
        updates.compareDateEnd = newState.date2;
    }

    // Chart mode fields
    if (newState.chartMode !== undefined) {
        updates.chartMode = newState.chartMode;
        updates.canvasView = "chart";
    }
    if (newState.chartDate !== undefined) {
        updates.chartDate = newState.chartDate;
    }
    if (newState.location !== undefined) {
        updates.chartLocation = newState.location;
    }
    if (newState.start_date !== undefined) {
        updates.chartRangeStart = newState.start_date;
    }
    if (newState.end_date !== undefined) {
        updates.chartRangeEnd = newState.end_date;
    }
    if (newState.models !== undefined) {
        updates.chartModels = newState.models;
    }
    if (newState.scenarios !== undefined) {
        updates.chartScenarios = newState.scenarios.map((s: string) =>
            normalizeScenarioLabel(s),
        );
    }

    if (Object.keys(updates).length > 0) {
        console.log("Applying state updates from backend:", updates);
        globalStateUpdateCallback(updates);
    }
}
