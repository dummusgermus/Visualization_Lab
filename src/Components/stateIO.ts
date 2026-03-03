import type { AppState, EnsembleStatistic, ChartLocation } from "../main";

/** The subset of AppState that is saved/loaded */
export type SavedState = {
    version: 1;
    // Map view
    mode: AppState["mode"];
    canvasView: AppState["canvasView"];
    scenario: AppState["scenario"];
    model: AppState["model"];
    variable: AppState["variable"];
    date: AppState["date"];
    resolution: AppState["resolution"];
    selectedUnit: AppState["selectedUnit"];
    mapPalette: AppState["mapPalette"];
    mapShowBorders: AppState["mapShowBorders"];
    mapShowCities: AppState["mapShowCities"];
    // Chart view
    chartMode: AppState["chartMode"];
    chartDate: AppState["chartDate"];
    chartRangeStart: AppState["chartRangeStart"];
    chartRangeEnd: AppState["chartRangeEnd"];
    chartVariable: AppState["chartVariable"];
    chartUnit: AppState["chartUnit"];
    chartPalette: AppState["chartPalette"];
    chartScenarios: AppState["chartScenarios"];
    chartModels: AppState["chartModels"];
    chartLocation: ChartLocation;
    chartLocationName: AppState["chartLocationName"];
    chartPoint: AppState["chartPoint"];
    chartPolygon: AppState["chartPolygon"];
    // Compare mode
    compareMode: AppState["compareMode"];
    compareScenarioA: AppState["compareScenarioA"];
    compareScenarioB: AppState["compareScenarioB"];
    compareModelA: AppState["compareModelA"];
    compareModelB: AppState["compareModelB"];
    compareDateStart: AppState["compareDateStart"];
    compareDateEnd: AppState["compareDateEnd"];
    // Ensemble mode
    ensembleScenarios: AppState["ensembleScenarios"];
    ensembleModels: AppState["ensembleModels"];
    ensembleStatistic: EnsembleStatistic;
    ensembleDate: AppState["ensembleDate"];
    ensembleVariable: AppState["ensembleVariable"];
    ensembleUnit: AppState["ensembleUnit"];
    // Masks
    masks: AppState["masks"];
    // Chat model
    selectedChatModel: AppState["selectedChatModel"];
};

export function exportState(state: AppState): SavedState {
    return {
        version: 1,
        mode: state.mode,
        canvasView: state.canvasView,
        scenario: state.scenario,
        model: state.model,
        variable: state.variable,
        date: state.date,
        resolution: state.resolution,
        selectedUnit: state.selectedUnit,
        mapPalette: state.mapPalette,
        mapShowBorders: state.mapShowBorders,
        mapShowCities: state.mapShowCities,
        chartMode: state.chartMode,
        chartDate: state.chartDate,
        chartRangeStart: state.chartRangeStart,
        chartRangeEnd: state.chartRangeEnd,
        chartVariable: state.chartVariable,
        chartUnit: state.chartUnit,
        chartPalette: state.chartPalette,
        chartScenarios: state.chartScenarios,
        chartModels: state.chartModels,
        chartLocation: state.chartLocation,
        chartLocationName: state.chartLocationName,
        chartPoint: state.chartPoint,
        chartPolygon: state.chartPolygon,
        compareMode: state.compareMode,
        compareScenarioA: state.compareScenarioA,
        compareScenarioB: state.compareScenarioB,
        compareModelA: state.compareModelA,
        compareModelB: state.compareModelB,
        compareDateStart: state.compareDateStart,
        compareDateEnd: state.compareDateEnd,
        ensembleScenarios: state.ensembleScenarios,
        ensembleModels: state.ensembleModels,
        ensembleStatistic: state.ensembleStatistic,
        ensembleDate: state.ensembleDate,
        ensembleVariable: state.ensembleVariable,
        ensembleUnit: state.ensembleUnit,
        masks: state.masks.map((m) => ({ ...m })),
        selectedChatModel: state.selectedChatModel,
    };
}

export function applyImportedState(
    target: AppState,
    saved: SavedState,
): void {
    if (!saved || saved.version !== 1) {
        throw new Error("Unsupported or invalid state file format.");
    }
    target.mode = saved.mode;
    target.canvasView = saved.canvasView;
    target.scenario = saved.scenario;
    target.model = saved.model;
    target.variable = saved.variable;
    target.date = saved.date;
    target.resolution = saved.resolution;
    target.selectedUnit = saved.selectedUnit;
    target.mapPalette = saved.mapPalette;
    target.mapShowBorders = saved.mapShowBorders;
    target.mapShowCities = saved.mapShowCities;
    target.chartMode = saved.chartMode;
    target.chartDate = saved.chartDate;
    target.chartRangeStart = saved.chartRangeStart;
    target.chartRangeEnd = saved.chartRangeEnd;
    target.chartVariable = saved.chartVariable;
    target.chartUnit = saved.chartUnit;
    target.chartPalette = saved.chartPalette;
    target.chartScenarios = saved.chartScenarios;
    target.chartModels = saved.chartModels;
    target.chartLocation = saved.chartLocation;
    target.chartLocationName = saved.chartLocationName;
    target.chartPoint = saved.chartPoint ?? null;
    target.chartPolygon = saved.chartPolygon ?? null;
    target.compareMode = saved.compareMode;
    target.compareScenarioA = saved.compareScenarioA;
    target.compareScenarioB = saved.compareScenarioB;
    target.compareModelA = saved.compareModelA;
    target.compareModelB = saved.compareModelB;
    target.compareDateStart = saved.compareDateStart;
    target.compareDateEnd = saved.compareDateEnd;
    target.ensembleScenarios = saved.ensembleScenarios;
    target.ensembleModels = saved.ensembleModels;
    target.ensembleStatistic = saved.ensembleStatistic;
    target.ensembleDate = saved.ensembleDate;
    target.ensembleVariable = saved.ensembleVariable;
    target.ensembleUnit = saved.ensembleUnit;
    target.masks = (saved.masks ?? []).map((m) => ({ ...m }));
    if (saved.selectedChatModel) {
        target.selectedChatModel = saved.selectedChatModel;
    }
    // Reset derived/cached data so a fresh load is triggered after import
    target.currentData = null;
    target.dataMin = null;
    target.dataMax = null;
    target.dataMean = null;
    target.ensembleStatistics = null;
    target.ensembleStatisticRanges = new Map();
    target.ensembleStatisticsByVariable = new Map();
    target.ensembleStatisticRangesByVariable = new Map();
    target.ensembleRawSamplesByVariable = new Map();
    target.maskVariableData = new Map();
    target.maskVariableRanges = new Map();
    target.chartSamples = [];
    target.chartBoxes = null;
    target.chartRangeSeries = null;
    target.chartLoading = false;
    target.chartError = null;
    target.mapInfoOpen = false;
    target.mapRangeOpen = false;
    target.mapMarker = null;
    target.mapPolygon = null;
    target.drawState = { active: false, points: [], previewPoint: null };
    target.pointSelectActive = false;
}

export function downloadStateAsJson(state: AppState): void {
    const saved = exportState(state);
    const json = JSON.stringify(saved, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
    a.href = url;
    a.download = `polyoracle-state-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function triggerImportJson(
    onLoaded: (saved: SavedState) => void,
    onError: (message: string) => void,
): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as SavedState;
                onLoaded(parsed);
            } catch {
                onError("Could not parse the selected file. Make sure it is a valid Polyoracle state JSON.");
            }
        };
        reader.onerror = () => {
            onError("Failed to read the file.");
        };
        reader.readAsText(file);
    });
    input.click();
}
