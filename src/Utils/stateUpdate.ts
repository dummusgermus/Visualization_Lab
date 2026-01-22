/**
 * Maps backend state updates to frontend AppState and triggers re-render
 */

import { normalizeColorPalette, normalizeScenarioLabel } from "../main";

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
    if (newState.mode) {
        updates.mode = newState.mode;
    }
    if (newState.model) {
        updates.model = newState.model;
    }
    if (newState.selectedScenario) {
        updates.scenario = newState.selectedScenario;
    }
    if (newState.selectedDate) {
        updates.date = newState.selectedDate;
    }
    if (newState.variable) {
        updates.variable = newState.variable;
    }
    if (newState.palette) {
        updates.palette = newState.palette;
    }

    // Compare mode fields
    if (newState.compareMode) {
        updates.compareMode = newState.compareMode;
    }
    if (newState.scenario1) {
        updates.compareScenarioA = newState.scenario1;
    }
    if (newState.scenario2) {
        updates.compareScenarioB = newState.scenario2;
    }
    if (newState.model1) {
        updates.compareModelA = newState.model1;
    }
    if (newState.model2) {
        updates.compareModelB = newState.model2;
    }
    if (newState.date1) {
        updates.compareDateStart = newState.date1;
    }
    if (newState.date2) {
        updates.compareDateEnd = newState.date2;
    }

    // Chart mode fields
    if (newState.chartMode) {
        updates.chartMode = newState.chartMode;
    }
    if (newState.chartDate) {
        updates.chartDate = newState.chartDate;
    }
    if (newState.location) {
        updates.chartLocation = newState.location;
    }
    if (newState.start_date) {
        updates.chartRangeStart = newState.start_date;
    }
    if (newState.end_date) {
        updates.chartRangeEnd = newState.end_date;
    }
    if (newState.models) {
        updates.chartModels = newState.models;
    }
    if (newState.scenarios) {
        updates.chartScenarios = newState.scenarios.map((s: string) =>
            normalizeScenarioLabel(s),
        );
    }
    if (newState.colorPalette) {
        updates.colorPalette = normalizeColorPalette(newState.colorPalette);
    }

    if (newState.canvasView) {
        updates.canvasView = newState.canvasView.toLowerCase();
    }

    if (Object.keys(updates).length > 0) {
        console.log("Applying state updates from backend:", updates);
        globalStateUpdateCallback(updates);
    }
}
