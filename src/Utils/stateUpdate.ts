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
    if (newState.mode === "Explore") {
        if (newState.selectedDate) {
            updates.date = newState.selectedDate;
        }
        if (newState.selectedModel) {
            updates.model = newState.selectedModel;
        } else if (newState.model) {
            updates.model = newState.model;
        }
        if (newState.selectedScenario) {
            updates.scenario = normalizeScenarioLabel(
                newState.selectedScenario,
            );
        }
        if (newState.variable) {
            updates.variable = newState.variable;
        }
    }
    if (newState.palette) {
        updates.palette = newState.palette;
    }

    // Compare mode fields
    if (newState.mode === "Compare") {
        if (newState.selectedDate) {
            updates.date = newState.selectedDate;
        }
        if (newState.compareMode) {
            updates.compareMode = newState.compareMode;
        }
        if (newState.scenario1) {
            updates.compareScenarioA = normalizeScenarioLabel(
                newState.scenario1,
            );
        }
        if (newState.scenario2) {
            updates.compareScenarioB = normalizeScenarioLabel(
                newState.scenario2,
            );
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
        updates.chartScenarios = newState.scenarios;
    }
    if (newState.colorPalette) {
        updates.mapPalette = normalizeColorPalette(newState.colorPalette);
    }
    if (newState.selectedUnit) {
        updates.selectedUnit = newState.selectedUnit;
    }
    if (newState.masks) {
        const processedMasks = newState.masks.map((mask: any) => ({
            id: mask.id,
            variable: mask.variable,
            unit: mask.unit,
            lowerBound: mask.lowerBound ?? null,
            upperBound: mask.upperBound ?? null,
            lowerEdited: mask.lowerBound != null,
            upperEdited: mask.upperBound != null,
            statistic: mask.statistic,
            kind: mask.kind ?? "binary",
            probabilityThreshold: mask.probabilityThreshold,
        }));
        
        // Map masks to mode-specific array based on target mode
        if (newState.mode === "Ensemble") {
            updates.ensembleMasks = processedMasks;
        } else if (newState.mode === "Compare") {
            updates.compareMasks = processedMasks;
        } else {
            updates.exploreMasks = processedMasks;
        }
    }
    if (newState.mode === "Ensemble") {
        if (newState.selectedScenarios) {
            updates.ensembleScenarios = newState.selectedScenarios.map(
                normalizeScenarioLabel,
            );
        }
        if (newState.selectedModels) {
            updates.ensembleModels = newState.selectedModels;
        }
        if (newState.selectedDate) {
            updates.ensembleDate = newState.selectedDate;
        }
        if (newState.selectedUnit) {
            updates.ensembleUnit = newState.selectedUnit;
        }
        if (newState.variable) {
            updates.ensembleVariable = newState.variable;
        }
        if (newState.ensembleStatistic) {
            updates.ensembleStatistic = newState.ensembleStatistic;
        }
    }

    if (newState.canvasView) {
        updates.canvasView = newState.canvasView.toLowerCase();
    }

    // Split view
    if (typeof newState.splitView === "boolean") {
        updates.splitView = newState.splitView;
    }

    // Map location / range view (set by agent via set_map_location)
    if (newState.mapMarker && typeof newState.mapMarker === "object") {
        updates.mapMarker = newState.mapMarker;  // { lat, lon, name, pixel }
    }
    if (typeof newState.mapInfoOpen === "boolean") {
        updates.mapInfoOpen = newState.mapInfoOpen;
    }
    if (typeof newState.mapRangeOpen === "boolean") {
        updates.mapRangeOpen = newState.mapRangeOpen;
    }
    if (typeof newState.mapRangeStart === "string") {
        updates.mapRangeStart = newState.mapRangeStart;
    }
    if (typeof newState.mapRangeEnd === "string") {
        updates.mapRangeEnd = newState.mapRangeEnd;
    }

    // Window 2 configuration (partial update – only override fields that were explicitly provided)
    if (newState.window2 && typeof newState.window2 === "object") {
        const w2 = newState.window2 as Record<string, unknown>;
        const window2Updates: Record<string, unknown> = {};
        if (typeof w2.scenario === "string") {
            window2Updates.scenario = normalizeScenarioLabel(w2.scenario);
        }
        if (typeof w2.model === "string") {
            window2Updates.model = w2.model;
        }
        if (typeof w2.variable === "string") {
            window2Updates.variable = w2.variable;
        }
        if (typeof w2.selectedUnit === "string") {
            window2Updates.selectedUnit = w2.selectedUnit;
        }
        if (typeof w2.date === "string") {
            window2Updates.date = w2.date;
        }
        if (typeof w2.mode === "string") {
            window2Updates.mode = w2.mode;
        }
        if (typeof w2.colorPalette === "string") {
            window2Updates.mapPalette = normalizeColorPalette(w2.colorPalette);
        }
        // Map location / range view for Window 2
        if (w2.mapMarker && typeof w2.mapMarker === "object") {
            window2Updates.mapMarker = w2.mapMarker;
        }
        if (typeof w2.mapInfoOpen === "boolean") {
            window2Updates.mapInfoOpen = w2.mapInfoOpen;
        }
        if (typeof w2.mapRangeOpen === "boolean") {
            window2Updates.mapRangeOpen = w2.mapRangeOpen;
        }
        if (typeof w2.mapRangeStart === "string") {
            window2Updates.mapRangeStart = w2.mapRangeStart;
        }
        if (typeof w2.mapRangeEnd === "string") {
            window2Updates.mapRangeEnd = w2.mapRangeEnd;
        }
        if (Object.keys(window2Updates).length > 0) {
            updates.window2 = window2Updates;
        }
    }

    if (Object.keys(updates).length > 0) {
        console.log("Applying state updates from backend:", updates);
        globalStateUpdateCallback(updates);
    }
}
