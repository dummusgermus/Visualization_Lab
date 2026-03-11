import * as d3 from "d3";
import {
    attachChatHandlers,
    type ChatMessage,
    renderChatSection,
} from "./Components/agentChat";
import {
    attachSidebarHandlers,
    renderSidebarToggle,
    SIDEBAR_WIDTH,
} from "./Components/sidebar";
import {
    completeCurrentStep,
    endTutorial,
    getTutorialState,
    renderTutorialOverlay,
    startTutorial,
    TUTORIAL_STEPS,
} from "./Components/tutorial";
import { drawLegendGradient, renderMapLegend } from "./MapView/legend";
import {
    applyMapTransform,
    applyW2MapTransform,
    clearW2Cache,
    getCurrentZoomLevel,
    getMapTransform,
    getW2MapTransform,
    isW2CacheReady,
    projectLonLatToCanvas,
    projectLonLatToCanvasW2,
    renderMapData,
    renderMapDataWindow2,
    resizeMapCanvas,
    resizeWindow2Canvas,
    setMapOverlayVisibility,
    setupMapInteractions,
    setupWindow2Interactions,
    zoomToLocation,
    zoomToLocationW2,
    setMapOverlayVisibilityW2,
} from "./MapView/map";
import {
    attachTimeSliderHandlers,
    renderTimeSlider,
    updateTimeSliderPosition,
} from "./MapView/timeSlider";
import "./style.css";
import {
    type ChartBox,
    type ChartSample,
    type ChartSeries,
    type ChartStats,
} from "./types/chartTypes";
import {
    checkApiHealth,
    type ClimateData,
    createDataRequest,
    DataClientError,
    dataToArray,
    fetchAggregateOnDemand,
    fetchClimateData,
    fetchMetadata,
    fetchPixelData,
    fetchPixelDataStream,
    type Metadata,
    normalizeScenario,
} from "./Utils/dataClient";
import {
    flattenSeriesToSamples,
    generateToyRangeSeries,
} from "./Utils/mockChartData";
import { registerStateUpdateCallback } from "./Utils/stateUpdate";
import { openExportDialog } from "./Components/exportDialog";
import { captureThumbnailDataUrl } from "./Utils/screenshot";
import {
    convertMinMax,
    convertValue,
    getDefaultUnitOption,
    getUnitOptions,
    unconvertValue,
} from "./Utils/unitConverter";

// Toggle to switch between real API data and toy mock chart data (range mode)
const USE_TOY_RANGE_DATA = false;

// Maximum simultaneous in-flight requests to the Python API server.
// Each /pixel-data request runs up to MAX_WORKERS (6) server threads.
// With step_days=365, each request is ~150 annual reads — much lighter
// than the previous daily step, so we can safely run more in parallel.
const PARALLEL_REQUEST_LIMIT = 8;

/**
 * Minimal concurrency limiter: runs task factories with at most `limit` in-flight.
 * Like the popular `p-limit` package but with no dependency.
 */
function pLimit<T>(
    tasks: (() => Promise<T>)[],
    limit: number,
): Promise<PromiseSettledResult<T>[]> {
    return new Promise((resolve) => {
        const results: PromiseSettledResult<T>[] = new Array(tasks.length);
        let started = 0;
        let finished = 0;
        function next() {
            if (finished === tasks.length) { resolve(results); return; }
            while (started - finished < limit && started < tasks.length) {
                const idx = started++;
                tasks[idx]()
                    .then((value) => { results[idx] = { status: "fulfilled", value }; })
                    .catch((reason) => { results[idx] = { status: "rejected", reason }; })
                    .finally(() => { finished++; next(); });
            }
        }
        next();
    });
}
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

type Mode = "Explore" | "Compare" | "Ensemble";
type PanelTab = "Manual" | "Chat";
type CanvasView = "map" | "chart";
type CompareMode = "Scenarios" | "Models" | "Dates";
type ChartMode = "single" | "range";
export type ChartLocation = "World" | "Draw" | "Point" | "Search";
type LocationSearchResult = {
    displayName: string;
    lat: number;
    lon: number;
};

type LatLon = { lat: number; lon: number };
type MapMarker = {
    lat: number;
    lon: number;
    name: string | null;
    pixel: { x: number; y: number };
};
type DrawState = {
    active: boolean;
    points: LatLon[];
    previewPoint: LatLon | null;
};

type ChartDropdownState = {
    scenariosOpen: boolean;
    modelsOpen: boolean;
};

export type EnsembleStatistic =
    | "mean"
    | "std"
    | "median"
    | "iqr"
    | "percentile"
    | "extremes";

type ChartLoadingProgress = {
    total: number;
    done: number;
};

function applyChartLayoutOffset(offset: number, scale?: number) {
    const containers = document.querySelectorAll<HTMLElement>(
        "[data-role='chart-container']",
    );
    containers.forEach((el) => {
        el.style.transition =
            "padding 220ms ease, padding-right 220ms ease, transform 220ms ease";
        el.style.paddingRight = `${offset}px`;
        if (typeof scale === "number") {
            el.style.transform = `scale(${scale})`;
            el.style.transformOrigin = "center center";
        }
    });
}

export function normalizeScenarioLabel(input: string): string {
    if (input == null) return "";
    const lower = input.toLowerCase();
    if (lower === "historical") return "Historical";
    if (lower === "ssp245") return "SSP245";
    if (lower === "ssp370") return "SSP370";
    if (lower === "ssp585") return "SSP585";
    return input;
}

export function normalizeColorPalette(input: string): string {
    if (input == null) return "";
    const lower = input.toLowerCase();
    if (lower === "viridis") return "Viridis";
    if (lower === "magma") return "Magma";
    if (lower === "cividis") return "Cividis";
    if (lower === "thermal") return "Thermal";
    return input;
}

function parseDate(date: string): Date {
    return new Date(date);
}

function intersectScenarioRange(scenarioList: string[]): {
    start: string;
    end: string;
} {
    if (!scenarioList.length) {
        return getTimeRangeForScenario("Historical");
    }
    let start = "1900-01-01";
    let end = "2100-12-31";
    scenarioList.forEach((scenario, idx) => {
        const range = getTimeRangeForScenario(scenario);
        if (idx === 0) {
            start = range.start;
            end = range.end;
            return;
        }
        start = parseDate(range.start) > parseDate(start) ? range.start : start;
        end = parseDate(range.end) < parseDate(end) ? range.end : end;
    });
    return { start, end };
}

function clipDateToRange(date: string, range: { start: string; end: string }) {
    const input = parseDate(date);
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    if (input < start) return range.start;
    if (input > end) return range.end;
    return date;
}

function buildMapRangeForPreset(
    preset: string,
    refDate: string,
): { start: string; end: string } | null {
    if (preset === "custom") return null;
    const parsed = parseDate(refDate);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = parsed.getMonth();
    const pad = (n: number) => String(n).padStart(2, "0");
    if (preset === "1month") {
        const lastDay = new Date(year, month + 1, 0).getDate();
        return {
            start: `${year}-${pad(month + 1)}-01`,
            end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
        };
    }
    if (preset === "1year") {
        return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    if (preset === "10years") {
        const startYear = Math.max(1950, year - 5);
        const endYear = Math.min(2099, year + 5);
        return { start: `${startYear}-01-01`, end: `${endYear}-12-31` };
    }
    if (preset === "full") {
        return { start: "1950-01-01", end: "2099-12-31" };
    }
    return null;
}

function buildMapRangeWindow(date: string): { start: string; end: string } {
    const parsed = parseDate(date);
    if (Number.isNaN(parsed.getTime())) {
        return { start: "2015-01-01", end: "2015-12-31" };
    }
    const year = parsed.getFullYear();
    return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
    };
}

type Style = Record<string, string | number>;

const scenarios = ["Historical", "SSP245", "SSP370", "SSP585"];
const models = [
    "ACCESS-CM2",
    "CanESM5",
    "CESM2",
    "CMCC-CM2-SR5",
    "EC-Earth3",
    "GFDL-ESM4",
    "INM-CM5-0",
    "IPSL-CM6A-LR",
    "MIROC6",
    "MPI-ESM1-2-HR",
    "MRI-ESM2-0",
];

const variables = [
    "tas",
    "pr",
    "rsds",
    "hurs",
    "rlds",
    "sfcWind",
    "tasmin",
    "tasmax",
];

// Information content for scenarios
const scenarioInfo: Record<string, string> = {
    SSP245: "A moderate scenario (2015-2100) that assumes we take active measures against climate change. This represents a realistic path where significant climate protection policies are implemented, leading to moderate warming by the end of the century.",
    SSP370: "A moderate-to-high scenario (2015-2100) representing a middle ground. This path assumes some climate action is taken, but not enough to prevent substantial warming. It falls between optimistic and pessimistic outcomes.",
    SSP585: "A pessimistic scenario (2015-2100) representing a worst-case path with minimal climate action. This shows what happens if we continue with current trends and take little to no measures against climate change, leading to severe warming.",
    Historical:
        "Historical climate simulation (1950-2014) based on past conditions. This represents simulated climate data for the historical period, used as a baseline to compare against future projections.",
};

// Full names for variables
const variableFullNames: Record<string, string> = {
    tas: "Near-Surface Air Temperature",
    pr: "Precipitation",
    rsds: "Surface Downwelling Shortwave Radiation",
    hurs: "Near-Surface Relative Humidity",
    rlds: "Surface Downwelling Longwave Radiation",
    sfcWind: "Daily-Mean Near-Surface Wind Speed",
    tasmin: "Daily Minimum Near-Surface Air Temperature",
    tasmax: "Daily Maximum Near-Surface Air Temperature",
};

// Information content for variables
const variableInfo: Record<string, string> = {
    tas: "The air temperature near the Earth's surface, measured in Kelvin.",
    pr: "The amount of water that falls from the atmosphere to the surface, measured as mass per unit area per unit time.",
    rsds: "Incoming solar radiation reaching the Earth's surface, measured in Watts per square meter.",
    hurs: "The amount of moisture in the air relative to the maximum it can hold, expressed as a percentage.",
    rlds: "Incoming thermal radiation from the atmosphere, measured in Watts per square meter.",
    sfcWind:
        "The average wind speed near the surface over a day, measured in meters per second.",
    tasmin: "The lowest air temperature near the surface during a day, measured in Kelvin.",
    tasmax: "The highest air temperature near the surface during a day, measured in Kelvin.",
};

// Information content for models
const modelInfo: Record<string, string> = {
    "ACCESS-CM2":
        "Developed by Australia's research institutions. This model is part of the global CMIP6 ensemble, providing climate projections that contribute to our understanding of future climate patterns.",
    CanESM5:
        "The Canadian Earth System Model version 5, developed by Environment and Climate Change Canada. This model represents North American climate research and contributes valuable projections to the global climate science community.",
    CESM2: "The Community Earth System Model version 2, developed by the National Center for Atmospheric Research (NCAR) in the United States. One of the most widely used models in climate research, known for its comprehensive representation of Earth's climate system.",
    "CMCC-CM2-SR5":
        "Developed by the Euro-Mediterranean Center on Climate Change (CMCC) in Italy. This model provides European perspectives on climate change and is particularly valuable for understanding Mediterranean and European climate patterns.",
    "EC-Earth3":
        "A collaborative European climate model developed by multiple research institutions across Europe. This model combines expertise from various European countries to provide comprehensive climate projections.",
    "GFDL-ESM4":
        "Developed by NOAA's Geophysical Fluid Dynamics Laboratory in the United States. This model is known for its advanced representation of ocean and atmosphere interactions, providing detailed climate projections.",
    "INM-CM5-0":
        "Developed by the Institute of Numerical Mathematics in Russia. This model contributes a unique perspective from Russian climate research to the global ensemble of climate models.",
    "IPSL-CM6A-LR":
        "Developed by the Institut Pierre-Simon Laplace in France. This model is part of a long-standing French climate modeling tradition and provides important contributions to understanding global climate dynamics.",
    MIROC6: "Developed by a Japanese research consortium. This model represents Asian climate research expertise and contributes valuable insights, particularly for understanding climate patterns in the Asia-Pacific region.",
    "MPI-ESM1-2-HR":
        "Developed by the Max Planck Institute in Germany. This high-resolution model provides detailed climate projections and is known for its sophisticated representation of Earth's climate system.",
    "MRI-ESM2-0":
        "Developed by Japan's Meteorological Research Institute. This model contributes Japanese climate research expertise to the global ensemble, providing valuable perspectives on climate change projections.",
};

const paletteOptions = [
    {
        name: "Viridis",
        colors: ["#440154", "#3b528b", "#21908d", "#5dc863", "#fde725"],
    },
    {
        name: "Plasma",
        colors: ["#0d0887", "#7e03a8", "#cc4678", "#f89441", "#f0f921"],
    },
    {
        name: "Inferno",
        colors: ["#000004", "#420a68", "#932667", "#dd513a", "#fdea45"],
    },
    {
        name: "Magma",
        colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d"],
    },
    {
        name: "Cividis",
        colors: ["#00204c", "#31456a", "#6b6d7f", "#a59c8f", "#fdea9b"],
    },
    {
        name: "Coolwarm",
        colors: ["#3b4cc0", "#6f92f3", "#dddcdc", "#f49a7b", "#b40426"],
    },
    {
        name: "RdBu",
        colors: ["#67001f", "#d6604d", "#f7f7f7", "#4393c3", "#053061"],
    },
    {
        name: "Turbo",
        colors: ["#30123b", "#4145ab", "#2fb7b0", "#8bd646", "#f9a31b"],
    },
    {
        name: "Thermal",
        colors: ["#04142f", "#155570", "#1fa187", "#f8c932", "#f16623"],
    },
];

const styles: Record<string, Style> = {
    page: {
        position: "relative",
        minHeight: "100vh",
        color: "white",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
    },
    bgLayer1: {
        position: "absolute",
        inset: 0,
        background: "var(--map-bg-1)",
    },
    bgLayer2: {
        position: "absolute",
        inset: 0,
        background: "var(--map-bg-2)",
    },
    bgOverlay: {
        position: "absolute",
        inset: 0,
        background: "var(--map-bg-overlay)",
    },
    branding: {
        position: "fixed",
        top: 16,
        left: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        background: "transparent",
        border: "none",
        borderRadius: 0,
        zIndex: "9999",
        boxShadow: "none",
        backdropFilter: "none",
        pointerEvents: "auto",
    },
    brandIcon: {
        width: 38,
        height: 38,
        position: "relative",
        display: "grid",
        placeItems: "center",
        filter: "drop-shadow(0 8px 18px rgba(0, 0, 0, 0.42))",
        transition: "transform 160ms ease, filter 160ms ease",
        "--iris-x": "0px",
        "--iris-y": "0px",
        "--pupil-x": "0px",
        "--pupil-y": "0px",
        "--blink-open": "1",
    },
    brandSvg: {
        width: "100%",
        height: "100%",
        display: "block",
    },
    brandOutline: {
        stroke: "white",
        strokeWidth: 5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        fill: "none",
        opacity: 0.92,
    },
    brandLids: {
        transform:
            "translate(60px, 40px) scaleY(var(--blink-open, 1)) translate(-60px, -40px)",
        transformOrigin: "60px 40px",
        transition: "none",
    },
    brandClipRect: {
        transform:
            "translate(60px, 40px) scaleY(var(--blink-open, 1)) translate(-60px, -40px)",
        transformOrigin: "60px 40px",
        transition: "none",
    },
    brandIrisGroup: {
        transform: "translate(var(--iris-x, 0px), var(--iris-y, 0px))",
        transition: "none",
        transformBox: "fill-box",
        transformOrigin: "center center",
    },
    brandIris: {
        stroke: "white",
        strokeWidth: 5,
        fill: "rgba(255, 255, 255, 0.08)",
    },
    brandPupilGroup: {
        transform: "translate(var(--pupil-x, 0px), var(--pupil-y, 0px))",
        transition: "none",
        transformOrigin: "center center",
    },
    brandEyeContent: {
        clipPath: "url(#brand-eye-clip)",
    },
    brandPupil: {
        fill: "white",
    },
    brandHighlight: {
        fill: "white",
        opacity: 0.92,
    },
    brandName: {
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 0.6,
        color: "white",
        textTransform: "none",
        textShadow: "0 8px 20px rgba(0, 0, 0, 0.45)",
    },
    field: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    fieldLabel: {
        fontSize: 11,
        letterSpacing: 0.5,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
    },
    mapArea: {
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 1,
    },
    mapSearchWrap: {
        position: "absolute",
        top: 18,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(360px, 70vw)",
        pointerEvents: "auto",
        zIndex: 12,
        transition: "transform 220ms ease, width 220ms ease",
    },
    mapSearchResults: {
        maxHeight: 220,
        overflowY: "auto",
    },
    mapMarker: {
        position: "absolute",
        left: 0,
        top: 0,
        width: 28,
        height: 36,
        pointerEvents: "none",
        zIndex: 11,
        transform: "translate(-9999px, -9999px)",
        opacity: 0,
        transition: "opacity 160ms ease",
        filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.45))",
    },
    mapInfoPanel: {
        position: "absolute",
        left: 0,
        top: 0,
        width: 360,
        maxWidth: "min(360px, 80vw)",
        opacity: 0,
        userSelect: "none",
        transform: "translate(-9999px, -9999px)",
        transition: "opacity 160ms ease",
        zIndex: 12,
        overflow: "hidden",
    },
    mapInfoResizeHandle: {
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 20,
        height: 20,
        cursor: "se-resize",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "4",
        opacity: "0.4",
        zIndex: 2,
        pointerEvents: "auto",
        touchAction: "none",
    },
    mapInfoHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        cursor: "grab",
        touchAction: "none",
    },
    mapInfoTitleGroup: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flex: 1,
        minWidth: 0,
    },
    mapInfoActions: {
        display: "flex",
        gap: 6,
        alignItems: "center",
    },
    mapInfoActionBtn: {
        width: 30,
        height: 30,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "var(--text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        pointerEvents: "auto",
        transition: "all 120ms ease",
    },
    mapInfoExpandBtn: {
        position: "absolute",
        right: 12,
        bottom: 12,
    },
    mapInfoSubtitle: {
        fontSize: 11.5,
        color: "var(--text-secondary)",
        marginTop: 2,
    },
    mapInfoBody: {
        marginTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        paddingBottom: 36,
        overflow: "hidden",
    },
    mapInfoLoadingRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--text-secondary)",
    },
    mapInfoLoadingSpinner: {
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.18)",
        borderTop: "2px solid #34d399",
        animation: "sv-spin 1s linear infinite",
        flexShrink: 0,
    },
    mapRangeOverlay: {
        position: "fixed",
        left: 0,
        bottom: 0,
        right: 0,
        maxHeight: "min(360px, 50vh)",
        display: "flex",
        alignItems: "flex-end",
        pointerEvents: "none",
        zIndex: 9,
        transition: "right 220ms ease, opacity 180ms ease",
    },
    mapRangePanel: {
        width: "100%",
        padding: "12px 18px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "auto",
        background: "var(--map-range-panel-bg)",
        backdropFilter: "blur(8px)",
    },
    mapRangeHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    mapRangeTitleGroup: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
    },
    mapRangeTitle: {
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 0.2,
        color: "var(--text-primary)",
    },
    mapRangeSubtitle: {
        fontSize: 11.5,
        color: "var(--text-secondary)",
    },
    mapRangeBody: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
    },
    mapRangeChartWrap: {
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        height: 220,
        overflow: "hidden",
    },
    mapRangeLoadingRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--text-secondary)",
    },
    mapRangeLoadingSpinner: {
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.18)",
        borderTop: "2px solid #34d399",
        animation: "sv-spin 1s linear infinite",
        flexShrink: 0,
    },
    drawOverlay: {
        position: "absolute",
        inset: 0,
        background: "rgba(5, 10, 20, 0.28)",
        backdropFilter: "blur(1px)",
        pointerEvents: "none",
        zIndex: 8,
    },
    drawOverlayCanvas: {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9,
    },
    drawPrompt: {
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(15, 23, 42, 0.92)",
        border: "1px solid var(--border-medium)",
        boxShadow: "var(--shadow-elevated)",
        fontWeight: 800,
        fontSize: 13,
        color: "var(--text-primary)",
        pointerEvents: "none",
        zIndex: 10,
        textAlign: "center",
    },
    drawPromptSub: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-secondary)",
    },
    loadingIndicator: {
        position: "absolute",
        left: 18,
        bottom: 80,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 0,
        pointerEvents: "auto",
        zIndex: 20,
        minWidth: 160,
    },
    loadingSpinner: {
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.18)",
        borderTop: "2px solid #34d399",
        animation: "sv-spin 1s linear infinite",
        flexShrink: 0,
    },
    loadingTextGroup: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "flex-start",
        minWidth: 0,
    },
    loadingText: {
        fontSize: 12.5,
        fontWeight: 700,
        color: "var(--text-primary)",
        letterSpacing: 0.3,
    },
    loadingSubtext: {
        fontSize: 11.5,
        color: "var(--text-secondary)",
        letterSpacing: 0.2,
    },
    loadingBar: {
        position: "relative",
        width: 120,
        height: 6,
        borderRadius: 999,
        background: "rgba(255, 255, 255, 0.08)",
        overflow: "hidden",
    },
    loadingBarFill: {
        position: "absolute",
        inset: 0,
        borderRadius: 999,
        background:
            "linear-gradient(90deg, rgba(52, 211, 153, 0.9), rgba(125, 211, 252, 0.9))",
        transition: "width 140ms ease",
        width: "0%",
    },
    compareInfoWrap: {
        position: "fixed",
        right: 24,
        bottom: 88,
        display: "flex",
        alignItems: "center",
        pointerEvents: "auto",
        zIndex: 10000,
    },
    compareInfoButton: {
        padding: 0,
        background: "transparent",
        border: "none",
        color: "var(--text-primary)",
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: 0.2,
        cursor: "pointer",
        textDecoration: "underline",
    },
    compareInfoButtonHover: {},
    infoModalOverlay: {
        position: "fixed",
        inset: 0,
        background: "transparent",
        backdropFilter: "none",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
    },
    infoModal: {
        width: "min(480px, 92vw)",
        background: "rgba(12, 16, 24, 0.98)",
        border: "1px solid var(--border-default)",
        borderRadius: 14,
        boxShadow: "var(--shadow-elevated)",
        color: "var(--text-primary)",
        padding: 20,
        position: "relative",
        maxWidth: "520px",
    },
    infoModalHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
    },
    infoModalTitle: {
        fontSize: 16,
        fontWeight: 900,
        letterSpacing: 0.2,
        background: "var(--gradient-accent)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        color: "transparent",
    },
    infoModalClose: {
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "var(--text-secondary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
    },
    infoModalBody: {
        fontSize: 14,
        lineHeight: 1.6,
        color: "var(--text-primary)",
        display: "block",
        textAlign: "left",
        whiteSpace: "normal",
        wordBreak: "break-word",
    },
    infoModalFooter: {
        marginTop: 18,
        display: "flex",
        justifyContent: "center",
    },
    infoModalConfirm: {
        padding: "10px 16px",
        borderRadius: 10,
        border: "1px solid var(--accent-border)",
        background: "var(--gradient-primary)",
        color: "white",
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "var(--shadow-combined)",
    },
    canvasToggle: {
        position: "fixed",
        top: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
        zIndex: 100,
        transition: "right 0.25s ease",
    },
    canvasSwitch: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        padding: 3,
        borderRadius: 11,
        background: "var(--dark-bg)",
        border: "var(--border-base)",
        boxShadow: "var(--shadow-elevated)",
        zIndex: 101,
    },
    canvasIndicator: {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 3,
        width: "calc(50% - 3px)",
        borderRadius: 9,
        background: "var(--gradient-indicator)",
        boxShadow: "var(--shadow-canvas), var(--shadow-inset)",
        transition: "transform 180ms ease",
        zIndex: 0,
        pointerEvents: "none",
    },
    canvasBtn: {
        width: 40,
        height: 40,
        borderRadius: 9,
        border: "1px solid transparent",
        background: "var(--bg-transparent)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "color 120ms ease",
        position: "relative",
        zIndex: 1,
    },
    canvasBtnActive: {
        color: "white",
    },
    mapTitle: { fontSize: 18, fontWeight: 600 },
    mapSubtitle: { fontSize: 14, color: "var(--text-secondary)" },
    badge: {
        padding: "4px 8px",
        borderRadius: 999,
        border: "1px solid var(--accent-border)",
        background: "var(--accent-bg-alt)",
        color: "var(--text-primary)",
        fontSize: 11.5,
        letterSpacing: 0.6,
    },
    modeSwitch: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 4,
        padding: 2,
        borderRadius: 10,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-subtle)",
        boxShadow: "none",
    },
    modeIndicator: {
        position: "absolute",
        top: 2,
        bottom: 2,
        left: 2,
        width: "calc(33.333% - 2px)",
        borderRadius: 8,
        background: "var(--gradient-mode-indicator)",
        boxShadow: "var(--shadow-combined)",
        transition: "transform 200ms ease",
        zIndex: 0,
    },
    modeBtn: {
        flex: 1,
        padding: "8px 0",
        borderRadius: 8,
        border: "none",
        color: "var(--text-secondary)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        background: "var(--bg-transparent)",
        textAlign: "center",
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        outline: "none",
        boxShadow: "none",
        position: "relative",
        zIndex: 1,
    },
    modeBtnActive: {
        background: "var(--gradient-primary)",
        border: "none",
        color: "white",
        boxShadow: "var(--shadow-combined)",
    },
    tabSwitch: {
        position: "absolute",
        left: 32,
        right: 12,
        bottom: -8,
        display: "flex",
        gap: 10,
        padding: "0 8px",
        alignItems: "flex-end",
        pointerEvents: "auto",
        zIndex: 0,
    },
    tabBtn: {
        borderRadius: "14px 14px 0 0",
        padding: "12px 18px",
        background: "var(--bg-strong)",
        color: "var(--text-secondary)",
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: 0.35,
        cursor: "pointer",
        transition: "all 0.18s ease",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(0,0,0,0.32)",
        borderTop: "var(--border-base)",
        borderRight: "var(--border-base)",
        borderLeft: "var(--border-base)",
        borderBottom: "none",
        transform: "translateY(4px)",
    },
    tabBtnActive: {
        background: "var(--gradient-tab-active)",
        color: "white",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.42)",
        borderTop: "var(--border-active)",
        borderRight: "var(--border-active)",
        borderLeft: "var(--border-active)",
        borderBottom: "none",
        transform: "translateY(-4px)",
        zIndex: 1,
    },
    modeViewport: {
        overflow: "hidden",
        width: "100%",
        position: "relative",
        flex: 1,
        minHeight: 0,
        height: 0,
    },
    modeTrack: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        width: "300%",
        height: "100%",
        transition: "transform 220ms ease",
    },
    modePane: {
        width: "100%",
        height: "100%",
        paddingRight: 4,
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        minHeight: 0,
        maxHeight: "100%",
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: "var(--text-primary)",
        letterSpacing: 0.3,
        textTransform: "uppercase",
    },
    paramGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    paletteGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    paletteCard: {
        padding: "9px 10px",
        borderRadius: 12,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-subtle)",
        cursor: "pointer",
        color: "var(--text-primary)",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "all 0.18s ease",
    },
    paletteCardActive: {
        borderColor: "rgba(125,211,252,0.65)",
        background: "var(--gradient-palette-active)",
        boxShadow: "var(--shadow-elevated)",
    },
    paletteName: { fontSize: 13, fontWeight: 700 },
    paletteSwatches: { display: "flex", gap: 6 },
    swatch: {
        flex: 1,
        height: 8,
        borderRadius: 999,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
    },
    range: {
        width: "100%",
        background: "var(--bg-transparent)",
        appearance: "none",
        WebkitAppearance: "none",
        height: 10,
        outline: "none",
        padding: 0,
        margin: 0,
    },
    resolutionRow: { display: "flex", alignItems: "center", gap: 12 },
    resolutionValue: {
        fontSize: 12.5,
        color: "var(--text-secondary)",
        minWidth: 60,
        textAlign: "right",
    },
    sectionText: { fontSize: 13, color: "var(--text-secondary)" },
    toggleIcon: { fontSize: 16, lineHeight: 1 },
    chartPanel: {
        width: "min(1200px, 100%)",
        background: "transparent",
        border: "none",
        borderRadius: 0,
        padding: 0,
        boxShadow: "none",
        backdropFilter: "none",
    },
    chartHeader: {
        textAlign: "center",
        marginBottom: 12,
    },
    chartTitle: { fontSize: 18, fontWeight: 800, color: "var(--text-primary)" },
    chartMeta: {},
    chartBadge: {},
    chartPlotWrapper: {
        width: "100%",
        minHeight: 360,
        background: "transparent",
        border: "none",
        borderRadius: 0,
        padding: 0,
        position: "relative",
    },
    chartEmpty: {
        textAlign: "center",
        color: "var(--text-secondary)",
        padding: "40px 16px",
        lineHeight: 1.6,
    },
    chartError: {
        color: "#fca5a5",
        background: "rgba(248,113,113,0.08)",
        border: "1px solid rgba(248,113,113,0.35)",
        borderRadius: 12,
        padding: 14,
        fontSize: 13,
        lineHeight: 1.5,
    },
    chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
    chip: {
        padding: "8px 10px",
        borderRadius: 12,
        border: "1px solid var(--border-medium)",
        background: "rgba(255,255,255,0.04)",
        color: "var(--text-primary)",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        transition: "all 140ms ease",
    },
    chipActive: {
        borderColor: "rgba(167,139,250,0.65)",
        background: "rgba(167,139,250,0.16)",
        boxShadow: "0 0 0 1px rgba(167,139,250,0.35)",
    },
    chartToggle: {
        marginBottom: 12,
    },
    chartLegend: {
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "center",
        marginTop: 10,
        fontSize: 12,
        color: "var(--text-secondary)",
    },
    chartLegendItem: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--border-subtle)",
    },
};

export type MaskArray = Array<{
    id: number | null;
    lowerBound: number | null;
    upperBound: number | null;
    lowerEdited: boolean;
    upperEdited: boolean;
    kind?: "binary" | "probability";
    probabilityThreshold?: number; // Minimum probability (0-1) to show pixel — only for probability masks
    statistic?: EnsembleStatistic; // Used in ensemble mode
    variable?: string; // Variable for this mask (explore + ensemble)
    unit?: string; // Unit for this mask (explore + ensemble)
}>;

export type AppState = {
    mode: Mode;
    panelTab: PanelTab;
    sidebarOpen: boolean;
    canvasView: CanvasView;
    scenario: string;
    model: string;
    variable: string;
    date: string;
    mapPalette: string;
    mapInfoPalette: string;
    mapRangePalette: string;
    mapRangeHiddenScenarios: string[];
    chartPalette: string;
    resolution: number;
    selectedUnit: string; // Unit label (e.g., "Kelvin (K)", "Celsius (°C)")
    chartMode: ChartMode;
    chartDate: string;
    chartRangeStart: string;
    chartRangeEnd: string;
    chartVariable: string;
    chartUnit: string;
    chartScenarios: string[];
    chartModels: string[];
    chartDropdown: ChartDropdownState;
    chartSamples: ChartSample[];
    chartBoxes: ChartBox[] | null;
    chartRangeSeries: ChartSeries[] | null;
    chartLoading: boolean;
    chartError: string | null;
    chartLoadingProgress: ChartLoadingProgress;
    chartLocation: ChartLocation;
    chartLocationName: string | null;
    chartLocationSearchQuery: string;
    chartLocationSearchResults: LocationSearchResult[];
    chartLocationSearchLoading: boolean;
    chartLocationSearchError: string | null;
    mapLocationSearchQuery: string;
    mapLocationSearchResults: LocationSearchResult[];
    mapLocationSearchLoading: boolean;
    mapLocationSearchError: string | null;
    mapLocationSearchSelection: string | null;
    mapLocationSearchFocused: boolean;
    mapLocationSearchCursor: { start: number; end: number };
    mapOptionsOpen: boolean;
    mapShowBorders: boolean;
    mapShowCities: boolean;
    mapMarker: MapMarker | null;
    mapInfoSamples: ChartSample[];
    mapInfoBoxes: ChartBox[] | null;
    mapInfoLoading: boolean;
    mapInfoError: string | null;
    mapInfoLoadingProgress: ChartLoadingProgress;
    mapInfoOpen: boolean;
    mapRangeSamples: ChartSample[];
    mapRangeSeries: ChartSeries[] | null;
    mapRangeLoading: boolean;
    mapRangeError: string | null;
    mapRangeLoadingProgress: ChartLoadingProgress;
    mapRangeOpen: boolean;
    mapRangeStart: string;
    mapRangeEnd: string;
    mapRangeNumSamples: number;
    mapRangePreset: "1month" | "1year" | "10years" | "full" | "custom";
    mapPolygon: LatLon[] | null;
    chartPolygon: LatLon[] | null;
    chartPoint: LatLon | null;
    drawState: DrawState;
    pointSelectActive: boolean;
    chatInput: string;
    chatMessages: ChatMessage[];
    chatIsLoading: boolean;
    selectedChatModel: string;
    availableModels: string[];
    compareMode: CompareMode;
    compareScenarioA: string;
    compareScenarioB: string;
    compareModelA: string;
    compareModelB: string;
    compareDateStart: string;
    compareDateEnd: string;
    ensembleScenarios: string[];
    ensembleModels: string[];
    ensembleDropdown: ChartDropdownState;
    ensembleStatistic: EnsembleStatistic;
    ensembleDate: string;
    ensembleVariable: string;
    ensembleUnit: string;
    ensembleStatistics: Map<EnsembleStatistic, Float32Array> | null; // Cached statistics for mask filtering
    ensembleStatisticRanges: Map<
        EnsembleStatistic,
        { min: number; max: number }
    >;
    ensembleStatisticsByVariable: Map<
        string,
        Map<EnsembleStatistic, Float32Array>
    >;
    ensembleStatisticRangesByVariable: Map<
        string,
        Map<EnsembleStatistic, { min: number; max: number }>
    >;
    ensembleRawSamplesByVariable: Map<
        string,
        Array<Float32Array | Float64Array>
    >;
    isLoading: boolean;
    loadingProgress: number;
    dataError: string | null;
    currentData: ClimateData | null;
    apiAvailable: boolean | null;
    metaData?: Metadata;
    maskVariableData: Map<string, ClimateData>; // Cache for data of different variables used in masks
    maskVariableRanges: Map<string, { min: number; max: number }>; // Raw ranges for mask variables
    dataMin: number | null;
    dataMax: number | null;
    legendPinned: boolean;
    legendPinnedMin: number | null;
    legendPinnedMax: number | null;
    dataMean: number | null;
    timeRange: {
        start: string;
        end: string;
    } | null;
    compareInfoOpen: boolean;
    configDescription: {
        title: string;
        body: string;
        scenario: string;
        model: string;
        variable: string;
        date: string;
        selectedUnit: string;
        mode: Mode;
        stateSnapshot?: Record<string, any>;
    } | null;
    configDescriptionEditorOpen: boolean;
    configDescriptionInfoOpen: boolean;
    configDescriptionDraftTitle: string;
    configDescriptionDraftBody: string;
    saveDialogOpen: boolean;
    loadDialogOpen: boolean;
    saveDialogOpenForWindow: "1" | "2" | null;
    loadDialogOpenForWindow: "1" | "2" | null;
    loadTargetWindow: "1" | "2";
    saveConfigNameDraft: string;
    exploreMasks: MaskArray;
    compareMasks: MaskArray;
    ensembleMasks: MaskArray;
    chartRequestId: number;
    splitView: boolean;
    splitRatio: number;
    chatScreenshot: string | null;
    legendCollapsed: boolean;
    window2: Window2State;
};

export type Window2State = {
    scenario: string;
    model: string;
    variable: string;
    date: string;
    mapPalette: string;
    selectedUnit: string;
    mode: Mode;
    resolution: number;
    isLoading: boolean;
    loadingProgress: number;
    dataError: string | null;
    currentData: ClimateData | null;
    dataMin: number | null;
    dataMax: number | null;
    legendPinned: boolean;
    legendPinnedMin: number | null;
    legendPinnedMax: number | null;
    timeRange: { start: string; end: string } | null;
    // Per-window UI state for independent operation
    canvasView: CanvasView;
    sidebarOpen: boolean;
    panelTab: PanelTab;
    mapLocationSearchQuery: string;
    mapLocationSearchResults: LocationSearchResult[];
    mapLocationSearchLoading: boolean;
    mapLocationSearchError: string | null;
    mapLocationSearchSelection: string | null;
    mapLocationSearchFocused: boolean;
    mapLocationSearchCursor: { start: number; end: number };
    mapOptionsOpen: boolean;
    mapShowBorders: boolean;
    mapShowCities: boolean;
    mapMarker: MapMarker | null;
    drawState: DrawState;
    mapPolygon: LatLon[] | null;
    compareMode: CompareMode;
    compareScenarioA: string;
    compareScenarioB: string;
    compareModelA: string;
    compareModelB: string;
    compareDateStart: string;
    compareDateEnd: string;
    ensembleScenarios: string[];
    ensembleModels: string[];
    ensembleDropdown: ChartDropdownState;
    ensembleStatistic: EnsembleStatistic;
    ensembleDate: string;
    ensembleVariable: string;
    ensembleUnit: string;
    exploreMasks: MaskArray;
    compareMasks: MaskArray;
    ensembleMasks: MaskArray;
    maskVariableData: Map<string, ClimateData>;
    maskVariableRanges: Map<string, { min: number; max: number }>;
    ensembleStatistics: Map<EnsembleStatistic, Float32Array> | null;
    ensembleStatisticRanges: Map<EnsembleStatistic, { min: number; max: number }>;
    ensembleStatisticsByVariable: Map<
        string,
        Map<EnsembleStatistic, Float32Array>
    >;
    ensembleStatisticRangesByVariable: Map<
        string,
        Map<EnsembleStatistic, { min: number; max: number }>
    >;
    ensembleRawSamplesByVariable: Map<
        string,
        Array<Float32Array | Float64Array>
    >;
    legendCollapsed: boolean;
    // Map info (barcharts) panel state – mirrors the equivalent AppState fields
    mapInfoOpen: boolean;
    mapInfoSamples: ChartSample[];
    mapInfoBoxes: ChartBox[] | null;
    mapInfoLoading: boolean;
    mapInfoError: string | null;
    mapInfoLoadingProgress: ChartLoadingProgress;
    mapInfoPalette: string;
    // Range overlay state – mirrors the equivalent AppState fields
    mapRangeOpen: boolean;
    mapRangeSamples: ChartSample[];
    mapRangeSeries: ChartSeries[] | null;
    mapRangeLoading: boolean;
    mapRangeError: string | null;
    mapRangeLoadingProgress: ChartLoadingProgress;
    mapRangeStart: string;
    mapRangeEnd: string;
    mapRangeNumSamples: number;
    mapRangePreset: "1month" | "1year" | "10years" | "full" | "custom";
    mapRangeHiddenScenarios: string[];
    mapRangePalette: string;
};

//TODO set 0 from available models to active model and so on
let apiOfflineDelayReady = false;

const state: AppState = {
    mode: "Explore",
    panelTab: "Manual",
    sidebarOpen: true,
    canvasView: "map",
    scenario: "SSP245",
    model: models[0],
    variable: variables[0],
    date: getDateForScenario("SSP245"),
    mapPalette: paletteOptions[0].name,
    mapInfoPalette: paletteOptions[0].name,
    mapRangePalette: paletteOptions[0].name,
    mapRangeHiddenScenarios: [],
    chartPalette: paletteOptions[0].name,
    resolution: 2,
    selectedUnit: getDefaultUnitOption(variables[0]).label,
    chartMode: "single",
    chartDate: "2026-01-16",
    chartRangeStart: "2015-01-01",
    chartRangeEnd: "2099-01-01",
    chartVariable: variables[0],
    chartUnit: getDefaultUnitOption(variables[0]).label,
    chartScenarios: ["SSP245", "SSP370", "SSP585"],
    chartModels: [...models],
    chartDropdown: { scenariosOpen: false, modelsOpen: false },
    chartLoadingProgress: { total: 0, done: 0 },
    chartSamples: [],
    chartBoxes: null,
    chartRangeSeries: null,
    chartLoading: false,
    chartError: null,
    chartLocation: "World",
    chartLocationName: null,
    chartLocationSearchQuery: "",
    chartLocationSearchResults: [],
    chartLocationSearchLoading: false,
    chartLocationSearchError: null,
    mapLocationSearchQuery: "",
    mapLocationSearchResults: [],
    mapLocationSearchLoading: false,
    mapLocationSearchError: null,
    mapLocationSearchSelection: null,
    mapLocationSearchFocused: false,
    mapLocationSearchCursor: { start: 0, end: 0 },
    mapOptionsOpen: false,
    mapShowBorders: true,
    mapShowCities: true,
    mapMarker: null,
    mapInfoSamples: [],
    mapInfoBoxes: null,
    mapInfoLoading: false,
    mapInfoError: null,
    mapInfoLoadingProgress: { total: 0, done: 0 },
    mapInfoOpen: false,
    mapRangeSamples: [],
    mapRangeSeries: null,
    mapRangeLoading: false,
    mapRangeError: null,
    mapRangeLoadingProgress: { total: 0, done: 0 },
    mapRangeOpen: false,
    mapRangeStart: "2015-01-01",
    mapRangeEnd: "2015-12-31",
    mapRangeNumSamples: 52,
    mapRangePreset: "1year",
    mapPolygon: null,
    chartPolygon: null,
    chartPoint: null,
    drawState: { active: false, points: [], previewPoint: null },
    pointSelectActive: false,
    chatInput: "",
    chatMessages: [],
    chatIsLoading: false,
    selectedChatModel: "gpt-4o",
    compareMode: "Scenarios",
    availableModels: [],
    compareScenarioA: "SSP245",
    compareScenarioB: "SSP585",
    compareModelA: models[0],
    compareModelB: models[1] ?? models[0],
    compareDateStart: getDateForScenario("SSP245"),
    compareDateEnd: clipDateToScenarioRange(
        addYearsToDate(getDateForScenario("SSP245"), 30),
        "SSP245",
    ),
    exploreMasks: [],
    compareMasks: [],
    ensembleMasks: [],
    ensembleScenarios: ["SSP245", "SSP370", "SSP585"],
    ensembleModels: [...models],
    ensembleDropdown: { scenariosOpen: false, modelsOpen: false },
    ensembleStatistic: "mean",
    ensembleDate: getDateForScenario("SSP245"),
    ensembleVariable: variables[0],
    ensembleUnit: getDefaultUnitOption(variables[0]).label,
    ensembleStatistics: null,
    ensembleStatisticRanges: new Map<
        EnsembleStatistic,
        { min: number; max: number }
    >(),
    ensembleStatisticsByVariable: new Map<
        string,
        Map<EnsembleStatistic, Float32Array>
    >(),
    ensembleStatisticRangesByVariable: new Map<
        string,
        Map<EnsembleStatistic, { min: number; max: number }>
    >(),
    ensembleRawSamplesByVariable: new Map<
        string,
        Array<Float32Array | Float64Array>
    >(),
    isLoading: false,
    loadingProgress: 0,
    dataError: null,
    currentData: null,
    apiAvailable: null,
    dataMin: null,
    dataMax: null,
    dataMean: null,
    timeRange: null,
    metaData: undefined,
    compareInfoOpen: false,
    configDescription: null,
    configDescriptionEditorOpen: false,
    configDescriptionInfoOpen: false,
    configDescriptionDraftTitle: "",
    configDescriptionDraftBody: "",
    saveDialogOpen: false,
    loadDialogOpen: false,
    saveDialogOpenForWindow: null,
    loadDialogOpenForWindow: null,
    loadTargetWindow: "1",
    saveConfigNameDraft: "",
    maskVariableData: new Map<string, ClimateData>(),
    maskVariableRanges: new Map<string, { min: number; max: number }>(),
    chartRequestId: 0,
    splitView: false,
    splitRatio: 0.5,
    chatScreenshot: null,
    legendCollapsed: false,
    legendPinned: false,
    legendPinnedMin: null,
    legendPinnedMax: null,
    window2: {
        scenario: "SSP245",
        model: models[0],
        variable: variables[0],
        date: getDateForScenario("SSP245"),
        mapPalette: paletteOptions[0].name,
        selectedUnit: getDefaultUnitOption(variables[0]).label,
        mode: "Explore",
        resolution: 2,
        isLoading: false,
        loadingProgress: 0,
        dataError: null,
        currentData: null,
        dataMin: null,
        dataMax: null,
        timeRange: null,
        canvasView: "map",
        sidebarOpen: true,
        panelTab: "Manual",
        mapLocationSearchQuery: "",
        mapLocationSearchResults: [],
        mapLocationSearchLoading: false,
        mapLocationSearchError: null,
        mapLocationSearchSelection: null,
        mapLocationSearchFocused: false,
        mapLocationSearchCursor: { start: 0, end: 0 },
        mapOptionsOpen: false,
        mapShowBorders: true,
        mapShowCities: true,
        mapMarker: null,
        drawState: { active: false, points: [], previewPoint: null },
        mapPolygon: null,
        compareMode: "Scenarios",
        compareScenarioA: "SSP245",
        compareScenarioB: "SSP585",
        compareModelA: models[0],
        compareModelB: models[1] ?? models[0],
        compareDateStart: getDateForScenario("SSP245"),
        compareDateEnd: clipDateToScenarioRange(
            addYearsToDate(getDateForScenario("SSP245"), 30),
            "SSP245",
        ),
        ensembleScenarios: ["SSP245", "SSP370", "SSP585"],
        ensembleModels: [...models],
        ensembleDropdown: { scenariosOpen: false, modelsOpen: false },
        ensembleStatistic: "mean",
        ensembleDate: getDateForScenario("SSP245"),
        ensembleVariable: variables[0],
        ensembleUnit: getDefaultUnitOption(variables[0]).label,
        exploreMasks: [],
        compareMasks: [],
        ensembleMasks: [],
        maskVariableData: new Map<string, ClimateData>(),
        maskVariableRanges: new Map<string, { min: number; max: number }>(),
        ensembleStatistics: null,
        ensembleStatisticRanges: new Map<EnsembleStatistic, { min: number; max: number }>(),
        ensembleStatisticsByVariable: new Map<
            string,
            Map<EnsembleStatistic, Float32Array>
        >(),
        ensembleStatisticRangesByVariable: new Map<
            string,
            Map<EnsembleStatistic, { min: number; max: number }>
        >(),
        ensembleRawSamplesByVariable: new Map<
            string,
            Array<Float32Array | Float64Array>
        >(),
        legendCollapsed: false,
        legendPinned: false,
        legendPinnedMin: null,
        legendPinnedMax: null,
        mapInfoOpen: false,
        mapInfoSamples: [],
        mapInfoBoxes: null,
        mapInfoLoading: false,
        mapInfoError: null,
        mapInfoLoadingProgress: { total: 0, done: 0 },
        mapInfoPalette: paletteOptions[0].name,
        mapRangeOpen: false,
        mapRangeSamples: [],
        mapRangeSeries: null,
        mapRangeLoading: false,
        mapRangeError: null,
        mapRangeLoadingProgress: { total: 0, done: 0 },
        mapRangeStart: "2015-01-01",
        mapRangeEnd: "2015-12-31",
        mapRangeNumSamples: 52,
        mapRangePreset: "1year",
        mapRangeHiddenScenarios: [],
        mapRangePalette: paletteOptions[0].name,
    },
};

let nextMaskId = 1;
let mapCanvas: HTMLCanvasElement | null = null;
// Persistent canvas-2: created once when split view opens, never destroyed by render().
// D3 zoom stays attached across re-renders so drag gestures are never interrupted.
let persistentCanvas2: HTMLCanvasElement | null = null;
let drawKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let legendPinTooltipOpen: "1" | "2" | null = null;

let appRoot: HTMLDivElement | null = null;
let cleanupBrandEyeTracking: (() => void) | null = null;
let brandEyeFrame: number | null = null;
let brandBlinkFrame: number | null = null;
let brandBlinkTimeout: number | null = null;
let brandEyeIdleTimeout: number | null = null;
let locationSearchDebounce: number | null = null;
let locationSearchRequestId = 0;
let mapLocationSearchDebounce: number | null = null;
let mapLocationSearchRequestId = 0;
let mapLocationSearchDebounceW2: number | null = null;
let mapLocationSearchRequestIdW2 = 0;
let mapInfoRequestId = 0;
let mapInfoDelayTimer: number | null = null;
let mapRangeRequestId = 0;
let mapRangeDelayTimer: number | null = null;
// W2-specific request tracking for map info and range overlays
let mapInfoRequestIdW2 = 0;
let mapInfoDelayTimerW2: number | null = null;
let mapRangeRequestIdW2 = 0;
let mapRangeDelayTimerW2: number | null = null;
let climateDataRequestId = 0;
// Track which resolution was in use when ensemble stats were last computed so that
// the fast-path cache is invalidated on resolution changes (different quality levels
// return different grid shapes from OpenVisus).
let _ensembleStatsCachedResolution: number | null = null;
let _w2EnsembleStatsCachedResolution: number | null = null;
type EnsembleStatsCacheKey = {
    date: string;
    scenariosKey: string;
    modelsKey: string;
    resolution: number;
};
let _ensembleStatsCachedKey: EnsembleStatsCacheKey | null = null;
let _w2EnsembleStatsCachedKey: EnsembleStatsCacheKey | null = null;
let mapInfoDragPosition: { left: number; top: number } | null = null;
let mapInfoDragState: {
    active: boolean;
    pointerId: number | null;
    offsetX: number;
    offsetY: number;
} = {
    active: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
};
let mapInfoSize: { width: number; height: number } | null = null;
let mapInfoNaturalSize: { width: number; height: number } | null = null;
let mapInfoResizeState: {
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
} = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
};
// W2-specific drag/resize state for map-info-panel-w2
let mapInfoDragPositionW2: { left: number; top: number } | null = null;
let mapInfoDragStateW2: {
    active: boolean;
    pointerId: number | null;
    offsetX: number;
    offsetY: number;
} = {
    active: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
};
let mapInfoSizeW2: { width: number; height: number } | null = null;
let mapInfoNaturalSizeW2: { width: number; height: number } | null = null;
let mapInfoResizeStateW2: {
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
} = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
};
const LOCATION_SEARCH_DEBOUNCE_MS = 500;
const CONFIG_CACHE_STORAGE_KEY = "polyoracle-saved-configs-v1";

type SavedConfigEntry = {
    name: string;
    savedAt: string;
    data: Record<string, any>;
};

function getSavedConfigs(): SavedConfigEntry[] {
    try {
        const raw = localStorage.getItem(CONFIG_CACHE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const configs = parsed
            .filter(
                (entry): entry is SavedConfigEntry =>
                    entry &&
                    typeof entry === "object" &&
                    typeof entry.name === "string" &&
                    typeof entry.savedAt === "string" &&
                    entry.data &&
                    typeof entry.data === "object",
            )
            .map((entry) => ({
                name: entry.name.trim(),
                savedAt: entry.savedAt,
                data: entry.data,
            }))
            .filter((entry) => entry.name.length > 0);
        return configs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    } catch {
        return [];
    }
}

function setSavedConfigs(entries: SavedConfigEntry[]) {
    localStorage.setItem(CONFIG_CACHE_STORAGE_KEY, JSON.stringify(entries));
}

function toKebab(input: string) {
    return input.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function styleAttr(style: Style) {
    return Object.entries(style)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
            const cssKey = key.startsWith("--") ? key : toKebab(key);
            const cssVal =
                typeof value === "number" ? `${value}px` : String(value);
            return `${cssKey}:${cssVal}`;
        })
        .join(";");
}

function mergeStyles(...entries: Array<Style | undefined>): Style {
    return entries.reduce<Style>((acc, entry) => {
        if (!entry) return acc;
        return { ...acc, ...entry };
    }, {});
}

function escapeHtml(input: string): string {
    if (input == null) return "";
    return input.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return char;
        }
    });
}

function formatDisplayDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function getVariableLabel(variable: string, meta?: Metadata): string {
    return (
        meta?.variable_metadata?.[variable]?.name ||
        meta?.variable_metadata?.[variable]?.description ||
        variable
    );
}

function getActiveMapVariable(): { variable: string; unit: string } {
    if (state.mode === "Ensemble") {
        return { variable: state.ensembleVariable, unit: state.ensembleUnit };
    }
    return { variable: state.variable, unit: state.selectedUnit };
}

function getMapRangeVariable(): { variable: string; unit: string } {
    return getActiveMapVariable();
}

function isDifferenceEnsembleStatistic(stat: EnsembleStatistic): boolean {
    return stat === "std" || stat === "iqr" || stat === "percentile" || stat === "extremes";
}

function getEnsembleMaskRange(
    stat: EnsembleStatistic,
    variable = state.ensembleVariable,
    unitLabel = state.ensembleUnit,
): {
    min: number | null;
    max: number | null;
} {
    const rangesForVariable =
        state.ensembleStatisticRangesByVariable.get(variable) ??
        (variable === state.ensembleVariable
            ? state.ensembleStatisticRanges
            : undefined);
    const range = rangesForVariable?.get(stat);
    let rawMin: number | null = null;
    let rawMax: number | null = null;

    if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
        rawMin = range.min;
        rawMax = range.max;
    } else if (
        stat === state.ensembleStatistic &&
        state.dataMin !== null &&
        state.dataMax !== null
    ) {
        rawMin = state.dataMin;
        rawMax = state.dataMax;
    }

    if (rawMin === null || rawMax === null) {
        return { min: null, max: null };
    }

    const converted = convertMinMax(
        rawMin,
        rawMax,
        variable,
        unitLabel,
        { isDifference: isDifferenceEnsembleStatistic(stat) },
    );
    return { min: converted.min, max: converted.max };
}

function getEnsembleProbabilityMaskRange(
    variable = state.ensembleVariable,
    unitLabel = state.ensembleUnit,
): {
    min: number | null;
    max: number | null;
} {
    const sampleArrays = state.ensembleRawSamplesByVariable.get(variable);
    if (!sampleArrays || sampleArrays.length === 0) {
        return { min: null, max: null };
    }
    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const sample of sampleArrays) {
        for (let i = 0; i < sample.length; i++) {
            const raw = sample[i];
            if (!Number.isFinite(raw)) continue;
            const clipped = variable === "hurs" ? Math.min(raw, 100) : raw;
            rawMin = Math.min(rawMin, clipped);
            rawMax = Math.max(rawMax, clipped);
        }
    }
    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
        return { min: null, max: null };
    }
    const converted = convertMinMax(rawMin, rawMax, variable, unitLabel);
    return { min: converted.min, max: converted.max };
}

function describeCompareContext(state: AppState): {
    title: string;
    paragraphs: string[];
} {
    const variableLabel = getVariableLabel(state.variable, state.metaData);
    const unitLabel =
        state.selectedUnit ||
        state.metaData?.variable_metadata?.[state.variable]?.unit ||
        "";
    const unitText = unitLabel ? `${unitLabel}` : "the dataset's native units";

    switch (state.compareMode) {
        case "Dates": {
            const start = formatDisplayDate(state.compareDateStart);
            const end = formatDisplayDate(state.compareDateEnd);
            return {
                title: "Comparing two dates",
                paragraphs: [
                    `We are comparing ${variableLabel} on ${start} versus ${end} under the ${state.scenario} scenario using the ${state.model} model.`,
                    `Values on the map represent ${end} minus ${start} in ${unitText}. A value of X means ${variableLabel} was X ${
                        unitLabel || ""
                    } higher on ${end} than on ${start} (negative values mean it was lower).`,
                ],
            };
        }
        case "Models": {
            const date = formatDisplayDate(state.date);
            return {
                title: "Comparing two models",
                paragraphs: [
                    `We are comparing ${variableLabel} between ${state.compareModelB} and ${state.compareModelA} on ${date} within the ${state.scenario} scenario.`,
                    `Each value shows ${state.compareModelB} minus ${state.compareModelA} in ${unitText}. Positive numbers mean ${variableLabel} is higher in ${state.compareModelB}; negative means it is higher in ${state.compareModelA}.`,
                ],
            };
        }
        case "Scenarios":
        default: {
            const date = formatDisplayDate(state.date);
            const scenarioA = state.compareScenarioA;
            const scenarioB = state.compareScenarioB;
            return {
                title: "Comparing two scenarios",
                paragraphs: [
                    `We are comparing ${variableLabel} for ${scenarioB} versus ${scenarioA} on ${date} using the ${state.model} model.`,
                    `Values show ${scenarioB} minus ${scenarioA} in ${unitText}. A value of X means ${variableLabel} is X ${
                        unitLabel || ""
                    } higher under ${scenarioB} than under ${scenarioA}; negative values mean it is lower.`,
                ],
            };
        }
    }
}

function renderCompareInfo(state: AppState): string {
    if (state.mode !== "Compare" || state.canvasView !== "map") return "";
    const info = describeCompareContext(state);
    const paragraphs = info.paragraphs
        .map((p, idx) => {
            const isLast = idx === info.paragraphs.length - 1;
            const margin = isLast ? "0" : "0 0 12px 0";
            // Highlight X in the text
            const highlightedText = p.replace(
                /(\bX\b|ΔX)/g,
                '<span style="color: var(--accent-purple);">$1</span>',
            );
            return `<p style="display:block; margin:${margin}; line-height:1.6; white-space: normal; word-break: break-word;">${highlightedText}</p>`;
        })
        .join("");
    const compareRight = state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24;
    const compareBottom =
        state.mode === "Compare" && state.compareMode === "Dates" ? 120 : 88;
    const overlayStyle = mergeStyles(styles.infoModalOverlay, {
        left: "0",
        right: "0",
        width: "100%",
        justifyContent: "center",
        paddingLeft: 0,
    });

    const modalStyle = mergeStyles(styles.infoModal, {
        alignSelf: "center",
        marginLeft: "auto",
        marginRight: "auto",
    });

    const modal = state.compareInfoOpen
        ? `
      <div data-role="compare-info-overlay" class="compare-info-overlay" style="${styleAttr(
          overlayStyle,
      )}">
        <div style="${styleAttr(
            modalStyle,
        )}" role="dialog" aria-modal="true" aria-label="${info.title}">
          <div style="${styleAttr(styles.infoModalHeader)}">
            <div style="${styleAttr(styles.infoModalTitle)}">${info.title}</div>
            <button type="button" data-action="close-compare-info" style="${styleAttr(
                styles.infoModalClose,
            )}" aria-label="Close info dialog">✕</button>
          </div>
          <div style="${styleAttr(styles.infoModalBody)}">
            ${paragraphs}
          </div>
          <div style="${styleAttr(styles.infoModalFooter)}">
            <button type="button" data-action="close-compare-info" style="${styleAttr(
                styles.infoModalConfirm,
            )}">Got it</button>
          </div>
        </div>
      </div>
    `
        : "";

    return `
      <div data-role="compare-info-trigger" style="${styleAttr(
          mergeStyles(styles.compareInfoWrap, {
              right: compareRight,
              bottom: compareBottom,
          }),
      )}">
        <button type="button" data-action="open-compare-info" style="${styleAttr(
            styles.compareInfoButton,
        )}">
          What am I seeing?
        </button>
      </div>
      ${modal}
    `;
}

function buildDescriptionSnapshotFromState(state: AppState): Record<string, any> {
    const snapshot = {
        scenario: state.scenario,
        model: state.model,
        variable: state.variable,
        date: state.date,
        selectedUnit: state.selectedUnit,
        mode: state.mode,
        masks: getModeMasks(state),
        mapShowBorders: state.mapShowBorders,
        mapShowCities: state.mapShowCities,
        mapPolygon: state.mapPolygon,
        mapMarker: state.mapMarker,
        mapRangeStart: state.mapRangeStart,
        mapRangeEnd: state.mapRangeEnd,
        mapRangeNumSamples: state.mapRangeNumSamples,
        mapRangePreset: state.mapRangePreset,
    };
    // Deep-clone so later in-place mutations (e.g. masks) don't mutate the snapshot.
    try {
        return JSON.parse(JSON.stringify(snapshot));
    } catch {
        return snapshot;
    }
}

function renderConfigNotes(state: AppState): string {
    if (!state.configDescription || state.canvasView !== "map") return "";
    const d = state.configDescription;
    // Only show notes when the configuration matches the one they were saved for.
    if (d.stateSnapshot) {
        const currentSnapshot = buildDescriptionSnapshotFromState(state);
        try {
            if (JSON.stringify(currentSnapshot) !== JSON.stringify(d.stateSnapshot)) {
                return "";
            }
        } catch {
            return "";
        }
    } else {
        // Backwards-compat: fall back to comparing the main selection fields
        if (
            d.scenario !== state.scenario ||
            d.model !== state.model ||
            d.variable !== state.variable ||
            d.date !== state.date ||
            d.selectedUnit !== state.selectedUnit ||
            d.mode !== state.mode
        ) {
            return "";
        }
    }
    const overlayStyle = styles.infoModalOverlay;
    const modalStyle = mergeStyles(styles.infoModal, {
        alignSelf: "center",
        marginLeft: "auto",
        marginRight: "auto",
    });
    const description = state.configDescription;
    const bodyText = description.body?.trim() || "";
    const bodyHtml = bodyText
        ? `<p style="display:block; margin:0; line-height:1.6; white-space:pre-wrap; word-break: break-word;">${escapeHtml(
              bodyText,
          )}</p>`
        : `<p style="display:block; margin:0; line-height:1.6; white-space:normal; word-break: break-word;">No additional notes were saved for this scenario.</p>`;

    const modal = state.configDescriptionInfoOpen
        ? `
      <div data-role="config-description-info-overlay" class="config-description-info-overlay" style="${styleAttr(
          overlayStyle,
      )}">
        <div style="${styleAttr(
            modalStyle,
        )}" role="dialog" aria-modal="true" aria-label="${escapeHtml(
            description.title || "Scenario notes",
        )}">
          <div style="${styleAttr(styles.infoModalHeader)}">
            <div style="${styleAttr(styles.infoModalTitle)}">${escapeHtml(
                description.title || "Scenario notes",
            )}</div>
            <button type="button" data-action="close-config-description-info" style="${styleAttr(
                styles.infoModalClose,
            )}" aria-label="Close notes dialog">✕</button>
          </div>
          <div style="${styleAttr(styles.infoModalBody)}">
            ${bodyHtml}
          </div>
          <div style="${styleAttr(styles.infoModalFooter)}">
            <button type="button" data-action="close-config-description-info" style="${styleAttr(
                styles.infoModalConfirm,
            )}">Close</button>
          </div>
        </div>
      </div>
    `
        : "";

    return `
      <button
        type="button"
        class="tutorial-start-btn"
        data-action="open-config-description-info"
        title="Show scenario notes"
        aria-label="Show scenario notes"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 3h11a1 1 0 0 1 1 1v13.5L15.5 17H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 7h6" />
          <path d="M9 11h4" />
        </svg>
      </button>
      ${modal}
    `;
}

function renderConfigDropup(state: AppState, panel: "save" | "load", window: "1" | "2"): string {
    const savedConfigs = getSavedConfigs();
    const savedConfigRows =
        savedConfigs.length === 0
            ? `<div class="sidebar-footer-dropup-empty">No saved scenarios yet.</div>`
            : savedConfigs
                  .map((entry) => {
                      const encodedName = encodeURIComponent(entry.name);
                      const savedAt = new Date(entry.savedAt);
                      const savedLabel = Number.isNaN(savedAt.getTime())
                          ? entry.savedAt
                          : savedAt.toLocaleString();
                      return `
              <div class="sidebar-footer-dropup-row">
                <div class="sidebar-footer-dropup-row-meta">
                  <div class="sidebar-footer-dropup-row-title">${escapeHtml(entry.name)}</div>
                  <div class="sidebar-footer-dropup-row-subtitle">Saved ${escapeHtml(savedLabel)}</div>
                </div>
                <button type="button" class="sidebar-footer-dropup-delete-btn" data-action="delete-cached-config" data-config-name="${escapeHtml(
                    encodedName,
                )}" aria-label="Delete saved scenario">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                    <path d="M10 11v6"></path>
                    <path d="M14 11v6"></path>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                  </svg>
                </button>
                <button type="button" class="sidebar-footer-dropup-inline-btn" data-action="load-cached-config" data-config-name="${escapeHtml(
                    encodedName,
                )}">Load</button>
              </div>
            `;
                  })
                  .join("");

    const savePanel =
        state.saveDialogOpen && state.saveDialogOpenForWindow === window
            ? `
      <div class="sidebar-footer-dropup-panel" role="dialog" aria-label="Save scenario">
          <div class="sidebar-footer-dropup-header">
            <div class="sidebar-footer-dropup-title">Save scenario</div>
            <button type="button" class="sidebar-footer-dropup-close" data-action="close-save-dialog" aria-label="Close save dialog">✕</button>
          </div>
          <div class="sidebar-footer-dropup-body">
            <div class="sidebar-footer-dropup-help">
              Save this scenario locally with a name, or export it as a JSON file.
            </div>
            <input
              type="text"
              data-action="save-config-name-input"
              value="${escapeHtml(state.saveConfigNameDraft)}"
              placeholder="My config"
              class="sidebar-footer-dropup-input"
            />
            <button
              type="button"
              class="sidebar-footer-dropup-inline-btn"
              data-action="open-config-description-editor"
            >
              ${state.configDescription ? "Edit description" : "Add description"}
            </button>
          </div>
          <div class="sidebar-footer-dropup-footer">
            <button type="button" class="sidebar-footer-dropup-btn sidebar-footer-dropup-btn-muted" data-action="close-save-dialog">Cancel</button>
            <button type="button" class="sidebar-footer-dropup-btn sidebar-footer-dropup-btn-primary" data-action="save-config-locally">Save</button>
            <button type="button" class="sidebar-footer-dropup-btn sidebar-footer-dropup-btn-primary" data-action="export-state">Export</button>
          </div>
      </div>
    `
        : "";

    const loadPanel =
        state.loadDialogOpen && state.loadDialogOpenForWindow === window
            ? `
      <div class="sidebar-footer-dropup-panel sidebar-footer-dropup-panel-wide" role="dialog" aria-label="Load scenario">
          <div class="sidebar-footer-dropup-header">
            <div class="sidebar-footer-dropup-title">Load scenario</div>
            <button type="button" class="sidebar-footer-dropup-close" data-action="close-load-dialog" aria-label="Close load dialog">✕</button>
          </div>
          <div class="sidebar-footer-dropup-body">
            <div class="sidebar-footer-dropup-help">
              Choose one of your saved scenarios.
            </div>
            <div class="sidebar-footer-dropup-list">
              ${savedConfigRows}
            </div>
          </div>
          <div class="sidebar-footer-dropup-footer">
            <button type="button" class="sidebar-footer-dropup-btn sidebar-footer-dropup-btn-muted" data-action="close-load-dialog">Close</button>
            <button type="button" class="sidebar-footer-dropup-btn sidebar-footer-dropup-btn-primary" data-action="import-state">Import JSON</button>
          </div>
      </div>
    `
        : "";

    return panel === "save" ? savePanel : loadPanel;
}

function renderConfigDescriptionEditor(state: AppState): string {
    if (!state.configDescriptionEditorOpen) return "";
    const overlayStyle = styles.infoModalOverlay;
    const modalStyle = mergeStyles(styles.infoModal, {
        width: "min(640px, 96vw)",
        maxWidth: "640px",
    });
    const titleValue =
        state.configDescriptionDraftTitle ||
        state.configDescription?.title ||
        state.saveConfigNameDraft ||
        "";
    const bodyValue =
        state.configDescriptionDraftBody ||
        state.configDescription?.body ||
        "";

    return `
      <div data-role="config-description-editor-overlay" class="config-description-editor-overlay" style="${styleAttr(
          overlayStyle,
      )}">
        <div style="${styleAttr(
            modalStyle,
        )}" role="dialog" aria-modal="true" aria-label="Scenario description">
          <div style="${styleAttr(styles.infoModalHeader)}">
            <div style="${styleAttr(
                styles.infoModalTitle,
            )}">Scenario description</div>
            <button type="button" data-action="close-config-description-editor" style="${styleAttr(
                styles.infoModalClose,
            )}" aria-label="Close description editor">✕</button>
          </div>
          <div style="${styleAttr(styles.infoModalBody)}">
            <label style="display:block;margin-bottom:18px;font-size:13px;font-weight:500;">
              <span style="display:block;margin-bottom:6px;">Title</span>
              <input
                type="text"
                data-role="config-description-title-input"
                value="${escapeHtml(titleValue)}"
                style="margin-top:8px;width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-default);background:rgba(15,23,42,0.9);color:white;font-size:13px;outline:none;"
              />
            </label>
            <label style="display:block;font-size:13px;font-weight:500;">
              <span style="display:block;margin-bottom:6px;">Description</span>
              <textarea
                data-role="config-description-body-input"
                rows="6"
                style="margin-top:8px;width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-default);background:rgba(15,23,42,0.9);color:white;font-size:13px;resize:vertical;outline:none;"
              >${escapeHtml(bodyValue)}</textarea>
            </label>
          </div>
          <div style="${styleAttr(styles.infoModalFooter)}">
            <button type="button" data-action="save-config-description" style="${styleAttr(
                styles.infoModalConfirm,
            )}">Save description</button>
          </div>
        </div>
      </div>
    `;
}

async function checkApiAvailability() {
    try {
        const available = await checkApiHealth();
        state.apiAvailable = available;
    } catch {
        state.apiAvailable = false;
    }
}

/**
 * Get the appropriate date for a given scenario
 * - Historical: returns "2000-01-01"
 * - SSP245/SSP585: returns current date (or earliest valid date if current date is before 2015)
 */
function getDateForScenario(scenario: string): string {
    if (scenario.toLowerCase() === "historical") {
        return "2000-01-01";
    }

    // For future scenarios (SSP245, SSP585), use current date
    // But ensure it's within the valid range (2015-2100)
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = String(today.getMonth() + 1).padStart(2, "0");
    const currentDay = String(today.getDate()).padStart(2, "0");

    // If current date is before 2015, use 2015-01-01
    if (currentYear < 2015) {
        return "2015-01-01";
    }

    // If current date is after 2100, use 2100-12-31
    if (currentYear > 2100) {
        return "2100-12-31";
    }

    // Use current date
    return `${currentYear}-${currentMonth}-${currentDay}`;
}

/**
 * Add years to a date string (YYYY-MM-DD).
 */
function addYearsToDate(dateStr: string, years: number): string {
    const d = new Date(dateStr);
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
}

/**
 * Get the time range for a given scenario
 * - Historical: 1950-01-01 to 2014-12-31
 * - SSP245/SSP585: 2015-01-01 to 2100-12-31
 */
function getTimeRangeForScenario(scenario: string): {
    start: string;
    end: string;
} {
    if (scenario.toLowerCase() === "historical") {
        return {
            start: "1950-01-01",
            end: "2014-12-31",
        };
    }

    // For future scenarios (SSP245, SSP585)
    return {
        start: "2015-01-01",
        end: "2099-12-31",
    };
}

/**
 * Clip a date to the valid range for a scenario
 * Returns the nearest valid date if the input date is outside the range
 */
function clipDateToScenarioRange(date: string, scenario: string): string {
    const timeRange = getTimeRangeForScenario(scenario);
    const inputDate = new Date(date);
    const startDate = new Date(timeRange.start);
    const endDate = new Date(timeRange.end);

    // If date is before the start, return the start date
    if (inputDate < startDate) {
        return timeRange.start;
    }

    // If date is after the end, return the end date
    if (inputDate > endDate) {
        return timeRange.end;
    }

    // Date is within range, return as-is
    return date;
}

function calculateMinMax(arrayData: Float32Array | Float64Array): {
    min: number;
    max: number;
} {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < arrayData.length; i++) {
        const val = arrayData[i];
        if (isFinite(val)) {
            min = Math.min(min, val);
            max = Math.max(max, val);
        }
    }

    if (!isFinite(min) || !isFinite(max)) {
        throw new Error("No valid numeric values returned from dataset.");
    }

    return { min, max };
}

function formatMaskLimit(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "";
    return value.toFixed(2);
}

function getMaskRangeFor(
    maskVar: string,
    unitLabel: string,
): { min: number; max: number } | null {
    let rawMin: number | null = null;
    let rawMax: number | null = null;

    if (maskVar === state.variable) {
        rawMin = state.dataMin;
        rawMax = state.dataMax;
    } else {
        const range = state.maskVariableRanges.get(maskVar);
        if (range) {
            rawMin = range.min;
            rawMax = range.max;
        }
    }

    if (rawMin === null || rawMax === null) return null;
    const converted = convertMinMax(rawMin, rawMax, maskVar, unitLabel);
    return { min: converted.min, max: converted.max };
}

function averageArray(
    arrayData: Float32Array | Float64Array,
    variable: string,
): number {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < arrayData.length; i++) {
        const val = arrayData[i];
        if (!isFinite(val)) continue;
        const value = variable === "hurs" ? Math.min(val, 100) : val;
        sum += value;
        count += 1;
    }
    if (!count) {
        throw new Error("No valid numeric values returned from dataset.");
    }
    return sum / count;
}

function isPointInPolygon(point: LatLon, polygon: LatLon[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lon;
        const yi = polygon[i].lat;
        const xj = polygon[j].lon;
        const yj = polygon[j].lat;

        const intersect =
            yi > point.lat !== yj > point.lat &&
            point.lon <
                ((xj - xi) * (point.lat - yi)) / (yj - yi + Number.EPSILON) +
                    xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function averageArrayInPolygon(
    arrayData: Float32Array | Float64Array,
    variable: string,
    shape: [number, number],
    polygon: LatLon[],
): number {
    const [height, width] = shape;
    const lonStep = 360 / width;
    const latStep = 150 / height;

    let sum = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
        const lat = 90 - y * latStep - latStep / 2;
        for (let x = 0; x < width; x++) {
            // Data uses 0-360° longitude: convert to -180 to 180° for display
            const lonRaw = x * lonStep + lonStep / 2;
            const lon = lonRaw > 180 ? lonRaw - 360 : lonRaw;
            const idx = (height - 1 - y) * width + x;
            const raw = arrayData[idx];
            if (!isFinite(raw)) continue;

            const value = variable === "hurs" ? Math.min(raw, 100) : raw;
            if (isPointInPolygon({ lat, lon }, polygon)) {
                sum += value;
                count += 1;
            }
        }
    }

    if (!count) {
        throw new Error(
            "The selected region does not contain valid data points.",
        );
    }

    return sum / count;
}

function isPointNear(a: LatLon, b: LatLon, thresholdDeg = 0.75): boolean {
    const dLat = a.lat - b.lat;
    const dLon = a.lon - b.lon;
    return Math.hypot(dLat, dLon) <= thresholdDeg;
}

function valueAtPoint(
    array: Float32Array | Float64Array,
    variable: string,
    shape: [number, number],
    point: LatLon,
): number {
    const [height, width] = shape;

    // Convert longitude from [-180, 180) to [0, 360) for data grid lookup
    // Climate data uses 0-360° longitude range: x=0 → 0°, x=width → 360°
    const lonNormalized = (((point.lon + 360) % 360) + 360) % 360;
    const xFloat = (lonNormalized / 360) * width - 0.5;
    const yFloat = ((90 - point.lat) / 150) * height - 0.5;

    const clamp = (value: number, min: number, max: number) =>
        Math.min(max, Math.max(min, value));

    const x = clamp(Math.round(xFloat), 0, width - 1);
    const y = clamp(Math.round(yFloat), 0, height - 1);

    const idxFromXY = (xi: number, yi: number) =>
        (height - 1 - yi) * width + xi;

    const tryGetValue = (xi: number, yi: number) => {
        const xiWrapped = ((xi % width) + width) % width; // wrap in case of dateline neighbors
        const yiClamped = clamp(yi, 0, height - 1);
        const index = idxFromXY(xiWrapped, yiClamped);
        const raw = array[index];
        return Number.isFinite(raw) ? raw : null;
    };

    let raw = tryGetValue(x, y);

    // If the exact cell is missing (NaN), search nearby cells for the nearest valid value
    if (raw === null) {
        const maxRadius = 3;
        let found: number | null = null;
        for (let r = 1; r <= maxRadius && found === null; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter for efficiency
                    const candidate = tryGetValue(x + dx, y + dy);
                    if (candidate !== null) {
                        found = candidate;
                        break;
                    }
                }
                if (found !== null) break;
            }
        }
        raw = found;
    }

    if (raw === null) {
        throw new Error("No valid data at the selected point.");
    }

    // Keep the raw value in base units; clamp humidity like other paths
    const rawValue = variable === "hurs" ? Math.min(raw, 100) : raw;
    if (!Number.isFinite(rawValue)) {
        throw new Error(`Invalid value at point: ${rawValue}`);
    }
    return rawValue;
}

function resetDrawState(): DrawState {
    return { active: false, points: [], previewPoint: null };
}

function ensureDrawKeyListener(onFinish: () => void) {
    if (drawKeyHandler) return;
    drawKeyHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter" && state.drawState.active) {
            e.preventDefault();
            onFinish();
        }
    };
    window.addEventListener("keydown", drawKeyHandler);
}

function removeDrawKeyListener() {
    if (!drawKeyHandler) return;
    window.removeEventListener("keydown", drawKeyHandler);
    drawKeyHandler = null;
}

function applyMapInteractions(canvas: HTMLCanvasElement) {
    const useDrawMode = state.drawState.active || state.pointSelectActive;
    const activeVariable =
        state.mode === "Ensemble" ? state.ensembleVariable : state.variable;
    const activeUnit =
        state.mode === "Ensemble" ? state.ensembleUnit : state.selectedUnit;
    const defaultUnit =
        state.metaData?.variable_metadata[activeVariable]?.unit || "";
    setupMapInteractions(
        canvas,
        state.currentData,
        defaultUnit,
        activeVariable,
        activeUnit,
        {
            drawMode: useDrawMode,
            onDrawClick: state.pointSelectActive
                ? handlePointClick
                : handleDrawClick,
            onDrawMove: state.drawState.active ? handleDrawMove : undefined,
            onMapClick: handleMapClick,
            onTransform: () => {
                renderDrawOverlayPaths();
                renderPointOverlayMarker();
                renderMapMarkerPosition();
            },
        },
    );
    renderPointOverlayMarker();
    renderMapMarkerPosition();
}

function renderDrawOverlayPaths() {
    if (!appRoot) return;
    const overlay = appRoot.querySelector<HTMLCanvasElement>(
        "#draw-overlay-canvas",
    );
    const canvas =
        mapCanvas || appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
    if (!overlay || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    overlay.width = rect.width * scale;
    overlay.height = rect.height * scale;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // Sync the overlay's position to the main canvas so drawn points
    // are pixel-accurate regardless of split-view or other layout shifts.
    if (state.splitView) {
        overlay.style.left = "50%";
        overlay.style.top = "0";
        overlay.style.transform = "translateX(-50%)";
        overlay.style.right = "";
        overlay.style.bottom = "";
    } else {
        const overlayParent = overlay.offsetParent as HTMLElement | null;
        const parentRect = overlayParent?.getBoundingClientRect();
        if (parentRect) {
            overlay.style.left = `${rect.left - parentRect.left}px`;
            overlay.style.top = `${rect.top - parentRect.top}px`;
            overlay.style.transform = "";
            overlay.style.right = "";
            overlay.style.bottom = "";
        }
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Get points to render - either from active drawing or completed polygon
    let pointsToRender: LatLon[] = [];
    if (state.drawState.active) {
        // Active drawing mode - show current points with preview
        const basePoints = [...state.drawState.points];
        pointsToRender = state.drawState.previewPoint
            ? [...basePoints, state.drawState.previewPoint]
            : basePoints;
    } else if (state.mapPolygon && state.mapPolygon.length >= 3) {
        // Completed polygon - show the stored polygon
        pointsToRender = state.mapPolygon;
    } else {
        // Nothing to render
        ctx.restore();
        return;
    }

    const projected: { x: number; y: number }[] = [];
    pointsToRender.forEach((p) => {
        const proj = projectLonLatToCanvas(canvas, p.lon, p.lat);
        if (proj) {
            projected.push(proj);
        }
    });

    if (!projected.length) {
        ctx.restore();
        return;
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#34d399";
    ctx.fillStyle = "rgba(52,211,153,0.18)";
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < projected.length; i++) {
        ctx.lineTo(projected[i].x, projected[i].y);
    }
    if (projected.length > 2) {
        ctx.closePath();
        ctx.fill();
    }
    ctx.stroke();

    // Only show point markers when actively drawing
    if (state.drawState.active) {
        projected.forEach(({ x, y }, idx) => {
            ctx.beginPath();
            ctx.fillStyle = idx === 0 ? "#10b981" : "#34d399";
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#0f172a";
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }

    ctx.restore();
}

function renderDrawOverlay() {
    // Always render the overlay canvas if we're drawing or have a completed polygon
    const shouldShowOverlay =
        state.drawState.active ||
        (state.mapPolygon !== null && state.mapPolygon.length >= 3);
    if (!shouldShowOverlay) return "";

    // In split view the main canvas is centered with left:50%/translateX(-50%).
    // The overlay must use the SAME positioning so both share the same origin.
    const overlayStyle = state.splitView
        ? `position:absolute;top:0;left:50%;transform:translateX(-50%);pointer-events:none;z-index:9`
        : styleAttr(styles.drawOverlayCanvas);

    return `
      <canvas
        id="draw-overlay-canvas"
        style="${overlayStyle}"
      ></canvas>
    `;
}

function renderPointOverlayMarker() {
    if (!appRoot) return;
    const marker = appRoot.querySelector<HTMLDivElement>(
        "#point-overlay-marker",
    );
    const canvas =
        mapCanvas || appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
    if (!marker || !canvas || !state.pointSelectActive) return;

    marker.style.left = "0px";
    marker.style.top = "0px";
    marker.style.right = "0px";
    marker.style.bottom = "0px";
    marker.style.width = "100%";
    marker.style.height = "100%";
}

function renderMapMarkerPosition() {
    if (!appRoot) return;
    const marker = appRoot.querySelector<HTMLDivElement>(
        "#map-location-marker",
    );
    const infoPanel = appRoot.querySelector<HTMLDivElement>("#map-info-panel");
    const canvas =
        mapCanvas || appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
    if (!canvas) return;

    const hasPolygon =
        state.mapPolygon !== null && state.mapPolygon.length >= 3;

    // Compute canvas offset relative to the marker's offsetParent (the pane div).
    // In split-view the canvas is centred with left:50%/translateX(-50%) and
    // overflows the pane, so canvas-relative coords must be shifted by this offset
    // before being used as CSS position values inside the pane.
    const canvasRect = canvas.getBoundingClientRect();
    const markerOffsetParent = marker?.offsetParent as HTMLElement | null;
    const markerParentRect = markerOffsetParent?.getBoundingClientRect();
    const canvasOffsetLeft = markerParentRect ? canvasRect.left - markerParentRect.left : 0;
    const canvasOffsetTop  = markerParentRect ? canvasRect.top  - markerParentRect.top  : 0;

    // Handle marker visibility
    if (marker) {
        if (!state.mapMarker) {
            marker.style.opacity = "0";
            marker.style.transform = "translate(-9999px, -9999px)";
            marker.title = "Selected location";
        } else {
            const projected = projectLonLatToCanvas(
                canvas,
                state.mapMarker.lon,
                state.mapMarker.lat,
            );
            marker.title = state.mapMarker.name
                ? state.mapMarker.name
                : `Pixel ${state.mapMarker.pixel.x}, ${state.mapMarker.pixel.y}`;
            if (!projected) {
                marker.style.opacity = "0";
                marker.style.transform = "translate(-9999px, -9999px)";
            } else {
                marker.style.opacity = "1";
                marker.style.transform = `translate(${projected.x + canvasOffsetLeft}px, ${projected.y + canvasOffsetTop}px) translate(-50%, -100%)`;
            }
        }
    }

    // Handle info panel positioning - show for both marker and polygon
    if (infoPanel && state.mapInfoOpen) {
        const rect = canvas.getBoundingClientRect();
        const panelWidth = infoPanel.offsetWidth || 360;
        const panelHeight = infoPanel.offsetHeight || 240;
        const padding = 12;
        const sidebarOffset = state.sidebarOpen ? SIDEBAR_WIDTH : 0;
        const offsetParent = infoPanel.offsetParent as HTMLElement | null;
        const parentRect = offsetParent?.getBoundingClientRect();
        const originLeft = parentRect ? rect.left - parentRect.left : 0;
        const originTop = parentRect ? rect.top - parentRect.top : 0;

        let left: number;
        let top: number;

        if (mapInfoDragPosition) {
            left = mapInfoDragPosition.left;
            top = mapInfoDragPosition.top;
        } else if (state.mapMarker) {
            // Position relative to marker
            const projected = projectLonLatToCanvas(
                canvas,
                state.mapMarker.lon,
                state.mapMarker.lat,
            );
            if (!projected) {
                infoPanel.style.opacity = "0";
                infoPanel.style.transform = "translate(-9999px, -9999px)";
                infoPanel.style.pointerEvents = "none";
                infoPanel.style.visibility = "hidden";
                return;
            }
            left = originLeft + projected.x - panelWidth - 24;
            if (left < padding) {
                left = originLeft + projected.x + 24;
            }
            top = originTop + projected.y - panelHeight / 2;
        } else if (hasPolygon && state.mapPolygon) {
            // Find leftmost point and position window to the left of it
            let leftmostPoint = state.mapPolygon[0];
            for (const point of state.mapPolygon) {
                if (point.lon < leftmostPoint.lon) {
                    leftmostPoint = point;
                }
            }

            const leftmostProjected = projectLonLatToCanvas(
                canvas,
                leftmostPoint.lon,
                leftmostPoint.lat,
            );
            if (leftmostProjected) {
                left = originLeft + leftmostProjected.x - panelWidth - 24;
                if (left < padding) {
                    left = originLeft + leftmostProjected.x + 24;
                }
                top = originTop + leftmostProjected.y - panelHeight / 2;
            } else {
                // Fallback to center-right if projection fails
                left = originLeft + rect.width - panelWidth - padding - 24;
                top = originTop + rect.height / 2 - panelHeight / 2;
            }
        } else {
            // Hide if neither marker nor polygon
            infoPanel.style.opacity = "0";
            infoPanel.style.transform = "translate(-9999px, -9999px)";
            infoPanel.style.pointerEvents = "none";
            infoPanel.style.visibility = "hidden";
            return;
        }

        const minLeft = originLeft + padding;
        const maxLeft =
            originLeft + rect.width - panelWidth - padding - sidebarOffset;
        const minTop = originTop + padding;
        const maxTop = originTop + rect.height - panelHeight - padding;
        left = Math.max(minLeft, Math.min(left, maxLeft));
        top = Math.max(minTop, Math.min(top, maxTop));
        if (mapInfoDragPosition) {
            mapInfoDragPosition = { left, top };
        }

        // Only update position if it hasn't been set yet (to prevent glitching during data updates)
        const currentLeft = infoPanel.style.left;
        const currentTop = infoPanel.style.top;
        const shouldUpdatePosition =
            mapInfoDragPosition !== null ||
            mapInfoDragState.active ||
            !currentLeft ||
            currentLeft === "0px" ||
            !currentTop ||
            currentTop === "0px";
        if (shouldUpdatePosition) {
            infoPanel.style.left = `${left}px`;
            infoPanel.style.top = `${top}px`;
        }

        infoPanel.style.opacity = "1";
        infoPanel.style.transform = "translate(0, 0)";
        infoPanel.style.pointerEvents = "auto";
        infoPanel.style.visibility = "visible";
    } else if (infoPanel && !state.mapInfoOpen) {
        // Hide if not open
        infoPanel.style.opacity = "0";
        infoPanel.style.transform = "translate(-9999px, -9999px)";
        infoPanel.style.pointerEvents = "none";
        infoPanel.style.visibility = "hidden";
    }
}

function updateMapSearchPosition() {
    if (!appRoot) return;
    const wrapper = appRoot.querySelector<HTMLDivElement>(
        '[data-role="map-location-search"]',
    );
    if (!wrapper) return;
    // In split view the search bar lives inside the window-1 relative container,
    // so it is already centred within that pane and needs no sidebar shift.
    const shift = (!state.splitView && state.sidebarOpen) ? -SIDEBAR_WIDTH / 2 : 0;
    wrapper.style.transform = `translateX(calc(-50% + ${shift}px))`;
}

function renderPointOverlay() {
    if (!state.pointSelectActive) return "";
    return `
      <div style="${styleAttr(styles.drawOverlay)}"></div>
      <div
        id="point-overlay-marker"
        style="${styleAttr({
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 9,
        })}"
      ></div>
      <div style="${styleAttr(styles.drawPrompt)}">
        <div>Click a point to sample</div>
        <div style="${styleAttr(styles.drawPromptSub)}">
          The chart will load data for this single location
        </div>
      </div>
    `;
}

function renderMapMarkerOverlay() {
    const marker = state.mapMarker;
    const title = marker?.name
        ? escapeHtml(marker.name)
        : marker
          ? `Pixel ${marker.pixel.x}, ${marker.pixel.y}`
          : "Selected location";
    return `
      <div
        id="map-location-marker"
        style="${styleAttr(styles.mapMarker)}"
        aria-hidden="true"
        title="${title}"
      >
        <svg
          viewBox="0 0 28 36"
          width="28"
          height="36"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="map-marker-gradient" x1="0" x2="1">
              <stop offset="0%" stop-color="var(--accent-blue)" />
              <stop offset="100%" stop-color="var(--accent-purple)" />
            </linearGradient>
          </defs>
          <path
            d="M14 2C8.48 2 4 6.48 4 12c0 7.72 8.4 19.3 9.1 20.25.5.68 1.3.68 1.8 0C15.6 31.3 24 19.72 24 12 24 6.48 19.52 2 14 2Z"
            fill="url(#map-marker-gradient)"
          />
          <circle cx="14" cy="12" r="4.5" fill="rgba(9, 14, 28, 0.9)" />
          <circle cx="14" cy="12" r="3" fill="white" opacity="0.9" />
        </svg>
      </div>
    `;
}

function renderMapInfoBody(): string {
    const hasPoint = state.mapMarker !== null;
    const hasPolygon =
        state.mapPolygon !== null && state.mapPolygon.length >= 3;

    // Compute a stable y-domain from the full range dataset so that the axis
    // doesn't jump when hovering over individual dates.
    // Use the same unit-converted values as buildChartBoxes so the domain
    // stays correct when the user switches units.
    let rangeYDomain: [number, number] | undefined;
    if (state.mapRangeSamples.length) {
        const { variable: rv, unit: ru } = getActiveMapVariable();
        const vals = state.mapRangeSamples
            .map(s => convertValue(s.rawValue, rv, ru))
            .filter(isFinite);
        if (vals.length) {
            const rMin = Math.min(...vals);
            const rMax = Math.max(...vals);
            const pad = Math.max(Math.abs(rMax - rMin) * 0.12, 1e-6);
            rangeYDomain = [rMin - pad, rMax + pad];
        }
    }

    if (!hasPoint && !hasPolygon) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">Click a location or draw a region to load boxplots.</div>`;
    }

    if (state.mapInfoLoading) {
        const { unit } = getActiveMapVariable();
        const progressText =
            state.mapInfoLoadingProgress.total > 0
                ? `${state.mapInfoLoadingProgress.done}/${state.mapInfoLoadingProgress.total} datasets loaded`
                : "Preparing datasets";
        const preview =
            state.mapInfoBoxes && state.mapInfoBoxes.length
                ? renderMiniChartSvg(
                      state.mapInfoBoxes,
                      unit,
                      state.mapInfoPalette,
                      rangeYDomain,
                  )
                : `<div style="${styleAttr(
                      styles.chartEmpty,
                  )}">Loading boxplots...</div>`;
        return `
          <div style="${styleAttr(styles.mapInfoLoadingRow)}">
            <div style="${styleAttr(styles.mapInfoLoadingSpinner)}"></div>
            <div>${progressText}</div>
          </div>
          ${preview}
        `;
    }

    if (state.mapInfoError) {
        return `<div style="${styleAttr(styles.chartError)}">${escapeHtml(
            state.mapInfoError,
        )}</div>`;
    }

    if (!state.mapInfoBoxes || !state.mapInfoBoxes.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">Click a location to load boxplots.</div>`;
    }

    return renderMiniChartSvg(
        state.mapInfoBoxes,
        getActiveMapVariable().unit,
        state.mapInfoPalette,
        rangeYDomain,
    );
}

function renderMapInfoWindow() {
    if (!state.mapInfoOpen) return "";
    const marker = state.mapMarker;
    const hasPolygon =
        state.mapPolygon !== null && state.mapPolygon.length >= 3;
    const locationLabel = hasPolygon
        ? "Drawn Region"
        : marker?.name
          ? marker.name
          : marker
            ? `Pixel ${marker.pixel.x}, ${marker.pixel.y}`
            : "Selected location";
    const { variable, unit } = getActiveMapVariable();
    const variableLabel = getVariableLabel(variable, state.metaData);
    const title = `${locationLabel} · ${variableLabel}`;
    const subtitle = `${formatDisplayDate(state.date)} · ${unit}`;
    const panelSizeStyle = mapInfoSize
        ? `; width:${mapInfoSize.width}px; max-width:none; height:${mapInfoSize.height}px;`
        : "";
    return `
      <div id="map-info-panel" class="custom-select-info-panel map-info-panel" style="${styleAttr(
          styles.mapInfoPanel,
      )}${panelSizeStyle}">
        <div class="map-info-header" style="${styleAttr(
            styles.mapInfoHeader,
        )}">
          <div style="${styleAttr(styles.mapInfoTitleGroup)}">
            <div class="custom-select-info-panel-title">${escapeHtml(
                title,
            )}</div>
            <div style="${styleAttr(styles.mapInfoSubtitle)}">${escapeHtml(
                subtitle,
            )}</div>
          </div>
          <div style="${styleAttr(styles.mapInfoActions)}">
            ${renderOverlayPaletteSelect("mapInfoPalette", state.mapInfoPalette)}
            <button
              type="button"
              data-action="close-map-info"
              aria-label="Close info"
              style="${styleAttr(styles.mapInfoActionBtn)}"
              onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15, 23, 42, 0.85)';"
              onmouseout="this.style.color='var(--text-secondary)';this.style.background='transparent';"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="map-info-body" style="${styleAttr(styles.mapInfoBody)}">
          ${renderMapInfoBody()}
        </div>
        <button
          type="button"
          data-action="open-map-info-chart"
          aria-label="Open chart view"
          style="${styleAttr({
              ...styles.mapInfoActionBtn,
              ...styles.mapInfoExpandBtn,
          })}"
          onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15, 23, 42, 0.85)';"
          onmouseout="this.style.color='var(--text-secondary)';this.style.background='transparent';"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5H5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15 5h4v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 19H5v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15 19h4v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div
          class="map-info-resize-handle"
          aria-hidden="true"
          style="${styleAttr(styles.mapInfoResizeHandle)}"
          title="Resize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style="display:block;">
            <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    `;
}

function renderMapRangeBody(containerWidth?: number): string {
    const { unit } = getMapRangeVariable();
    const cw = containerWidth ?? getRangeOverlayWidth();
    if (state.mapRangeLoading) {
        const progressText =
            state.mapRangeLoadingProgress.total > 0
                ? `${state.mapRangeLoadingProgress.done}/${state.mapRangeLoadingProgress.total} datasets loaded`
                : "Preparing datasets";
        const preview =
            state.mapRangeSeries && state.mapRangeSeries.length
                ? `<div style="${styleAttr(styles.mapRangeChartWrap)}">${renderChartRangeSvg(
                      state.mapRangeSeries,
                      {
                          compact: true,
                          unitLabel: unit,
                          paletteName: state.mapRangePalette,
                          lightToDarkNoDarkest: true,
                          containerWidth: cw,
                          hiddenScenarios: state.mapRangeHiddenScenarios,
                          currentDate: state.date,
                      },
                  )}</div>`
                : `<div style="${styleAttr(
                      styles.chartEmpty,
                  )}">Loading range view...</div>`;
        return `
          <div style="${styleAttr(styles.mapRangeLoadingRow)}">
            <div style="${styleAttr(styles.mapRangeLoadingSpinner)}"></div>
            <div>${progressText}</div>
          </div>
          ${preview}
        `;
    }

    if (state.mapRangeError) {
        return `<div style="${styleAttr(styles.chartError)}">${escapeHtml(
            state.mapRangeError,
        )}</div>`;
    }

    if (!state.mapRangeSeries || !state.mapRangeSeries.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">Click a location to load the range view.</div>`;
    }

    const palette = paletteOptions.find(p => p.name === state.mapRangePalette) || paletteOptions[0];
    const overlayColors = palette.colors.length > 2
        ? palette.colors.slice(1).reverse()
        : [...palette.colors].reverse();
    const seriesColors = overlayColors.length ? overlayColors : palette.colors;

    const toggleButtons = state.mapRangeSeries.map((entry, idx) => {
        const color = seriesColors[idx % seriesColors.length];
        const isHidden = state.mapRangeHiddenScenarios.includes(entry.scenario);
        const circleFill = isHidden ? "none" : color;
        return `<button
            data-action="map-range-toggle-scenario"
            data-scenario="${escapeHtml(entry.scenario)}"
            style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:2px 6px 2px 2px;color:var(--text-secondary);font-size:11px;border-radius:4px;opacity:${isHidden ? "0.45" : "1"};">
            <svg width="10" height="10" style="flex-shrink:0;overflow:visible;">
              <circle cx="5" cy="5" r="4" fill="${circleFill}" stroke="${color}" stroke-width="1.5"/>
            </svg>
            <span>${escapeHtml(entry.scenario)}</span>
        </button>`;
    }).join("");

    return `<div style="${styleAttr(styles.mapRangeChartWrap)}">${renderChartRangeSvg(
        state.mapRangeSeries,
        {
            compact: true,
            unitLabel: unit,
            paletteName: state.mapRangePalette,
            lightToDarkNoDarkest: true,
            containerWidth: cw,
            hiddenScenarios: state.mapRangeHiddenScenarios,
            currentDate: state.date,
        },
    )}</div>
    <div style="display:flex;flex-wrap:wrap;gap:2px 4px;padding:4px 6px 2px 6px;">${toggleButtons}</div>`;
}

function renderMapRangeOverlay(inPane = false) {
    if (
        state.canvasView !== "map" ||
        !state.mapRangeOpen ||
        !state.mapMarker ||
        (state.mapPolygon !== null && state.mapPolygon.length >= 3)
    ) {
        return "";
    }
    const { variable } = getMapRangeVariable();
    const variableLabel = getVariableLabel(variable, state.metaData);
    const title = `${variableLabel}`;
    const rightOffset = state.sidebarOpen ? SIDEBAR_WIDTH : 0;
    // In split-view the overlay lives inside pane-1 (position:relative/overflow:hidden),
    // so we use position:absolute to clip it to that pane and derive width from the pane.
    const paneWidth = inPane ? window.innerWidth * state.splitRatio : window.innerWidth;
    const overlayStyle = inPane
        ? { ...styles.mapRangeOverlay, position: "absolute" as const, right: rightOffset }
        : { ...styles.mapRangeOverlay, right: rightOffset };
    return `
      <div id="map-range-overlay" style="${styleAttr(overlayStyle)}">
        <div style="${styleAttr(styles.mapRangePanel)}">
          <div style="${styleAttr(styles.mapRangeHeader)}">
            <div style="${styleAttr(styles.mapRangeTitleGroup)}">
              <div class="map-range-title" style="${styleAttr(styles.mapRangeTitle)}">${escapeHtml(
                  title,
              )}</div>
              <div style="display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap;">
                <select
                  data-action="map-range-preset"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:12px;padding:3px 6px;outline:none;cursor:pointer;"
                >
                  ${(["1month","1year","10years","full","custom"] as const).map(p => {
                      const labels: Record<string,string> = {"1month":"1 Month","1year":"1 Year","10years":"10 Years","full":"Full Range","custom":"Custom"};
                      return `<option value="${p}" ${state.mapRangePreset===p?"selected":""}>${labels[p]}</option>`;
                  }).join("")}
                </select>
                ${state.mapRangePreset === "custom" ? `
                <input
                  type="date"
                  data-action="map-range-date-start"
                  value="${state.mapRangeStart}"
                  min="1950-01-01" max="2099-12-31"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:11.5px;padding:3px 5px;outline:none;"
                />
                <span style="color:var(--text-secondary);font-size:12px;">–</span>
                <input
                  type="date"
                  data-action="map-range-date-end"
                  value="${state.mapRangeEnd}"
                  min="1950-01-02" max="2100-01-01"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:11.5px;padding:3px 5px;outline:none;"
                />
                ` : ""}
                <input
                  type="number"
                  data-action="map-range-num-samples"
                  value="${state.mapRangeNumSamples}"
                  min="2" max="3650" step="1"
                  title="Number of data points"
                  style="width:52px;background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:12px;padding:3px 5px;outline:none;text-align:center;"
                />
                <button
                  type="button"
                  data-action="map-range-apply"
                  style="padding:3px 9px;border-radius:6px;border:1px solid rgba(125,211,252,0.4);background:rgba(125,211,252,0.12);color:var(--text-primary);font-size:11.5px;font-weight:700;cursor:pointer;letter-spacing:0.2px;"
                >Apply</button>
              </div>
            </div>
            <div style="${styleAttr(styles.mapInfoActions)}">
              <button
                type="button"
                data-action="toggle-map-info"
                aria-label="${state.mapInfoOpen ? "Hide" : "Show"} boxplot panel"
                title="${state.mapInfoOpen ? "Hide" : "Show"} boxplot panel"
                style="${styleAttr({...styles.mapInfoActionBtn, color: state.mapInfoOpen ? "var(--text-primary)" : "var(--text-secondary)", background: state.mapInfoOpen ? "rgba(255,255,255,0.08)" : "transparent"})}"
                onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15,23,42,0.85)';"
                onmouseout="this.style.color='${state.mapInfoOpen ? "var(--text-primary)" : "var(--text-secondary)"}';"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="5" height="18" rx="1"/>
                  <rect x="9.5" y="8" width="5" height="13" rx="1"/>
                  <rect x="17" y="12" width="5" height="9" rx="1"/>
                </svg>
              </button>
              ${renderOverlayPaletteSelect(
                  "mapRangePalette",
                  state.mapRangePalette,
              )}
              <button
                type="button"
                data-action="close-map-range"
                aria-label="Close range view"
                style="${styleAttr(styles.mapInfoActionBtn)}"
                onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15, 23, 42, 0.85)';"
                onmouseout="this.style.color='var(--text-secondary)';this.style.background='transparent';"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="map-range-body" style="${styleAttr(styles.mapRangeBody)}">
            ${renderMapRangeBody(paneWidth - rightOffset)}
          </div>
        </div>
      </div>
    `;
}

function startRegionDrawing() {
    state.chartLocation = "Draw";
    state.chartPolygon = null;
    state.chartLocationName = null;
    state.chartLocationSearchResults = [];
    state.chartLocationSearchQuery = "";
    state.chartLocationSearchError = null;
    state.chartLocationSearchLoading = false;
    state.chartError = null;
    state.pointSelectActive = false;
    state.drawState = { active: true, points: [], previewPoint: null };
    state.canvasView = "map";
    ensureDrawKeyListener(completeRegionDrawing);
    render();
    loadClimateData();
}

function stopRegionDrawing() {
    state.drawState = resetDrawState();
    removeDrawKeyListener();
}

function startMapDrawing() {
    if (state.canvasView !== "map") return;
    state.mapPolygon = null;
    state.mapMarker = null;
    state.mapInfoOpen = false;
    closeMapRangeOverlay();
    state.drawState = { active: true, points: [], previewPoint: null };
    state.pointSelectActive = false;
    ensureDrawKeyListener(completeMapDrawing);
    render();
}

function stopMapDrawing() {
    state.drawState = resetDrawState();
    removeDrawKeyListener();
}

function completeMapDrawing() {
    if (!state.drawState.active) return;
    if (state.drawState.points.length < 3) {
        state.mapInfoError = "Draw at least three points to define a region.";
        state.mapInfoOpen = true;
        render();
        return;
    }
    state.mapPolygon = state.drawState.points;
    state.mapMarker = null;
    closeMapRangeOverlay();
    state.drawState = resetDrawState();
    removeDrawKeyListener();
    state.mapInfoError = null;
    // Open info window immediately for polygon
    state.mapInfoOpen = true;
    render(); // Render immediately to show the completed polygon and info window
    void loadMapInfoData();
}

function startPointSelection() {
    state.chartLocation = "Point";
    state.chartPolygon = null;
    state.chartPoint = null;
    state.chartLocationName = null;
    state.chartLocationSearchResults = [];
    state.chartLocationSearchQuery = "";
    state.chartLocationSearchError = null;
    state.chartLocationSearchLoading = false;
    state.chartError = null;
    state.drawState = resetDrawState();
    // Reset chart unit to default for current variable to ensure correct conversion
    state.chartUnit = getDefaultUnitOption(state.chartVariable).label;
    state.pointSelectActive = true;
    state.canvasView = "map";
    render();
    loadClimateData();
}

function stopPointSelection() {
    state.pointSelectActive = false;
}

async function fetchLocationSuggestions(
    query: string,
): Promise<LocationSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = `${API_BASE_URL}/geocode/search?query=${encodeURIComponent(
        trimmed,
    )}&limit=5`;
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error("Location search failed. Please try again.");
    }

    const payload = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
    }>;

    return payload
        .map((item) => ({
            displayName: item.display_name,
            lat: Number(item.lat),
            lon: Number(item.lon),
        }))
        .filter(
            (item) => Number.isFinite(item.lat) && Number.isFinite(item.lon),
        );
}

async function fetchReverseGeocode(
    lat: number,
    lon: number,
): Promise<string | null> {
    const url = `${API_BASE_URL}/geocode/reverse?lat=${lat}&lon=${lon}`;
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        return null;
    }

    const payload = (await response.json()) as {
        display_name?: string;
    };

    return payload.display_name || null;
}

function applySearchedLocation(result: LocationSearchResult) {
    if (locationSearchDebounce !== null) {
        window.clearTimeout(locationSearchDebounce);
        locationSearchDebounce = null;
    }
    state.chartLocation = "Search";
    state.chartPoint = { lat: result.lat, lon: result.lon };
    state.chartLocationName = result.displayName;
    state.chartLocationSearchError = null;
    state.chartLocationSearchResults = [];
    state.chartLocationSearchLoading = false;
    state.chartLocationSearchQuery = "";
    state.chartError = null;
    state.chartPolygon = null;
    state.pointSelectActive = false;
    state.drawState = resetDrawState();
    state.canvasView = "chart";
    stopRegionDrawing();
    stopPointSelection();
    render();
    loadChartData();
}

async function handleLocationSearch(query: string) {
    const trimmed = query.trim();
    const requestId = ++locationSearchRequestId;
    state.chartLocation = "Search";
    state.chartLocationSearchQuery = query;
    state.chartLocationSearchError = null;
    state.chartLocationSearchResults = [];
    state.chartLocationName = null;
    state.chartPoint = null;
    state.chartError = null;
    state.chartPolygon = null;
    state.pointSelectActive = false;
    state.drawState = resetDrawState();
    state.canvasView = "chart";
    stopRegionDrawing();
    stopPointSelection();

    if (!trimmed) {
        state.chartLocationSearchLoading = false;
        state.chartLocationSearchResults = [];
        state.chartLocationSearchError = null;
        render();
        return;
    }

    state.chartLocationSearchLoading = true;
    render();

    try {
        const results = await fetchLocationSuggestions(trimmed);
        if (requestId !== locationSearchRequestId) return;
        state.chartLocationSearchResults = results;
        if (!results.length) {
            state.chartLocationSearchError = "No places found for that query.";
        }
    } catch (error) {
        if (requestId !== locationSearchRequestId) return;
        state.chartLocationSearchError =
            error instanceof Error ? error.message : "Search failed.";
    } finally {
        if (requestId !== locationSearchRequestId) return;
        state.chartLocationSearchLoading = false;
        render();
    }
}

function setMapMarker(lat: number, lon: number, name: string | null) {
    const [x, y] = latLonToGridIndices(lat, lon);
    state.mapMarker = { lat, lon, name, pixel: { x, y } };
}

function applyMapSearchedLocation(result: LocationSearchResult) {
    if (mapLocationSearchDebounce !== null) {
        window.clearTimeout(mapLocationSearchDebounce);
        mapLocationSearchDebounce = null;
    }
    state.mapLocationSearchError = null;
    state.mapLocationSearchResults = [];
    state.mapLocationSearchLoading = false;
    state.mapLocationSearchQuery = result.displayName;
    state.mapLocationSearchSelection = result.displayName;
    state.mapLocationSearchFocused = true;
    setMapMarker(result.lat, result.lon, result.displayName);
    render();
    if (mapCanvas) {
        const targetZoom = Math.max(getCurrentZoomLevel(), 3.2);
        zoomToLocation(mapCanvas, result.lon, result.lat, targetZoom);
        renderMapMarkerPosition();
    }
    scheduleMapInfoOpen();
    openMapRangeOverlay();
}

async function handleMapLocationSearch(query: string) {
    const trimmed = query.trim();
    const requestId = ++mapLocationSearchRequestId;
    state.mapLocationSearchQuery = query;
    state.mapLocationSearchError = null;
    state.mapLocationSearchResults = [];
    state.mapLocationSearchSelection = null;

    if (!trimmed) {
        state.mapLocationSearchLoading = false;
        state.mapLocationSearchResults = [];
        state.mapLocationSearchError = null;
        render();
        return;
    }

    state.mapLocationSearchLoading = true;
    render();

    try {
        const results = await fetchLocationSuggestions(trimmed);
        if (requestId !== mapLocationSearchRequestId) return;
        state.mapLocationSearchResults = results;
        if (!results.length) {
            state.mapLocationSearchError = "No places found for that query.";
        }
    } catch (error) {
        if (requestId !== mapLocationSearchRequestId) return;
        state.mapLocationSearchError =
            error instanceof Error ? error.message : "Search failed.";
    } finally {
        if (requestId !== mapLocationSearchRequestId) return;
        state.mapLocationSearchLoading = false;
        render();
    }
}

function applyMapSearchedLocationW2(result: LocationSearchResult) {
    if (mapLocationSearchDebounceW2 !== null) {
        window.clearTimeout(mapLocationSearchDebounceW2);
        mapLocationSearchDebounceW2 = null;
    }
    const w2 = state.window2;
    w2.mapLocationSearchError = null;
    w2.mapLocationSearchResults = [];
    w2.mapLocationSearchLoading = false;
    w2.mapLocationSearchQuery = result.displayName;
    w2.mapLocationSearchSelection = result.displayName;
    setMapMarkerW2(result.lat, result.lon, result.displayName);
    render();
    if (persistentCanvas2) {
        const targetZoom = Math.max(3.2, 3.2);
        zoomToLocationW2(persistentCanvas2, result.lon, result.lat, targetZoom);
        renderMapMarkerPositionW2();
    }
    scheduleMapInfoOpenW2();
    openMapRangeOverlayW2();
}

async function handleMapLocationSearchW2(query: string) {
    const trimmed = query.trim();
    const requestId = ++mapLocationSearchRequestIdW2;
    const w2 = state.window2;
    w2.mapLocationSearchQuery = query;
    w2.mapLocationSearchError = null;
    w2.mapLocationSearchResults = [];
    w2.mapLocationSearchSelection = null;

    if (!trimmed) {
        w2.mapLocationSearchLoading = false;
        w2.mapLocationSearchResults = [];
        w2.mapLocationSearchError = null;
        render();
        return;
    }

    w2.mapLocationSearchLoading = true;
    render();

    try {
        const results = await fetchLocationSuggestions(trimmed);
        if (requestId !== mapLocationSearchRequestIdW2) return;
        w2.mapLocationSearchResults = results;
        if (!results.length) w2.mapLocationSearchError = "No places found for that query.";
    } catch (error) {
        if (requestId !== mapLocationSearchRequestIdW2) return;
        w2.mapLocationSearchError = error instanceof Error ? error.message : "Search failed.";
    } finally {
        if (requestId !== mapLocationSearchRequestIdW2) return;
        w2.mapLocationSearchLoading = false;
        render();
    }
}

function startMapDrawingW2() {
    const w2 = state.window2;
    if (w2.canvasView !== "map") return;
    w2.mapPolygon = null;
    w2.mapMarker = null;
    w2.mapInfoOpen = false;
    closeMapRangeOverlayW2();
    w2.drawState = { active: true, points: [], previewPoint: null };
    render();
}

function stopMapDrawingW2() {
    state.window2.drawState = { active: false, points: [], previewPoint: null };
}

function updateMapMarkerNameOnly(placeName: string) {
    // Update state without triggering full re-render
    if (state.mapMarker) {
        state.mapMarker.name = placeName;
    }

    // Update only the DOM elements that display the name, without repositioning
    if (!appRoot) return;

    // Update marker title attribute
    const marker = appRoot.querySelector<HTMLDivElement>(
        "#map-location-marker",
    );
    if (marker && state.mapMarker) {
        marker.title = placeName;
    }

    // Update info panel title if it's open
    if (state.mapInfoOpen && state.mapMarker) {
        const titleElement = appRoot.querySelector<HTMLDivElement>(
            ".custom-select-info-panel-title",
        );
        if (titleElement) {
            const { variable } = getActiveMapVariable();
            const variableLabel = getVariableLabel(variable, state.metaData);
            const locationLabel = placeName;
            const title = `${locationLabel} · ${variableLabel}`;
            titleElement.textContent = title;
        }
    }

    if (state.mapRangeOpen && state.mapMarker) {
        const titleElement =
            appRoot.querySelector<HTMLDivElement>(".map-range-title");
        if (titleElement) {
            const { variable } = getMapRangeVariable();
            const variableLabel = getVariableLabel(variable, state.metaData);
            const title = `${placeName} · ${variableLabel}`;
            titleElement.textContent = title;
        }
    }
}

async function handleMapClick(coords: LatLon) {
    if (state.canvasView !== "map") return;
    if (state.drawState.active || state.pointSelectActive) return;

    // Clear polygon when clicking a new point
    state.mapPolygon = null;

    // Initially set marker with null name (will show pixel coordinates temporarily)
    setMapMarker(coords.lat, coords.lon, null);
    if (mapCanvas) {
        const targetZoom = Math.max(getCurrentZoomLevel(), 3.2);
        zoomToLocation(mapCanvas, coords.lon, coords.lat, targetZoom);
        renderMapMarkerPosition();
    }
    scheduleMapInfoOpen();
    openMapRangeOverlay();

    // Fetch place name from OpenStreetMap reverse geocoding
    try {
        const placeName = await fetchReverseGeocode(coords.lat, coords.lon);
        if (placeName) {
            // Update only the name, without repositioning the marker
            updateMapMarkerNameOnly(placeName);
        }
    } catch (error) {
        // Silently fail - keep showing pixel coordinates if reverse geocoding fails
        console.error("Failed to fetch reverse geocode:", error);
    }
}

function scheduleMapInfoOpen(delayMs = 700) {
    if (mapInfoDelayTimer !== null) {
        window.clearTimeout(mapInfoDelayTimer);
        mapInfoDelayTimer = null;
    }
    const wasOpen = state.mapInfoOpen;
    state.mapInfoOpen = false;
    if (wasOpen && appRoot) {
        const infoPanel =
            appRoot.querySelector<HTMLDivElement>("#map-info-panel");
        if (infoPanel) {
            infoPanel.style.opacity = "0";
            infoPanel.style.transform = "translate(-9999px, -9999px)";
            infoPanel.style.pointerEvents = "none";
            infoPanel.style.visibility = "hidden";
        }
    }
    mapInfoDelayTimer = window.setTimeout(() => {
        mapInfoDelayTimer = null;
        const hasPoint = state.mapMarker !== null;
        const hasPolygon =
            state.mapPolygon !== null && state.mapPolygon.length >= 3;
        if (!hasPoint && !hasPolygon) return;
        state.mapInfoOpen = true;
        render();
        void loadMapInfoData();
    }, delayMs);
}

function closeMapInfoWindow() {
    if (mapInfoDelayTimer !== null) {
        window.clearTimeout(mapInfoDelayTimer);
        mapInfoDelayTimer = null;
    }
    mapInfoRequestId += 1;
    state.mapInfoOpen = false;
    state.mapInfoLoading = false;
    mapInfoSize = null;
    mapInfoNaturalSize = null;
    render();
}

/**
 * Reuse already-loaded range samples to immediately populate the map info
 * panel for a given target date, without firing any API requests.
 * Finds the nearest sampled date in mapRangeSamples and feeds those entries
 * to updateMapInfoPreview.
 * Returns true if samples were available and the panel was updated.
 */
function applyRangeSamplesAsMapInfo(targetDate: string): boolean {
    if (!state.mapRangeSamples.length) return false;

    const targetMs = parseDate(targetDate).getTime();

    // Collect the unique set of sampled dates
    const uniqueDates = Array.from(new Set(state.mapRangeSamples.map(s => s.dateUsed)));
    if (!uniqueDates.length) return false;

    // Find the closest sampled date to the target
    let closestDate = uniqueDates[0];
    let closestDiff = Math.abs(parseDate(uniqueDates[0]).getTime() - targetMs);
    for (const d of uniqueDates) {
        const diff = Math.abs(parseDate(d).getTime() - targetMs);
        if (diff < closestDiff) { closestDiff = diff; closestDate = d; }
    }

    // Extract all (scenario, model) samples for that closest date
    const nearest = state.mapRangeSamples.filter(s => s.dateUsed === closestDate);
    if (!nearest.length) return false;

    // Stamp the samples with the actual selected date so the panel label matches
    const stamped: ChartSample[] = nearest.map(s => ({ ...s, dateUsed: targetDate }));
    updateMapInfoPreview(stamped);
    return true;
}

function updateMapInfoPreview(samples: ChartSample[]) {
    state.mapInfoSamples = samples;
    try {
        const { variable, unit } = getActiveMapVariable();
        state.mapInfoBoxes = buildChartBoxes(samples, variable, unit);
    } catch {
        return;
    }

    // Update only the body content without repositioning the window
    if (!appRoot) {
        render();
        return;
    }

    const infoPanel = appRoot.querySelector<HTMLDivElement>("#map-info-panel");
    if (infoPanel) {
        const bodyElement =
            infoPanel.querySelector<HTMLDivElement>(".map-info-body");
        if (bodyElement) {
            // Update only the body content without triggering a full render
            bodyElement.innerHTML = renderMapInfoBody();
            setTimeout(() => { attachMapInfoBoxplotHoverListeners(); }, 0);
            return;
        }
    }

    // If the panel is intentionally closed, don't trigger a full render —
    // that would recreate the range SVG and kill the hover crosshair.
    if (!state.mapInfoOpen) return;

    // Fallback to full render if elements not found
    render();
    setTimeout(() => { attachMapInfoBoxplotHoverListeners(); }, 0);
}

function openMapRangeOverlay(delayMs = 560) {
    if (!state.mapMarker || state.mapPolygon) return;
    if (mapRangeDelayTimer !== null) {
        window.clearTimeout(mapRangeDelayTimer);
        mapRangeDelayTimer = null;
    }
    mapRangeDelayTimer = window.setTimeout(() => {
        mapRangeDelayTimer = null;
        if (!state.mapMarker || state.mapPolygon) return;
        const currentDate = getCurrentDateForMode(state);
        const range = buildMapRangeForPreset(state.mapRangePreset, currentDate) ?? buildMapRangeWindow(currentDate);
        state.mapRangeStart = range.start;
        state.mapRangeEnd = range.end;
        state.mapRangeOpen = true;
        render();
        void loadMapRangeData();
    }, delayMs);
}

function closeMapRangeOverlay() {
    if (mapRangeDelayTimer !== null) {
        window.clearTimeout(mapRangeDelayTimer);
        mapRangeDelayTimer = null;
    }
    mapRangeRequestId += 1;
    state.mapRangeOpen = false;
    state.mapRangeLoading = false;
    state.mapRangeError = null;
    state.mapRangeSamples = [];
    state.mapRangeSeries = null;
    state.mapRangeLoadingProgress = { total: 0, done: 0 };
    render();
}

function updateMapRangePreview(samples: ChartSample[]) {
    const { variable, unit } = getMapRangeVariable();
    state.mapRangeSamples = samples;
    try {
        state.mapRangeSeries = buildChartRangeSeries(samples, variable, unit);
    } catch {
        return;
    }

    if (!appRoot) {
        render();
        return;
    }

    const rangePanel =
        appRoot.querySelector<HTMLDivElement>("#map-range-overlay");
    if (rangePanel) {
        const bodyElement =
            rangePanel.querySelector<HTMLDivElement>(".map-range-body");
        if (bodyElement) {
            bodyElement.innerHTML = renderMapRangeBody();
            return;
        }
    }

    render();
}

async function loadMapRangeData() {
    if (state.canvasView !== "map") return;
    const hasPoint = state.mapMarker !== null;
    const hasPolygon =
        state.mapPolygon !== null && state.mapPolygon.length >= 3;

    if (!hasPoint || hasPolygon || !state.mapMarker) {
        state.mapRangeLoading = false;
        state.mapRangeError = null;
        state.mapRangeSamples = [];
        state.mapRangeSeries = null;
        state.mapRangeLoadingProgress = { total: 0, done: 0 };
        state.mapRangeOpen = false;
        render();
        return;
    }

    const requestId = ++mapRangeRequestId;
    const { variable: rangeVariable, unit: rangeUnit } = getMapRangeVariable();
    const range = { start: state.mapRangeStart, end: state.mapRangeEnd };
    state.mapRangeLoading = true;
    state.mapRangeError = null;
    state.mapRangeSamples = [];
    state.mapRangeSeries = null;
    state.mapRangeLoadingProgress = { total: 0, done: 0 };
    state.mapRangeOpen = true;
    render();

    try {
        const metaData = state.metaData ?? (await fetchMetadata());
        if (!state.metaData) {
            state.metaData = metaData;
        }

        const scenarioOptions = metaData?.scenarios?.length
            ? Array.from(
                  new Set(metaData.scenarios.map(normalizeScenarioLabel)),
              )
            : scenarios;
        const modelOptions = metaData?.models?.length
            ? metaData.models
            : models;

        const activeScenarios = (
            state.chartScenarios.length ? state.chartScenarios : scenarioOptions
        ).filter((s) => scenarioOptions.includes(s));
        const activeModels = (
            state.chartModels.length ? state.chartModels : modelOptions
        ).filter((m) => modelOptions.includes(m));

        if (!activeScenarios.length || !activeModels.length) {
            state.mapRangeError = "Select at least one scenario and one model.";
            state.mapRangeLoading = false;
            state.mapRangeLoadingProgress = { total: 0, done: 0 };
            render();
            return;
        }

        const useFixedAnnualSamples = shouldUseFixedAnnualSamples(
            range.start,
            range.end,
        );
        const fixedReferenceDate = range.start;
        const spanDays = Math.max(1, Math.round(
            (parseDate(range.end).getTime() - parseDate(range.start).getTime()) / (24 * 60 * 60 * 1000)
        ));
        const computedStepDays = Math.max(1, Math.round(spanDays / state.mapRangeNumSamples));

        const totalRequests = activeScenarios.length * activeModels.length;
        state.mapRangeLoadingProgress = { total: totalRequests, done: 0 };
        render();

        const samples: ChartSample[] = [];
        let _mapRangeDone = 0;
        const _marker = state.mapMarker!; // non-null: guarded by the early return above

        await pLimit(
            activeModels.flatMap((model) =>
                activeScenarios.map((scenario) => async () => {
                    if (requestId !== mapRangeRequestId) return;
                    try {
                        const pointSamples = await loadRangePointSamples({
                            variable: rangeVariable,
                            model,
                            scenario,
                            point: _marker,
                            rangeStart: range.start,
                            rangeEnd: range.end,
                            useFixedAnnualSamples,
                            fixedReferenceDate,
                            stepDays: computedStepDays,
                        });
                        samples.push(...pointSamples);
                    } catch (err) {
                        console.warn(
                            `Map range samples failed for ${model}/${scenario}:`,
                            err,
                        );
                    } finally {
                        _mapRangeDone++;
                        state.mapRangeLoadingProgress = {
                            total: totalRequests,
                            done: _mapRangeDone,
                        };
                        updateMapRangePreview(samples);
                    }
                }),
            ),
            PARALLEL_REQUEST_LIMIT,
        );

        if (requestId !== mapRangeRequestId) return;
        state.mapRangeSamples = samples;
        state.mapRangeSeries = buildChartRangeSeries(
            samples,
            rangeVariable,
            rangeUnit,
        );
        state.mapRangeLoadingProgress = {
            total: totalRequests,
            done: totalRequests,
        };
    } catch (error) {
        if (requestId !== mapRangeRequestId) return;
        state.mapRangeError =
            error instanceof Error
                ? error.message
                : "Failed to load range data.";
        state.mapRangeSamples = [];
        state.mapRangeSeries = null;
        state.mapRangeLoadingProgress = { total: 0, done: 0 };
    } finally {
        if (requestId !== mapRangeRequestId) return;
        state.mapRangeLoading = false;
        render();
    }
}

async function loadMapInfoData() {
    if (state.canvasView !== "map") return;
    const { variable: mapVariable } = getActiveMapVariable();
    // Check if we have either a marker (point) or a polygon
    const hasPoint = state.mapMarker !== null;
    const hasPolygon =
        state.mapPolygon !== null && state.mapPolygon.length >= 3;

    if (!hasPoint && !hasPolygon) {
        state.mapInfoLoading = false;
        state.mapInfoError = null;
        state.mapInfoSamples = [];
        state.mapInfoBoxes = null;
        state.mapInfoLoadingProgress = { total: 0, done: 0 };
        state.mapInfoOpen = false;
        render();
        return;
    }

    const requestId = ++mapInfoRequestId;
    state.mapInfoLoading = true;
    state.mapInfoError = null;
    state.mapInfoSamples = [];
    state.mapInfoBoxes = null;
    state.mapInfoLoadingProgress = { total: 0, done: 0 };
    render();

    try {
        const metaData = state.metaData ?? (await fetchMetadata());
        if (!state.metaData) {
            state.metaData = metaData;
        }

        const scenarioOptions = metaData?.scenarios?.length
            ? Array.from(
                  new Set(metaData.scenarios.map(normalizeScenarioLabel)),
              )
            : scenarios;
        const currentDate = getCurrentDateForMode(state);
        const matchingScenarios = scenarioOptions.filter((scenario) =>
            isDateWithinRange(currentDate, getTimeRangeForScenario(scenario)),
        );
        const activeScenarios = matchingScenarios.length
            ? matchingScenarios.includes("Historical")
                ? ["Historical"]
                : matchingScenarios
            : scenarioOptions;
        const modelOptions = metaData?.models?.length
            ? metaData.models
            : models;

        if (!scenarioOptions.length || !modelOptions.length) {
            state.mapInfoError = "Select at least one scenario and one model.";
            state.mapInfoLoading = false;
            state.mapInfoLoadingProgress = { total: 0, done: 0 };
            render();
            return;
        }

        const totalRequests = activeScenarios.length * modelOptions.length;
        state.mapInfoLoadingProgress = { total: totalRequests, done: 0 };
        render();

        const samples: ChartSample[] = [];

        for (const scenario of activeScenarios) {
            if (requestId !== mapInfoRequestId) return;
            const dateForScenario = clipDateToRange(
                currentDate,
                getTimeRangeForScenario(scenario),
            );

            if (hasPoint && state.mapMarker) {
                // Point selection – fire all models in parallel (full raster; pixel-data
                // endpoint returns 502 for single-date reads — see debug notes)
                const _marker = state.mapMarker;
                await Promise.allSettled(
                    modelOptions.map(async (model) => {
                        try {
                            const request = createDataRequest({
                                variable: mapVariable,
                                date: dateForScenario,
                                model,
                                scenario,
                                resolution: 1,
                            });
                            const data = await fetchClimateData(request);
                            const arr = dataToArray(data);
                            if (arr) {
                                const avg = valueAtPoint(
                                    arr,
                                    mapVariable,
                                    data.shape,
                                    { lat: _marker.lat, lon: _marker.lon },
                                );
                                samples.push({
                                    scenario,
                                    model,
                                    rawValue: avg,
                                    dateUsed: dateForScenario,
                                });
                            }
                        } catch (error) {
                            console.warn(
                                `Map info request failed for model ${model}:`,
                                error,
                            );
                        }
                        state.mapInfoLoadingProgress = {
                            total: totalRequests,
                            done: state.mapInfoLoadingProgress.done + 1,
                        };
                        updateMapInfoPreview(samples);
                    }),
                );
            } else if (hasPolygon && state.mapPolygon) {
                // Polygon selection - use aggregate API
                const [x0, x1, clientY0, clientY1] = polygonToGridBounds(state.mapPolygon);
                // Flip y bounds: OpenVisus is south-up, polygonToGridBounds is north-down.
                // North-down y0 (small = north) → large OV index; y1 (large = south) → small OV index.
                const y0 = GRID_HEIGHT - 1 - clientY1;
                const y1 = GRID_HEIGHT - 1 - clientY0;
                // Mask rows were built north-to-south; reverse them to match south-up OV window.
                const mask = createPolygonMask(
                    state.mapPolygon,
                    x0,
                    x1,
                    clientY0,
                    clientY1,
                ).reverse();

                try {
                    const aggregateData = await fetchAggregateOnDemand({
                        variable: mapVariable,
                        models: modelOptions,
                        x0,
                        x1,
                        y0,
                        y1,
                        start_date: dateForScenario,
                        end_date: dateForScenario,
                        scenario: normalizeScenario(scenario),
                        resolution: "low",
                        step_days: 1,
                        mask,
                    });

                    for (const model of modelOptions) {
                        const modelData = aggregateData.models[model];
                        if (modelData) {
                            const value = modelData.values[0];
                            if (value !== null && isFinite(value)) {
                                const rawValue =
                                    mapVariable === "hurs"
                                        ? Math.min(value, 100)
                                        : value;
                                samples.push({
                                    scenario,
                                    model,
                                    rawValue,
                                    dateUsed: dateForScenario,
                                });
                            }
                        }
                    }

                    state.mapInfoLoadingProgress = {
                        total: totalRequests,
                        done:
                            state.mapInfoLoadingProgress.done +
                            modelOptions.length,
                    };
                    updateMapInfoPreview(samples);
                } catch (error) {
                    // If batch fails, fall back to old method for all models
                    console.warn(
                        `Aggregate API failed for scenario ${scenario}, falling back to full map load:`,
                        error,
                    );
                    for (const model of modelOptions) {
                        if (requestId !== mapInfoRequestId) return;
                        const request = createDataRequest({
                            variable: mapVariable,
                            date: dateForScenario,
                            model,
                            scenario,
                            resolution: 1,
                        });
                        try {
                            const data = await fetchClimateData(request);
                            const arr = dataToArray(data);
                            if (arr) {
                                const avg = averageArrayInPolygon(
                                    arr,
                                    mapVariable,
                                    data.shape,
                                    state.mapPolygon,
                                );
                                samples.push({
                                    scenario,
                                    model,
                                    rawValue: avg,
                                    dateUsed: dateForScenario,
                                });
                            }
                        } catch (modelError) {
                            console.warn(
                                `Failed to load data for model ${model}:`,
                                modelError,
                            );
                        }
                        state.mapInfoLoadingProgress = {
                            total: totalRequests,
                            done: state.mapInfoLoadingProgress.done + 1,
                        };
                        updateMapInfoPreview(samples);
                    }
                }
            }
        }

        if (requestId !== mapInfoRequestId) return;
        state.mapInfoLoading = false;
        render();
    } catch (error) {
        if (requestId !== mapInfoRequestId) return;
        state.mapInfoError =
            error instanceof Error
                ? error.message
                : "Failed to load map chart data.";
        state.mapInfoLoading = false;
        state.mapInfoLoadingProgress = { total: 0, done: 0 };
        render();
    }
}

// ─── Window-2 location / map-info / range-overlay helpers ─────────────────────

function getActiveMapVariableW2(): { variable: string; unit: string } {
    const w2 = state.window2;
    if (w2.mode === "Ensemble") {
        return { variable: w2.ensembleVariable, unit: w2.ensembleUnit };
    }
    return { variable: w2.variable, unit: w2.selectedUnit };
}

function setMapMarkerW2(lat: number, lon: number, name: string | null) {
    const [x, y] = latLonToGridIndices(lat, lon);
    state.window2.mapMarker = { lat, lon, name, pixel: { x, y } };
}

function renderMapMarkerOverlayW2(): string {
    const marker = state.window2.mapMarker;
    const title = marker?.name
        ? escapeHtml(marker.name)
        : marker
          ? `Pixel ${marker.pixel.x}, ${marker.pixel.y}`
          : "Selected location";
    return `
      <div
        id="map-location-marker-w2"
        style="${styleAttr(styles.mapMarker)}"
        aria-hidden="true"
        title="${title}"
      >
        <svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="map-marker-gradient-w2" x1="0" x2="1">
              <stop offset="0%" stop-color="var(--accent-blue)" />
              <stop offset="100%" stop-color="var(--accent-purple)" />
            </linearGradient>
          </defs>
          <path d="M14 2C8.48 2 4 6.48 4 12c0 7.72 8.4 19.3 9.1 20.25.5.68 1.3.68 1.8 0C15.6 31.3 24 19.72 24 12 24 6.48 19.52 2 14 2Z" fill="url(#map-marker-gradient-w2)"/>
          <circle cx="14" cy="12" r="4.5" fill="rgba(9, 14, 28, 0.9)" />
          <circle cx="14" cy="12" r="3" fill="white" opacity="0.9" />
        </svg>
      </div>
    `;
}

function renderMapMarkerPositionW2(): void {
    if (!appRoot) return;
    const marker = appRoot.querySelector<HTMLDivElement>("#map-location-marker-w2");
    const infoPanel = appRoot.querySelector<HTMLDivElement>("#map-info-panel-w2");
    const canvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas-2");
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const markerOffsetParent = marker?.offsetParent as HTMLElement | null;
    const markerParentRect = markerOffsetParent?.getBoundingClientRect();
    const canvasOffsetLeft = markerParentRect ? canvasRect.left - markerParentRect.left : 0;
    const canvasOffsetTop  = markerParentRect ? canvasRect.top  - markerParentRect.top  : 0;

    if (marker) {
        if (!state.window2.mapMarker) {
            marker.style.opacity = "0";
            marker.style.transform = "translate(-9999px, -9999px)";
        } else {
            const projected = projectLonLatToCanvasW2(canvas, state.window2.mapMarker.lon, state.window2.mapMarker.lat);
            if (!projected) {
                marker.style.opacity = "0";
                marker.style.transform = "translate(-9999px, -9999px)";
            } else {
                marker.style.opacity = "1";
                marker.style.transform = `translate(${projected.x + canvasOffsetLeft}px, ${projected.y + canvasOffsetTop}px) translate(-50%, -100%)`;
            }
        }
    }

    if (infoPanel && state.window2.mapInfoOpen && state.window2.mapMarker) {
        const padding = 12;
        const sidebarOffset = state.window2.sidebarOpen ? SIDEBAR_WIDTH : 0;
        const offsetParent = infoPanel.offsetParent as HTMLElement | null;
        const parentRect = offsetParent?.getBoundingClientRect();
        const originLeft = parentRect ? canvasRect.left - parentRect.left : 0;
        const originTop  = parentRect ? canvasRect.top  - parentRect.top  : 0;

        const panelWidth = infoPanel.offsetWidth || 360;
        const panelHeight = infoPanel.offsetHeight || 240;

        if (mapInfoDragPositionW2) {
            infoPanel.style.left = `${mapInfoDragPositionW2.left}px`;
            infoPanel.style.top  = `${mapInfoDragPositionW2.top}px`;
        } else {
            const projected = projectLonLatToCanvasW2(canvas, state.window2.mapMarker.lon, state.window2.mapMarker.lat);
            if (projected) {
                let left = originLeft + projected.x - panelWidth - 24;
                if (left < padding) left = originLeft + projected.x + 24;
                let top = originTop + projected.y - panelHeight / 2;
                left = Math.max(padding, Math.min(left, canvasRect.width - panelWidth - sidebarOffset - padding));
                top  = Math.max(padding, Math.min(top, canvasRect.height - panelHeight - padding));
                infoPanel.style.left = `${left}px`;
                infoPanel.style.top  = `${top}px`;
            }
        }
        infoPanel.style.opacity   = "1";
        infoPanel.style.transform = "translate(0, 0)";
        infoPanel.style.visibility = "visible";
        infoPanel.style.pointerEvents = "auto";
    } else if (infoPanel && !state.window2.mapInfoOpen) {
        infoPanel.style.opacity   = "0";
        infoPanel.style.transform = "translate(-9999px, -9999px)";
        infoPanel.style.pointerEvents = "none";
        infoPanel.style.visibility = "hidden";
    }
}

function renderMapInfoBodyW2(): string {
    const w2 = state.window2;
    if (!w2.mapMarker) {
        return `<div style="${styleAttr(styles.chartEmpty)}">Click a location to load boxplots.</div>`;
    }

    let rangeYDomain: [number, number] | undefined;
    if (w2.mapRangeSamples.length) {
        const { variable: rv, unit: ru } = getActiveMapVariableW2();
        const vals = w2.mapRangeSamples.map(s => convertValue(s.rawValue, rv, ru)).filter(isFinite);
        if (vals.length) {
            const rMin = Math.min(...vals);
            const rMax = Math.max(...vals);
            const pad = Math.max(Math.abs(rMax - rMin) * 0.12, 1e-6);
            rangeYDomain = [rMin - pad, rMax + pad];
        }
    }

    if (w2.mapInfoLoading) {
        const { unit } = getActiveMapVariableW2();
        const progressText = w2.mapInfoLoadingProgress.total > 0
            ? `${w2.mapInfoLoadingProgress.done}/${w2.mapInfoLoadingProgress.total} datasets loaded`
            : "Preparing datasets";
        const preview = w2.mapInfoBoxes && w2.mapInfoBoxes.length
            ? renderMiniChartSvg(w2.mapInfoBoxes, unit, w2.mapInfoPalette, rangeYDomain)
            : `<div style="${styleAttr(styles.chartEmpty)}">Loading boxplots...</div>`;
        return `
          <div style="${styleAttr(styles.mapInfoLoadingRow)}">
            <div style="${styleAttr(styles.mapInfoLoadingSpinner)}"></div>
            <div>${progressText}</div>
          </div>
          ${preview}
        `;
    }

    if (w2.mapInfoError) {
        return `<div style="${styleAttr(styles.chartError)}">${escapeHtml(w2.mapInfoError)}</div>`;
    }

    if (!w2.mapInfoBoxes || !w2.mapInfoBoxes.length) {
        return `<div style="${styleAttr(styles.chartEmpty)}">Click a location to load boxplots.</div>`;
    }

    return renderMiniChartSvg(w2.mapInfoBoxes, getActiveMapVariableW2().unit, w2.mapInfoPalette, rangeYDomain);
}

function renderMapInfoWindowW2(): string {
    const w2 = state.window2;
    if (!w2.mapInfoOpen) return "";
    const marker = w2.mapMarker;
    const locationLabel = marker?.name
        ? marker.name
        : marker
          ? `Pixel ${marker.pixel.x}, ${marker.pixel.y}`
          : "Selected location";
    const { variable, unit } = getActiveMapVariableW2();
    const variableLabel = getVariableLabel(variable, state.metaData);
    const title = `${locationLabel} · ${variableLabel}`;
    const subtitle = `${formatDisplayDate(w2.date)} · ${unit}`;
    const panelSizeStyle = mapInfoSizeW2
        ? `; width:${mapInfoSizeW2.width}px; max-width:none; height:${mapInfoSizeW2.height}px;`
        : "";
    return `
      <div id="map-info-panel-w2" class="custom-select-info-panel map-info-panel" style="${styleAttr(styles.mapInfoPanel)}${panelSizeStyle}">
        <div class="map-info-header-w2 map-info-header" style="${styleAttr(styles.mapInfoHeader)}">
          <div style="${styleAttr(styles.mapInfoTitleGroup)}">
            <div class="custom-select-info-panel-title-w2">${escapeHtml(title)}</div>
            <div style="${styleAttr(styles.mapInfoSubtitle)}">${escapeHtml(subtitle)}</div>
          </div>
          <div style="${styleAttr(styles.mapInfoActions)}">
            <button type="button" data-action="close-map-info-w2" aria-label="Close info"
              style="${styleAttr(styles.mapInfoActionBtn)}"
              onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15,23,42,0.85)';"
              onmouseout="this.style.color='var(--text-secondary)';this.style.background='transparent';">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="map-info-body-w2 map-info-body" style="${styleAttr(styles.mapInfoBody)}">
          ${renderMapInfoBodyW2()}
        </div>
        <div class="map-info-resize-handle-w2 map-info-resize-handle" aria-hidden="true"
          style="${styleAttr(styles.mapInfoResizeHandle)}" title="Resize">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style="display:block;">
            <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    `;
}

function renderMapRangeBodyW2(containerWidth?: number): string {
    const w2 = state.window2;
    const { unit } = getActiveMapVariableW2(); /* note: getMapRangeVariableW2 = getActiveMapVariableW2 */
    const paneWidth = window.innerWidth * (1 - state.splitRatio);
    const rightOffset = w2.sidebarOpen ? SIDEBAR_WIDTH : 0;
    const cw = containerWidth ?? (paneWidth - rightOffset);

    if (w2.mapRangeLoading) {
        const progressText = w2.mapRangeLoadingProgress.total > 0
            ? `${w2.mapRangeLoadingProgress.done}/${w2.mapRangeLoadingProgress.total} datasets loaded`
            : "Preparing datasets";
        const preview = w2.mapRangeSeries && w2.mapRangeSeries.length
            ? `<div style="${styleAttr(styles.mapRangeChartWrap)}">${renderChartRangeSvg(w2.mapRangeSeries, {
                compact: true, unitLabel: unit, paletteName: w2.mapRangePalette,
                lightToDarkNoDarkest: true, containerWidth: cw,
                hiddenScenarios: w2.mapRangeHiddenScenarios,
                currentDate: w2.date,
              })}</div>`
            : `<div style="${styleAttr(styles.chartEmpty)}">Loading range view...</div>`;
        return `
          <div style="${styleAttr(styles.mapRangeLoadingRow)}">
            <div style="${styleAttr(styles.mapRangeLoadingSpinner)}"></div>
            <div>${progressText}</div>
          </div>
          ${preview}
        `;
    }

    if (w2.mapRangeError) {
        return `<div style="${styleAttr(styles.chartError)}">${escapeHtml(w2.mapRangeError)}</div>`;
    }

    if (!w2.mapRangeSeries || !w2.mapRangeSeries.length) {
        return `<div style="${styleAttr(styles.chartEmpty)}">Click a location to load the range view.</div>`;
    }

    const palette = paletteOptions.find(p => p.name === w2.mapRangePalette) || paletteOptions[0];
    const overlayColors = palette.colors.length > 2 ? palette.colors.slice(1).reverse() : [...palette.colors].reverse();
    const seriesColors = overlayColors.length ? overlayColors : palette.colors;

    const toggleButtons = w2.mapRangeSeries.map((entry, idx) => {
        const color = seriesColors[idx % seriesColors.length];
        const isHidden = w2.mapRangeHiddenScenarios.includes(entry.scenario);
        const circleFill = isHidden ? "none" : color;
        return `<button data-action="map-range-toggle-scenario-w2" data-scenario="${escapeHtml(entry.scenario)}"
            style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:2px 6px 2px 2px;color:var(--text-secondary);font-size:11px;border-radius:4px;opacity:${isHidden ? "0.45" : "1"};">
            <svg width="10" height="10" style="flex-shrink:0;overflow:visible;">
              <circle cx="5" cy="5" r="4" fill="${circleFill}" stroke="${color}" stroke-width="1.5"/>
            </svg>
            <span>${escapeHtml(entry.scenario)}</span>
          </button>`;
    }).join("");

    return `<div style="${styleAttr(styles.mapRangeChartWrap)}">${renderChartRangeSvg(w2.mapRangeSeries, {
        compact: true, unitLabel: unit, paletteName: w2.mapRangePalette,
        lightToDarkNoDarkest: true, containerWidth: cw,
        hiddenScenarios: w2.mapRangeHiddenScenarios,
        currentDate: w2.date,
    })}</div><div style="display:flex;flex-wrap:wrap;gap:2px 6px;margin-top:4px;">${toggleButtons}</div>`;
}

function renderMapRangeOverlayW2(): string {
    const w2 = state.window2;
    if (w2.canvasView !== "map" || !w2.mapRangeOpen || !w2.mapMarker) return "";
    const { variable } = getActiveMapVariableW2();
    const variableLabel = getVariableLabel(variable, state.metaData);
    const rightOffset = w2.sidebarOpen ? SIDEBAR_WIDTH : 0;
    const paneWidth = window.innerWidth * (1 - state.splitRatio);
    // position:absolute so it stays clipped inside pane-2
    const overlayStyle = { ...styles.mapRangeOverlay, position: "absolute" as const, right: rightOffset };
    return `
      <div id="map-range-overlay-w2" style="${styleAttr(overlayStyle)}">
        <div style="${styleAttr(styles.mapRangePanel)}">
          <div style="${styleAttr(styles.mapRangeHeader)}">
            <div style="${styleAttr(styles.mapRangeTitleGroup)}">
              <div class="map-range-title-w2" style="${styleAttr(styles.mapRangeTitle)}">${escapeHtml(variableLabel)}</div>
              <div style="display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap;">
                <select data-action="map-range-preset-w2"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:12px;padding:3px 6px;outline:none;cursor:pointer;">
                  ${(["1month","1year","10years","full","custom"] as const).map(p => {
                      const labels: Record<string,string> = {"1month":"1 Month","1year":"1 Year","10years":"10 Years","full":"Full Range","custom":"Custom"};
                      return `<option value="${p}" ${w2.mapRangePreset===p?"selected":""}>${labels[p]}</option>`;
                  }).join("")}
                </select>
                ${w2.mapRangePreset === "custom" ? `
                <input type="date" data-action="map-range-date-start-w2" value="${w2.mapRangeStart}"
                  min="1950-01-01" max="2099-12-31"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:11.5px;padding:3px 5px;outline:none;"/>
                <span style="color:var(--text-secondary);font-size:12px;">–</span>
                <input type="date" data-action="map-range-date-end-w2" value="${w2.mapRangeEnd}"
                  min="1950-01-02" max="2100-01-01"
                  style="background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:11.5px;padding:3px 5px;outline:none;"/>
                ` : ""}
                <input type="number" data-action="map-range-num-samples-w2" value="${w2.mapRangeNumSamples}"
                  min="2" max="3650" step="1" title="Number of data points"
                  style="width:52px;background:var(--dark-bg);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);font-size:12px;padding:3px 5px;outline:none;text-align:center;"/>
                <button type="button" data-action="map-range-apply-w2"
                  style="padding:3px 9px;border-radius:6px;border:1px solid rgba(125,211,252,0.4);background:rgba(125,211,252,0.12);color:var(--text-primary);font-size:11.5px;font-weight:700;cursor:pointer;letter-spacing:0.2px;">Apply</button>
              </div>
            </div>
            <div style="${styleAttr(styles.mapInfoActions)}">
              <button type="button" data-action="toggle-map-info-w2"
                aria-label="${w2.mapInfoOpen ? "Hide" : "Show"} boxplot panel" title="${w2.mapInfoOpen ? "Hide" : "Show"} boxplot panel"
                style="${styleAttr({...styles.mapInfoActionBtn, color: w2.mapInfoOpen ? "var(--text-primary)" : "var(--text-secondary)", background: w2.mapInfoOpen ? "rgba(255,255,255,0.08)" : "transparent"})}"
                onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15,23,42,0.85)';"
                onmouseout="this.style.color='${w2.mapInfoOpen ? "var(--text-primary)" : "var(--text-secondary)"}';">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="5" height="18" rx="1"/><rect x="9.5" y="8" width="5" height="13" rx="1"/><rect x="17" y="12" width="5" height="9" rx="1"/>
                </svg>
              </button>
              <button type="button" data-action="close-map-range-w2" aria-label="Close range view"
                style="${styleAttr(styles.mapInfoActionBtn)}"
                onmouseover="this.style.color='var(--text-primary)';this.style.background='rgba(15,23,42,0.85)';"
                onmouseout="this.style.color='var(--text-secondary)';this.style.background='transparent';">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="map-range-body-w2" style="${styleAttr(styles.mapRangeBody)}">
            ${renderMapRangeBodyW2(paneWidth - rightOffset)}
          </div>
        </div>
      </div>
    `;
}

function updateMapInfoPreviewW2(samples: ChartSample[]) {
    const w2 = state.window2;
    w2.mapInfoSamples = samples;
    try {
        const { variable, unit } = getActiveMapVariableW2();
        w2.mapInfoBoxes = buildChartBoxes(samples, variable, unit);
    } catch {
        return;
    }
    if (!appRoot) { render(); return; }
    const infoPanel = appRoot.querySelector<HTMLDivElement>("#map-info-panel-w2");
    if (infoPanel) {
        const bodyEl = infoPanel.querySelector<HTMLDivElement>(".map-info-body-w2");
        if (bodyEl) { bodyEl.innerHTML = renderMapInfoBodyW2(); setTimeout(() => { attachMapInfoBoxplotHoverListeners("map-info-panel-w2"); }, 0); return; }
    }
    if (!w2.mapInfoOpen) return;
    render();
}

function updateMapRangePreviewW2(samples: ChartSample[]) {
    const w2 = state.window2;
    const { variable, unit } = getActiveMapVariableW2();
    w2.mapRangeSamples = samples;
    try {
        w2.mapRangeSeries = buildChartRangeSeries(samples, variable, unit);
    } catch {
        return;
    }
    if (!appRoot) { render(); return; }
    const rangePanel = appRoot.querySelector<HTMLDivElement>("#map-range-overlay-w2");
    if (rangePanel) {
        const bodyEl = rangePanel.querySelector<HTMLDivElement>(".map-range-body-w2");
        if (bodyEl) { bodyEl.innerHTML = renderMapRangeBodyW2(); return; }
    }
    if (!w2.mapRangeOpen) return;
    render();
}

function applyRangeSamplesAsMapInfoW2(targetDate: string): boolean {
    const w2 = state.window2;
    if (!w2.mapRangeSamples.length) return false;
    const targetMs = parseDate(targetDate).getTime();
    const uniqueDates = Array.from(new Set(w2.mapRangeSamples.map(s => s.dateUsed)));
    if (!uniqueDates.length) return false;
    let closestDate = uniqueDates[0];
    let closestDiff = Math.abs(parseDate(uniqueDates[0]).getTime() - targetMs);
    for (const d of uniqueDates) {
        const diff = Math.abs(parseDate(d).getTime() - targetMs);
        if (diff < closestDiff) { closestDiff = diff; closestDate = d; }
    }
    const nearest = w2.mapRangeSamples.filter(s => s.dateUsed === closestDate);
    if (!nearest.length) return false;
    const stamped: ChartSample[] = nearest.map(s => ({ ...s, dateUsed: targetDate }));
    updateMapInfoPreviewW2(stamped);
    return true;
}

async function loadMapInfoDataW2() {
    const w2 = state.window2;
    if (!w2.mapMarker) {
        w2.mapInfoLoading = false;
        w2.mapInfoOpen = false;
        render();
        return;
    }
    const requestId = ++mapInfoRequestIdW2;
    const { variable: mapVariable } = getActiveMapVariableW2();
    w2.mapInfoLoading = true;
    w2.mapInfoError = null;
    w2.mapInfoSamples = [];
    w2.mapInfoBoxes = null;
    w2.mapInfoLoadingProgress = { total: 0, done: 0 };
    render();

    try {
        const metaData = state.metaData ?? (await fetchMetadata());
        if (!state.metaData) state.metaData = metaData;

        const scenarioOptions = metaData?.scenarios?.length
            ? Array.from(new Set(metaData.scenarios.map(normalizeScenarioLabel)))
            : scenarios;
        const currentDateW2 = getCurrentDateForMode(w2);
        const matchingScenarios = scenarioOptions.filter(scenario =>
            isDateWithinRange(currentDateW2, getTimeRangeForScenario(scenario)));
        const activeScenarios = matchingScenarios.length
            ? matchingScenarios.includes("Historical") ? ["Historical"] : matchingScenarios
            : scenarioOptions;
        const modelOptions = metaData?.models?.length ? metaData.models : models;

        const totalRequests = activeScenarios.length * modelOptions.length;
        w2.mapInfoLoadingProgress = { total: totalRequests, done: 0 };
        render();

        const samples: ChartSample[] = [];
        const _marker = w2.mapMarker!;

        for (const scenario of activeScenarios) {
            if (requestId !== mapInfoRequestIdW2) return;
            const dateForScenario = clipDateToRange(currentDateW2, getTimeRangeForScenario(scenario));
            await Promise.allSettled(
                modelOptions.map(async (model) => {
                    if (requestId !== mapInfoRequestIdW2) return;
                    try {
                        const request = createDataRequest({ variable: mapVariable, date: dateForScenario, model, scenario, resolution: 1 });
                        const data = await fetchClimateData(request);
                        const arr = dataToArray(data);
                        if (arr) {
                            const avg = valueAtPoint(arr, mapVariable, data.shape, { lat: _marker.lat, lon: _marker.lon });
                            samples.push({ scenario, model, rawValue: avg, dateUsed: dateForScenario });
                        }
                    } catch (error) {
                        console.warn(`W2 map info request failed for model ${model}:`, error);
                    }
                    w2.mapInfoLoadingProgress = { total: totalRequests, done: w2.mapInfoLoadingProgress.done + 1 };
                    updateMapInfoPreviewW2(samples);
                }),
            );
        }

        if (requestId !== mapInfoRequestIdW2) return;
        w2.mapInfoLoading = false;
        render();
    } catch (error) {
        if (requestId !== mapInfoRequestIdW2) return;
        w2.mapInfoError = error instanceof Error ? error.message : "Failed to load map chart data.";
        w2.mapInfoLoading = false;
        w2.mapInfoLoadingProgress = { total: 0, done: 0 };
        render();
    }
}

async function loadMapRangeDataW2() {
    const w2 = state.window2;
    if (!w2.mapMarker) {
        w2.mapRangeLoading = false;
        w2.mapRangeOpen = false;
        render();
        return;
    }

    const requestId = ++mapRangeRequestIdW2;
    const { variable: rangeVariable, unit: rangeUnit } = getActiveMapVariableW2();
    const range = { start: w2.mapRangeStart, end: w2.mapRangeEnd };
    w2.mapRangeLoading = true;
    w2.mapRangeError = null;
    w2.mapRangeSamples = [];
    w2.mapRangeSeries = null;
    w2.mapRangeLoadingProgress = { total: 0, done: 0 };
    w2.mapRangeOpen = true;
    render();

    try {
        const metaData = state.metaData ?? (await fetchMetadata());
        if (!state.metaData) state.metaData = metaData;

        const scenarioOptions = metaData?.scenarios?.length
            ? Array.from(new Set(metaData.scenarios.map(normalizeScenarioLabel)))
            : scenarios;
        const modelOptions = metaData?.models?.length ? metaData.models : models;

        const activeScenarios = (state.chartScenarios.length ? state.chartScenarios : scenarioOptions)
            .filter(s => scenarioOptions.includes(s));
        const activeModels = (state.chartModels.length ? state.chartModels : modelOptions)
            .filter(m => modelOptions.includes(m));

        if (!activeScenarios.length || !activeModels.length) {
            w2.mapRangeError = "Select at least one scenario and one model.";
            w2.mapRangeLoading = false;
            w2.mapRangeLoadingProgress = { total: 0, done: 0 };
            render();
            return;
        }

        const useFixedAnnualSamples = shouldUseFixedAnnualSamples(range.start, range.end);
        const fixedReferenceDate = range.start;
        const spanDays = Math.max(1, Math.round(
            (parseDate(range.end).getTime() - parseDate(range.start).getTime()) / (24 * 60 * 60 * 1000)
        ));
        const computedStepDays = Math.max(1, Math.round(spanDays / w2.mapRangeNumSamples));

        const totalRequests = activeScenarios.length * activeModels.length;
        w2.mapRangeLoadingProgress = { total: totalRequests, done: 0 };
        render();

        const samples: ChartSample[] = [];
        let _done = 0;
        const _marker = w2.mapMarker!;

        await pLimit(
            activeModels.flatMap(model =>
                activeScenarios.map(scenario => async () => {
                    if (requestId !== mapRangeRequestIdW2) return;
                    try {
                        const pointSamples = await loadRangePointSamples({
                            variable: rangeVariable, model, scenario, point: _marker,
                            rangeStart: range.start, rangeEnd: range.end,
                            useFixedAnnualSamples, fixedReferenceDate, stepDays: computedStepDays,
                        });
                        samples.push(...pointSamples);
                    } catch (err) {
                        console.warn(`W2 map range failed for ${model}/${scenario}:`, err);
                    } finally {
                        _done++;
                        w2.mapRangeLoadingProgress = { total: totalRequests, done: _done };
                        updateMapRangePreviewW2(samples);
                    }
                })
            ),
            PARALLEL_REQUEST_LIMIT,
        );

        if (requestId !== mapRangeRequestIdW2) return;
        w2.mapRangeSamples = samples;
        w2.mapRangeSeries = buildChartRangeSeries(samples, rangeVariable, rangeUnit);
        w2.mapRangeLoadingProgress = { total: totalRequests, done: totalRequests };
    } catch (error) {
        if (requestId !== mapRangeRequestIdW2) return;
        w2.mapRangeError = error instanceof Error ? error.message : "Failed to load range data.";
        w2.mapRangeSamples = [];
        w2.mapRangeSeries = null;
        w2.mapRangeLoadingProgress = { total: 0, done: 0 };
    } finally {
        if (requestId !== mapRangeRequestIdW2) return;
        w2.mapRangeLoading = false;
        render();
    }
}

function scheduleMapInfoOpenW2(delayMs = 700) {
    const w2 = state.window2;
    if (mapInfoDelayTimerW2 !== null) {
        window.clearTimeout(mapInfoDelayTimerW2);
        mapInfoDelayTimerW2 = null;
    }
    const wasOpen = w2.mapInfoOpen;
    w2.mapInfoOpen = false;
    if (wasOpen && appRoot) {
        const infoPanel = appRoot.querySelector<HTMLDivElement>("#map-info-panel-w2");
        if (infoPanel) {
            infoPanel.style.opacity = "0";
            infoPanel.style.transform = "translate(-9999px, -9999px)";
            infoPanel.style.pointerEvents = "none";
            infoPanel.style.visibility = "hidden";
        }
    }
    mapInfoDelayTimerW2 = window.setTimeout(() => {
        mapInfoDelayTimerW2 = null;
        if (!w2.mapMarker) return;
        w2.mapInfoOpen = true;
        render();
        void loadMapInfoDataW2();
    }, delayMs);
}

function closeMapInfoWindowW2() {
    if (mapInfoDelayTimerW2 !== null) {
        window.clearTimeout(mapInfoDelayTimerW2);
        mapInfoDelayTimerW2 = null;
    }
    mapInfoRequestIdW2 += 1;
    state.window2.mapInfoOpen = false;
    state.window2.mapInfoLoading = false;
    mapInfoSizeW2 = null;
    mapInfoNaturalSizeW2 = null;
    render();
}

function openMapRangeOverlayW2(delayMs = 560) {
    const w2 = state.window2;
    if (!w2.mapMarker) return;
    if (mapRangeDelayTimerW2 !== null) {
        window.clearTimeout(mapRangeDelayTimerW2);
        mapRangeDelayTimerW2 = null;
    }
    mapRangeDelayTimerW2 = window.setTimeout(() => {
        mapRangeDelayTimerW2 = null;
        if (!w2.mapMarker) return;
        const currentDate = getCurrentDateForMode(w2);
        const range = buildMapRangeForPreset(w2.mapRangePreset, currentDate) ?? buildMapRangeWindow(currentDate);
        w2.mapRangeStart = range.start;
        w2.mapRangeEnd = range.end;
        w2.mapRangeOpen = true;
        render();
        void loadMapRangeDataW2();
    }, delayMs);
}

function closeMapRangeOverlayW2() {
    if (mapRangeDelayTimerW2 !== null) {
        window.clearTimeout(mapRangeDelayTimerW2);
        mapRangeDelayTimerW2 = null;
    }
    mapRangeRequestIdW2 += 1;
    const w2 = state.window2;
    w2.mapRangeOpen = false;
    w2.mapRangeLoading = false;
    w2.mapRangeError = null;
    w2.mapRangeSamples = [];
    w2.mapRangeSeries = null;
    w2.mapRangeLoadingProgress = { total: 0, done: 0 };
    render();
}

function updateMapMarkerNameOnlyW2(placeName: string) {
    const w2 = state.window2;
    if (w2.mapMarker) w2.mapMarker.name = placeName;
    if (!appRoot) return;
    const marker = appRoot.querySelector<HTMLDivElement>("#map-location-marker-w2");
    if (marker && w2.mapMarker) marker.title = placeName;
    if (w2.mapInfoOpen && w2.mapMarker) {
        const titleEl = appRoot.querySelector<HTMLDivElement>(".custom-select-info-panel-title-w2");
        if (titleEl) {
            const { variable } = getActiveMapVariableW2();
            const variableLabel = getVariableLabel(variable, state.metaData);
            titleEl.textContent = `${placeName} · ${variableLabel}`;
        }
    }
    if (w2.mapRangeOpen && w2.mapMarker) {
        const titleEl = appRoot.querySelector<HTMLDivElement>(".map-range-title-w2");
        if (titleEl) {
            const { variable } = getActiveMapVariableW2();
            const variableLabel = getVariableLabel(variable, state.metaData);
            titleEl.textContent = `${placeName} · ${variableLabel}`;
        }
    }
}

async function handleMapClickW2(coords: LatLon) {
    const w2 = state.window2;
    if (w2.canvasView !== "map") return;
    if (w2.drawState.active) return;

    w2.mapPolygon = null;
    setMapMarkerW2(coords.lat, coords.lon, null);

    const canvas2 = appRoot?.querySelector<HTMLCanvasElement>("#map-canvas-2");
    if (canvas2) {
        renderMapMarkerPositionW2();
    }
    scheduleMapInfoOpenW2();
    openMapRangeOverlayW2();

    try {
        const placeName = await fetchReverseGeocode(coords.lat, coords.lon);
        if (placeName) updateMapMarkerNameOnlyW2(placeName);
    } catch (error) {
        console.error("W2: Failed to fetch reverse geocode:", error);
    }
}

function attachW2MapInfoAndRangeHandlers(root: HTMLElement) {
    // Close map info
    root.querySelector<HTMLButtonElement>('[data-action="close-map-info-w2"]')
        ?.addEventListener("click", (e) => { e.preventDefault(); closeMapInfoWindowW2(); });

    // Toggle map info (barchart panel) from within range overlay
    root.querySelector<HTMLButtonElement>('[data-action="toggle-map-info-w2"]')
        ?.addEventListener("click", (e) => {
            e.preventDefault();
            const w2 = state.window2;
            if (w2.mapInfoOpen) {
                closeMapInfoWindowW2();
            } else {
                w2.mapInfoOpen = true;
                if (!applyRangeSamplesAsMapInfoW2(getCurrentDateForMode(w2))) void loadMapInfoDataW2();
                render();
                setTimeout(() => { attachMapInfoBoxplotHoverListeners("map-info-panel-w2"); }, 0);
            }
        });

    // Close range overlay
    root.querySelector<HTMLButtonElement>('[data-action="close-map-range-w2"]')
        ?.addEventListener("click", (e) => { e.preventDefault(); closeMapRangeOverlayW2(); });

    // Range preset select
    const rangePresetSelect = root.querySelector<HTMLSelectElement>('[data-action="map-range-preset-w2"]');
    rangePresetSelect?.addEventListener("change", () => {
        const w2 = state.window2;
        const preset = rangePresetSelect.value as Window2State["mapRangePreset"];
        w2.mapRangePreset = preset;
        if (preset !== "custom") {
            const range = buildMapRangeForPreset(preset, getCurrentDateForMode(w2));
            if (range) { w2.mapRangeStart = range.start; w2.mapRangeEnd = range.end; void loadMapRangeDataW2(); }
        } else {
            render();
        }
    });

    // Apply button
    root.querySelector<HTMLButtonElement>('[data-action="map-range-apply-w2"]')
        ?.addEventListener("click", () => {
            const w2 = state.window2;
            const samplesInput = root.querySelector<HTMLInputElement>('[data-action="map-range-num-samples-w2"]');
            if (samplesInput) {
                const n = parseInt(samplesInput.value, 10);
                if (!isNaN(n) && n >= 2) w2.mapRangeNumSamples = n;
            }
            if (w2.mapRangePreset === "custom") {
                const startInput = root.querySelector<HTMLInputElement>('[data-action="map-range-date-start-w2"]');
                const endInput   = root.querySelector<HTMLInputElement>('[data-action="map-range-date-end-w2"]');
                if (startInput?.value) w2.mapRangeStart = startInput.value;
                if (endInput?.value)   w2.mapRangeEnd   = endInput.value;
            }
            void loadMapRangeDataW2();
        });

    // Toggle individual scenario visibility — use event delegation so it survives body re-renders
    const rangeOverlayW2El = root.querySelector<HTMLElement>("#map-range-overlay-w2");
    rangeOverlayW2El?.addEventListener("click", (e) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('[data-action="map-range-toggle-scenario-w2"]');
        if (!btn) return;
        const scenario = btn.dataset.scenario;
        if (!scenario) return;
        const w2 = state.window2;
        const idx = w2.mapRangeHiddenScenarios.indexOf(scenario);
        if (idx >= 0) {
            w2.mapRangeHiddenScenarios = w2.mapRangeHiddenScenarios.filter(s => s !== scenario);
        } else {
            w2.mapRangeHiddenScenarios = [...w2.mapRangeHiddenScenarios, scenario];
        }
        const bodyEl = rangeOverlayW2El.querySelector<HTMLElement>(".map-range-body-w2");
        if (bodyEl) bodyEl.innerHTML = renderMapRangeBodyW2();
    });

    // Drag-to-move info panel
    const mapInfoPanel = root.querySelector<HTMLElement>("#map-info-panel-w2");
    const mapInfoHeader = root.querySelector<HTMLElement>(".map-info-header-w2");
    if (mapInfoPanel && mapInfoHeader) {
        mapInfoHeader.style.cursor = "grab";
        const onDragMove = (e: PointerEvent) => {
            if (!mapInfoDragStateW2.active) return;
            if (mapInfoDragStateW2.pointerId !== null && e.pointerId !== mapInfoDragStateW2.pointerId) return;
            e.preventDefault();
            const left = e.clientX - (mapInfoPanel.offsetParent as HTMLElement | null ?? document.body).getBoundingClientRect().left - mapInfoDragStateW2.offsetX;
            const top  = e.clientY - (mapInfoPanel.offsetParent as HTMLElement | null ?? document.body).getBoundingClientRect().top  - mapInfoDragStateW2.offsetY;
            mapInfoPanel.style.left = `${left}px`;
            mapInfoPanel.style.top  = `${top}px`;
            mapInfoDragPositionW2 = { left, top };
        };
        const onDragEnd = (e: PointerEvent) => {
            if (!mapInfoDragStateW2.active) return;
            if (mapInfoDragStateW2.pointerId !== null && e.pointerId !== mapInfoDragStateW2.pointerId) return;
            mapInfoDragStateW2.active = false;
            mapInfoDragStateW2.pointerId = null;
            mapInfoHeader.style.cursor = "grab";
            mapInfoPanel.releasePointerCapture?.(e.pointerId);
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onDragEnd);
        };
        mapInfoHeader.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest("button, .custom-select-wrapper")) return;
            e.preventDefault(); e.stopPropagation();
            const panelRect = mapInfoPanel.getBoundingClientRect();
            mapInfoDragStateW2.active   = true;
            mapInfoDragStateW2.pointerId = e.pointerId;
            mapInfoDragStateW2.offsetX  = e.clientX - panelRect.left;
            mapInfoDragStateW2.offsetY  = e.clientY - panelRect.top;
            mapInfoHeader.style.cursor  = "grabbing";
            mapInfoPanel.setPointerCapture?.(e.pointerId);
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onDragEnd);
        });
    }

    // Resize handle
    const resizeHandle = root.querySelector<HTMLElement>("#map-info-panel-w2 .map-info-resize-handle-w2");
    if (mapInfoPanel && resizeHandle) {
        const onResizeMove = (e: PointerEvent) => {
            if (!mapInfoResizeStateW2.active) return;
            if (mapInfoResizeStateW2.pointerId !== null && e.pointerId !== mapInfoResizeStateW2.pointerId) return;
            e.preventDefault();
            const dx = e.clientX - mapInfoResizeStateW2.startX;
            const dy = e.clientY - mapInfoResizeStateW2.startY;
            const minW = mapInfoNaturalSizeW2?.width ?? mapInfoResizeStateW2.startWidth;
            const minH = mapInfoNaturalSizeW2?.height ?? mapInfoResizeStateW2.startHeight;
            const newW = Math.max(minW, Math.min(Math.round(window.innerWidth * 0.85), mapInfoResizeStateW2.startWidth + dx));
            const newH = Math.max(minH, Math.min(Math.round(window.innerHeight * 0.85), mapInfoResizeStateW2.startHeight + dy));
            mapInfoSizeW2 = { width: newW, height: newH };
            mapInfoPanel.style.width = `${newW}px`; mapInfoPanel.style.maxWidth = "none"; mapInfoPanel.style.height = `${newH}px`;
        };
        const onResizeEnd = (e: PointerEvent) => {
            if (!mapInfoResizeStateW2.active) return;
            if (mapInfoResizeStateW2.pointerId !== null && e.pointerId !== mapInfoResizeStateW2.pointerId) return;
            mapInfoResizeStateW2.active = false; mapInfoResizeStateW2.pointerId = null;
            resizeHandle.style.opacity = "0.4"; mapInfoPanel.releasePointerCapture?.(e.pointerId);
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", onResizeMove);
            window.removeEventListener("pointerup", onResizeEnd);
        };
        resizeHandle.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const panelRect = mapInfoPanel.getBoundingClientRect();
            const sw = panelRect.width  || mapInfoSizeW2?.width  || 360;
            const sh = panelRect.height || mapInfoSizeW2?.height || 300;
            if (!mapInfoNaturalSizeW2 && !mapInfoSizeW2) mapInfoNaturalSizeW2 = { width: sw, height: sh };
            mapInfoResizeStateW2.active = true; mapInfoResizeStateW2.pointerId = e.pointerId;
            mapInfoResizeStateW2.startX = e.clientX; mapInfoResizeStateW2.startY = e.clientY;
            mapInfoResizeStateW2.startWidth = sw; mapInfoResizeStateW2.startHeight = sh;
            resizeHandle.style.opacity = "0.9"; mapInfoPanel.setPointerCapture?.(e.pointerId);
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onResizeMove);
            window.addEventListener("pointerup", onResizeEnd);
        });
        resizeHandle.addEventListener("mouseover", () => { if (!mapInfoResizeStateW2.active) resizeHandle.style.opacity = "0.8"; });
        resizeHandle.addEventListener("mouseout",  () => { if (!mapInfoResizeStateW2.active) resizeHandle.style.opacity = "0.4"; });
    }
}

function handleDrawMove(coords: LatLon) {
    if (!state.drawState.active) return;
    state.drawState = { ...state.drawState, previewPoint: coords };
    renderDrawOverlayPaths();
}

function handleDrawClick(coords: LatLon) {
    if (!state.drawState.active) return;
    const points = state.drawState.points;
    if (points.length >= 3 && isPointNear(coords, points[0])) {
        // Complete drawing - check if we're in chart mode or map mode
        if (state.canvasView === "chart" || state.chartLocation === "Draw") {
            completeRegionDrawing();
        } else if (state.canvasView === "map") {
            completeMapDrawing();
        }
        return;
    }
    state.drawState = {
        ...state.drawState,
        points: [...points, coords],
        previewPoint: coords,
    };
    renderDrawOverlayPaths();
}

function handlePointClick(coords: LatLon) {
    if (!state.pointSelectActive) return;
    state.chartPoint = coords;
    state.pointSelectActive = false;
    state.chartError = null;
    state.canvasView = "chart";
    render();
    loadChartData();
}

function completeRegionDrawing() {
    if (!state.drawState.active) return;
    if (state.drawState.points.length < 3) {
        state.chartError = "Draw at least three points to define a region.";
        render();
        return;
    }
    state.chartPolygon = state.drawState.points;
    state.drawState = resetDrawState();
    removeDrawKeyListener();
    state.chartError = null;
    state.canvasView = "chart";
    render();
    loadChartData();
}

function computeChartStats(values: number[]): ChartStats {
    const sorted = values
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    if (!sorted.length) {
        throw new Error("No valid values available to build chart statistics.");
    }
    const q1 = d3.quantileSorted(sorted, 0.25) ?? sorted[0];
    const median =
        d3.quantileSorted(sorted, 0.5) ?? sorted[Math.floor(sorted.length / 2)];
    const q3 = d3.quantileSorted(sorted, 0.75) ?? sorted[sorted.length - 1];
    const mean = d3.mean(sorted) ?? sorted[0];
    return {
        min: sorted[0],
        q1,
        median,
        q3,
        max: sorted[sorted.length - 1],
        mean,
        count: sorted.length,
    };
}

function buildChartBoxes(
    samples: ChartSample[],
    variable: string,
    unitLabel: string,
): ChartBox[] {
    const byScenario = new Map<string, ChartSample[]>();
    samples.forEach((sample) => {
        const current = byScenario.get(sample.scenario) ?? [];
        current.push(sample);
        byScenario.set(sample.scenario, current);
    });

    return Array.from(byScenario.entries()).map(([scenario, entries]) => {
        const converted = entries.map((entry) => {
            const value = convertValue(entry.rawValue, variable, unitLabel);
            return { ...entry, value };
        });
        const stats = computeChartStats(converted.map((v) => v.value));
        return {
            scenario,
            dateUsed: entries[0]?.dateUsed ?? "",
            samples: converted,
            stats,
        };
    });
}

function buildSampleDates(
    start: string,
    end: string,
    maxPoints = 50,
): string[] {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime()) ||
        maxPoints <= 0
    ) {
        return [];
    }

    let from = startDate;
    let to = endDate;
    if (from > to) {
        [from, to] = [to, from];
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.floor((to.getTime() - from.getTime()) / dayMs);
    const inclusiveDays = totalDays + 1;

    const dates: string[] = [];
    if (inclusiveDays <= maxPoints) {
        for (let i = 0; i < inclusiveDays; i++) {
            const next = new Date(from.getTime() + i * dayMs);
            dates.push(next.toISOString().slice(0, 10));
        }
        return dates;
    }

    const stepMs = (to.getTime() - from.getTime()) / (maxPoints - 1);
    const collected = new Set<string>();
    for (let i = 0; i < maxPoints; i++) {
        const next = new Date(from.getTime() + stepMs * i);
        collected.add(next.toISOString().slice(0, 10));
    }
    collected.add(to.toISOString().slice(0, 10));

    return Array.from(collected).sort(
        (a, b) => parseDate(a).getTime() - parseDate(b).getTime(),
    );
}

function buildRangeSampleDates(
    start: string,
    end: string,
    maxPoints = 50,
): string[] {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime()) ||
        maxPoints <= 0
    ) {
        return [];
    }
    let from = startDate;
    let to = endDate;
    if (from > to) [from, to] = [to, from];

    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.floor((to.getTime() - from.getTime()) / dayMs);
    const spanYears = to.getFullYear() - from.getFullYear();

    // For short ranges (<= ~4 months), keep the dense even sampling
    if (spanDays <= 120) {
        return buildSampleDates(
            from.toISOString().slice(0, 10),
            to.toISOString().slice(0, 10),
            maxPoints,
        );
    }

    // For longer ranges, align by day/month to compare same seasonal day across years
    const startDay = from.getDate();
    const startMonth = from.getMonth(); // 0-based
    const startYear = from.getFullYear();
    const endYear = to.getFullYear();
    const totalYears = endYear - startYear + 1;
    const steps = Math.min(maxPoints, totalYears);

    const years = new Set<number>();
    if (steps === 1) {
        years.add(startYear);
    } else {
        const step = (totalYears - 1) / (steps - 1);
        for (let i = 0; i < steps; i++) {
            const yr = Math.round(startYear + step * i);
            years.add(Math.min(endYear, Math.max(startYear, yr)));
        }
    }

    const dates: string[] = [];
    const sortedYears = Array.from(years).sort((a, b) => a - b);
    sortedYears.forEach((year) => {
        // Adjust day for months with fewer days (e.g., Feb)
        const lastDayOfMonth = new Date(year, startMonth + 1, 0).getDate();
        const day = Math.min(startDay, lastDayOfMonth);
        const candidate = new Date(year, startMonth, day);

        // For ranges >= 20 years, keep the same day/month as the start date only.
        // Don't clip to the end date so the last sample stays on the same day/month.
        if (spanYears >= 20) {
            if (candidate < from || candidate > to) return;
            dates.push(candidate.toISOString().slice(0, 10));
            return;
        }

        let clipped = candidate;
        if (candidate < from) clipped = from;
        if (candidate > to) clipped = to;
        dates.push(clipped.toISOString().slice(0, 10));
    });

    return Array.from(new Set(dates)).sort(
        (a, b) => parseDate(a).getTime() - parseDate(b).getTime(),
    );
}

function shouldUseFixedAnnualSamples(start: string, end: string): boolean {
    const from = parseDate(start);
    const to = parseDate(end);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
        return false;
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.abs(to.getTime() - from.getTime()) / dayMs;
    return spanDays / 365.25 >= 20;
}

function isSameMonthDay(date: string, reference: string): boolean {
    const ref = parseDate(reference);
    const candidate = parseDate(date);
    if (Number.isNaN(ref.getTime()) || Number.isNaN(candidate.getTime())) {
        return false;
    }
    return (
        candidate.getMonth() === ref.getMonth() &&
        candidate.getDate() === ref.getDate()
    );
}

function isDateWithinRange(
    date: string,
    range: { start: string; end: string },
): boolean {
    const candidate = parseDate(date);
    const start = parseDate(range.start);
    const end = parseDate(range.end);
    if (
        Number.isNaN(candidate.getTime()) ||
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime())
    ) {
        return false;
    }
    return candidate >= start && candidate <= end;
}

function buildFixedAnnualSampleDates(
    referenceStart: string,
    start: string,
    end: string,
    maxPoints = 50,
): string[] {
    const ref = parseDate(referenceStart);
    const from = parseDate(start);
    const to = parseDate(end);
    if (
        Number.isNaN(ref.getTime()) ||
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        maxPoints <= 0
    ) {
        return [];
    }
    const refMonth = ref.getMonth();
    const refDay = ref.getDate();

    const startYear = from.getFullYear();
    const endYear = to.getFullYear();
    const totalYears = endYear - startYear + 1;
    const steps = Math.min(maxPoints, totalYears);

    const years = new Set<number>();
    if (steps === 1) {
        years.add(startYear);
    } else {
        const step = (totalYears - 1) / (steps - 1);
        for (let i = 0; i < steps; i++) {
            const yr = Math.round(startYear + step * i);
            years.add(Math.min(endYear, Math.max(startYear, yr)));
        }
    }

    const dates: string[] = [];
    const sortedYears = Array.from(years).sort((a, b) => a - b);
    sortedYears.forEach((year) => {
        const lastDayOfMonth = new Date(year, refMonth + 1, 0).getDate();
        const day = Math.min(refDay, lastDayOfMonth);
        const candidate = new Date(year, refMonth, day);
        if (candidate < from || candidate > to) return;
        dates.push(candidate.toISOString().slice(0, 10));
    });

    return Array.from(new Set(dates)).sort(
        (a, b) => parseDate(a).getTime() - parseDate(b).getTime(),
    );
}

async function loadRangePointSamples(params: {
    variable: string;
    model: string;
    scenario: string;
    point: LatLon;
    rangeStart: string;
    rangeEnd: string;
    useFixedAnnualSamples: boolean;
    fixedReferenceDate: string;
    stepDays?: number;
}): Promise<ChartSample[]> {
    const {
        variable,
        model,
        scenario,
        point,
        rangeStart,
        rangeEnd,
        useFixedAnnualSamples,
        fixedReferenceDate,
        stepDays,
    } = params;
    const scenarioRange = getTimeRangeForScenario(scenario);
    const clippedStart = clipDateToRange(rangeStart, scenarioRange);
    const clippedEnd = clipDateToRange(rangeEnd, scenarioRange);

    if (parseDate(clippedStart) > parseDate(clippedEnd)) {
        return [];
    }

    try {
        const [x, clientY] = latLonToGridIndices(point.lat, point.lon);
        // OpenVisus stores rows south-up (y=0 = -60°S); latLonToGridIndices
        // returns north-down (y=0 = 90°N) — flip before sending to the API.
        const ovY = GRID_HEIGHT - 1 - clientY;
        // When showing annual samples (range ≥ 20 years), step by ~1 year so
        // the server returns one point per year.  With step_days=1 and
        // MAX_TIME_SERIES_POINTS=200 the 54 750 daily dates are subsampled to
        // ~200 points spaced ~9 months apart; only ~0-1 of those would ever
        // pass the isSameMonthDay check, leaving nearly-empty series.
        const pixelData = await fetchPixelData({
            variable,
            model,
            x0: x,
            x1: x,
            y0: ovY,
            y1: ovY,
            start_date: clippedStart,
            end_date: clippedEnd,
            scenario: normalizeScenario(scenario),
            resolution: "low",
            step_days: stepDays ?? (useFixedAnnualSamples ? 365 : 1),
        });

        const samples: ChartSample[] = [];
        for (let i = 0; i < pixelData.timestamps.length; i++) {
            const timestamp = pixelData.timestamps[i];
            // When useFixedAnnualSamples the server already returns one point
            // per year (step_days=365), so no additional date filtering is
            // needed.  The old isSameMonthDay guard was causing ~0 matches
            // because subsampled daily data rarely lands on the exact date.
            const value = pixelData.values[i];
            if (value !== null && isFinite(value)) {
                const rawValue =
                    variable === "hurs" ? Math.min(value, 100) : value;
                samples.push({
                    scenario,
                    model,
                    rawValue,
                    dateUsed: timestamp,
                });
            }
        }
        return samples;
    } catch (error) {
        console.warn("Range point pixel API failed, falling back:", error);
        const sampledDates = useFixedAnnualSamples
            ? buildFixedAnnualSampleDates(
                  fixedReferenceDate,
                  clippedStart,
                  clippedEnd,
                  50,
              )
            : buildRangeSampleDates(clippedStart, clippedEnd, 50);

        const samples: ChartSample[] = [];
        for (const dateCandidate of sampledDates) {
            const dateForScenario = useFixedAnnualSamples
                ? dateCandidate
                : clipDateToRange(dateCandidate, scenarioRange);
            if (
                useFixedAnnualSamples &&
                !isDateWithinRange(dateForScenario, scenarioRange)
            ) {
                continue;
            }
            const request = createDataRequest({
                variable,
                date: dateForScenario,
                model,
                scenario,
                resolution: 1,
            });
            let data: ClimateData | null = null;
            try {
                data = await fetchClimateData(request);
            } catch (error) {
                console.warn(
                    "Range point request failed, skipping date:",
                    error,
                );
                continue;
            }
            const arr = dataToArray(data);
            if (!arr) {
                continue;
            }
            const avg = valueAtPoint(arr, variable, data.shape, point);
            samples.push({
                scenario,
                model,
                rawValue: avg,
                dateUsed: dateForScenario,
            });
        }
        return samples;
    }
}

function buildChartRangeSeries(
    samples: ChartSample[],
    variable: string,
    unitLabel: string,
): ChartSeries[] {
    const byScenario = new Map<string, ChartSample[]>();
    samples.forEach((sample) => {
        const current = byScenario.get(sample.scenario) ?? [];
        current.push(sample);
        byScenario.set(sample.scenario, current);
    });

    return Array.from(byScenario.entries()).map(([scenario, entries]) => {
        const byDate = new Map<
            string,
            Array<ChartSample & { value: number }>
        >();
        entries.forEach((entry) => {
            const value = convertValue(entry.rawValue, variable, unitLabel);
            const current = byDate.get(entry.dateUsed) ?? [];
            current.push({ ...entry, value });
            byDate.set(entry.dateUsed, current);
        });

        const points = Array.from(byDate.entries())
            .map(([date, list]) => ({
                date,
                samples: list,
                stats: computeChartStats(list.map((item) => item.value)),
            }))
            .sort(
                (a, b) =>
                    parseDate(a.date).getTime() - parseDate(b.date).getTime(),
            );

        return { scenario, points };
    });
}

function createDifferenceData(
    dataA: ClimateData,
    dataB: ClimateData,
    labelA: string,
    labelB: string,
): { data: ClimateData; min: number; max: number; mean: number } {
    const arrayA = dataToArray(dataA);
    const arrayB = dataToArray(dataB);

    if (!arrayA || !arrayB) {
        throw new Error("Comparison data is missing numeric values.");
    }

    if (
        arrayA.length !== arrayB.length ||
        dataA.shape[0] !== dataB.shape[0] ||
        dataA.shape[1] !== dataB.shape[1]
    ) {
        throw new Error("Comparison datasets have mismatched shapes.");
    }

    const differenceArray = new Float32Array(arrayA.length);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < arrayA.length; i++) {
        const a = arrayA[i];
        const b = arrayB[i];

        if (!isFinite(a) || !isFinite(b)) {
            differenceArray[i] = NaN;
            continue;
        }

        const diff = b - a;
        differenceArray[i] = diff;

        if (isFinite(diff)) {
            min = Math.min(min, diff);
            max = Math.max(max, diff);
            sum += diff;
            count += 1;
        }
    }

    if (!isFinite(min) || !isFinite(max)) {
        throw new Error("Comparison produced no valid numeric values.");
    }

    const mean = count > 0 ? sum / count : NaN;

    const differenceData: ClimateData = {
        ...dataA,
        data: differenceArray,
        data_encoding: "none",
        dtype: "float32",
        model: `${labelB} minus ${labelA}`,
        time: `${dataB.time} minus ${dataA.time}`,
        scenario: `${dataB.scenario} minus ${dataA.scenario}`,
        metadata: {
            ...dataA.metadata,
            comparison: { labelA, labelB },
        },
    };

    return { data: differenceData, min, max, mean };
}

function setLoadingProgress(value: number, forceRender = false) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (clamped === state.loadingProgress) return;
    state.loadingProgress = clamped;
    if (state.isLoading || forceRender) {
        render();
    }
}

async function loadCompareData(
    activeScenarioForRange: string,
    onProgress?: (progress: number) => void,
): Promise<{ data: ClimateData; min: number; max: number; mean: number }> {
    let requestA = createDataRequest({
        variable: state.variable,
        date: state.date,
        model: state.model,
        scenario: state.scenario,
        resolution: state.resolution,
    });
    let requestB = requestA;
    let labelA = "";
    let labelB = "";

    switch (state.compareMode) {
        case "Scenarios": {
            const scenarioA = state.compareScenarioA;
            const scenarioB = state.compareScenarioB;
            const compareDate = clipDateToScenarioRange(
                state.date,
                activeScenarioForRange,
            );
            if (compareDate !== state.date) {
                state.date = compareDate;
            }

            requestA = createDataRequest({
                variable: state.variable,
                date: compareDate,
                model: state.model,
                scenario: scenarioA,
                resolution: state.resolution,
            });
            requestB = createDataRequest({
                variable: state.variable,
                date: compareDate,
                model: state.model,
                scenario: scenarioB,
                resolution: state.resolution,
            });
            labelA = scenarioA;
            labelB = scenarioB;
            break;
        }
        case "Models": {
            const compareDate = clipDateToScenarioRange(
                state.date,
                activeScenarioForRange,
            );
            if (compareDate !== state.date) {
                state.date = compareDate;
            }

            requestA = createDataRequest({
                variable: state.variable,
                date: compareDate,
                model: state.compareModelA,
                scenario: state.scenario,
                resolution: state.resolution,
            });
            requestB = createDataRequest({
                variable: state.variable,
                date: compareDate,
                model: state.compareModelB,
                scenario: state.scenario,
                resolution: state.resolution,
            });
            labelA = state.compareModelA;
            labelB = state.compareModelB;
            break;
        }
        case "Dates": {
            const startDate = clipDateToScenarioRange(
                state.compareDateStart,
                state.scenario,
            );
            const endDate = clipDateToScenarioRange(
                state.compareDateEnd,
                state.scenario,
            );

            if (startDate !== state.compareDateStart) {
                state.compareDateStart = startDate;
            }
            if (endDate !== state.compareDateEnd) {
                state.compareDateEnd = endDate;
            }

            requestA = createDataRequest({
                variable: state.variable,
                date: startDate,
                model: state.model,
                scenario: state.scenario,
                resolution: state.resolution,
            });
            requestB = createDataRequest({
                variable: state.variable,
                date: endDate,
                model: state.model,
                scenario: state.scenario,
                resolution: state.resolution,
            });
            labelA = startDate;
            labelB = endDate;
            break;
        }
    }

    const dataA = await fetchClimateData(requestA);
    onProgress?.(65);

    const dataB = await fetchClimateData(requestB);
    onProgress?.(85);

    return createDifferenceData(dataA, dataB, labelA, labelB);
}

/**
 * Compute percentile of a sorted array
 */
function percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return NaN;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
        return sortedValues[lower];
    }

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

async function loadEnsembleData(
    onProgress?: (progress: number) => void,
): Promise<{ data: ClimateData; min: number; max: number; mean: number }> {
    const activeScenarios =
        state.ensembleScenarios.length > 0
            ? state.ensembleScenarios
            : scenarios.filter((s) => s !== "Historical");
    const activeModels =
        state.ensembleModels.length > 0 ? state.ensembleModels : models;

    if (activeScenarios.length === 0 || activeModels.length === 0) {
        throw new Error("Please select at least one scenario and one model.");
    }

    // Find common date range for all selected scenarios
    const commonRange = intersectScenarioRange(activeScenarios);
    const ensembleDate = clipDateToRange(state.ensembleDate, commonRange);
    if (ensembleDate !== state.ensembleDate) {
        state.ensembleDate = ensembleDate;
    }

    const scenariosKey = activeScenarios.slice().sort().join("|");
    const modelsKey = activeModels.slice().sort().join("|");
    const currentCacheKey: EnsembleStatsCacheKey = {
        date: ensembleDate,
        scenariosKey,
        modelsKey,
        resolution: state.resolution,
    };

    // Determine which variable/statistic combinations are needed:
    // - always the currently displayed variable/statistic
    // - plus all mask variable/statistic pairs (for per-mask filtering)
    const statsByVariable = new Map<string, Map<EnsembleStatistic, Float32Array>>();
    const rangesByVariable = new Map<
        string,
        Map<EnsembleStatistic, { min: number; max: number }>
    >();
    const rawSamplesByVariable = new Map<
        string,
        Array<Float32Array | Float64Array>
    >();
    const requestedStatsByVariable = new Map<string, Set<EnsembleStatistic>>();
    const addRequestedStat = (variable: string, stat: EnsembleStatistic) => {
        if (!requestedStatsByVariable.has(variable)) {
            requestedStatsByVariable.set(variable, new Set<EnsembleStatistic>());
        }
        requestedStatsByVariable.get(variable)!.add(stat);
    };
    addRequestedStat(state.ensembleVariable, state.ensembleStatistic);
    if (getModeMasks(state) && getModeMasks(state).length > 0) {
        for (const mask of getModeMasks(state)) {
            addRequestedStat(
                mask.variable || state.ensembleVariable,
                mask.statistic || "mean",
            );
        }
    }

    const variablesToProcess = Array.from(requestedStatsByVariable.keys());
    const requestsPerVariable = activeScenarios.length * activeModels.length;
    const totalRequests = Math.max(1, requestsPerVariable * variablesToProcess.length);
    let completedRequests = 0;
    onProgress?.(10);

    for (const targetVariable of variablesToProcess) {
        const neededStats = requestedStatsByVariable.get(targetVariable)!;

        // ------------------------------------------------------------------
        // Fast path: reuse already-computed raw samples and statistics so we
        // don't re-fetch tiles or re-run the expensive per-pixel loop when
        // only a new mask variable was added.
        // ------------------------------------------------------------------
        const cachedRaw = state.ensembleRawSamplesByVariable.get(targetVariable);
        const cachedStats = state.ensembleStatisticsByVariable.get(targetVariable);
        if (
            cachedRaw &&
            cachedStats &&
            [...neededStats].every((s) => cachedStats.has(s)) &&
            _ensembleStatsCachedResolution === state.resolution &&
            _ensembleStatsCachedKey &&
            _ensembleStatsCachedKey.date === currentCacheKey.date &&
            _ensembleStatsCachedKey.scenariosKey === currentCacheKey.scenariosKey &&
            _ensembleStatsCachedKey.modelsKey === currentCacheKey.modelsKey &&
            _ensembleStatsCachedKey.resolution === currentCacheKey.resolution
        ) {
            rawSamplesByVariable.set(targetVariable, cachedRaw);
            statsByVariable.set(targetVariable, cachedStats);
            rangesByVariable.set(
                targetVariable,
                state.ensembleStatisticRangesByVariable.get(targetVariable) ?? new Map(),
            );
            completedRequests += requestsPerVariable;
            const progress = 10 + Math.round((completedRequests / totalRequests) * 78);
            onProgress?.(Math.min(88, progress));
            continue;
        }

        const allDataArrays: (Float32Array | Float64Array)[] = [];
        const allShapes: Array<[number, number]> = [];

        // Build all (scenario × model) fetch tasks and run them in parallel,
        // rate-limited to PARALLEL_REQUEST_LIMIT concurrent requests.
        const combos = activeScenarios.flatMap((scenario) =>
            activeModels.map((model) => ({ scenario, model }))
        );
        const fetchResults = await pLimit(
            combos.map(({ scenario, model }) => async () => {
                const request = createDataRequest({
                    variable: targetVariable,
                    date: ensembleDate,
                    model,
                    scenario,
                    resolution: state.resolution,
                });
                try {
                    const data = await fetchClimateData(request);
                    const arrayData = dataToArray(data);
                    return arrayData ? { arrayData, shape: data.shape } : null;
                } catch (error) {
                    console.warn(
                        `Failed to fetch data for ${targetVariable} (${scenario}/${model}):`,
                        error,
                    );
                    return null;
                } finally {
                    completedRequests += 1;
                    const progress =
                        10 + Math.round((completedRequests / totalRequests) * 78);
                    onProgress?.(Math.min(88, progress));
                }
            }),
            PARALLEL_REQUEST_LIMIT,
        );
        for (const result of fetchResults) {
            if (result.status === "fulfilled" && result.value) {
                allDataArrays.push(result.value.arrayData);
                allShapes.push(result.value.shape);
            }
        }

        if (allDataArrays.length === 0) {
            if (targetVariable === state.ensembleVariable) {
                throw new Error(
                    "No valid data could be loaded for the selected scenarios and models.",
                );
            }
            continue;
        }

        rawSamplesByVariable.set(targetVariable, allDataArrays);

        // Verify all arrays have the same shape
        const firstShape = allShapes[0];
        for (let i = 1; i < allShapes.length; i++) {
            if (
                allShapes[i][0] !== firstShape[0] ||
                allShapes[i][1] !== firstShape[1]
            ) {
                throw new Error(
                    "Ensemble datasets have mismatched shapes. Cannot compute statistics.",
                );
            }
        }

        const length = allDataArrays[0].length;
        const statsArrays = new Map<EnsembleStatistic, Float32Array>();
        const statsRanges = new Map<
            EnsembleStatistic,
            { min: number; max: number }
        >();
        for (const stat of neededStats) {
            statsArrays.set(stat, new Float32Array(length));
            statsRanges.set(stat, { min: Infinity, max: -Infinity });
        }

        // Compute requested statistics for this variable.
        // Yield the main thread every STAT_CHUNK pixels so the UI stays
        // responsive during the (potentially ~900 k iteration) loop.
        const STAT_CHUNK = 60_000;
        for (let i = 0; i < length; i++) {
            if (i > 0 && i % STAT_CHUNK === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }

            const values: number[] = [];
            for (const arrayData of allDataArrays) {
                const val = arrayData[i];
                if (!isFinite(val)) continue;
                values.push(
                    targetVariable === "hurs" ? Math.min(val, 100) : val,
                );
            }

            if (values.length === 0) {
                for (const stat of neededStats) {
                    statsArrays.get(stat)![i] = NaN;
                }
                continue;
            }

            const sorted =
                neededStats.has("median") ||
                neededStats.has("iqr") ||
                neededStats.has("percentile")
                    ? [...values].sort((a, b) => a - b)
                    : null;
            const mean =
                neededStats.has("mean") || neededStats.has("std")
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : 0;

            for (const stat of neededStats) {
                let result: number;
                if (stat === "mean") {
                    result = mean;
                } else if (stat === "median") {
                    result = percentile(sorted!, 50);
                } else if (stat === "std") {
                    const variance =
                        values.reduce(
                            (sum, val) => sum + Math.pow(val - mean, 2),
                            0,
                        ) / values.length;
                    result = Math.sqrt(variance);
                } else if (stat === "iqr") {
                    const q75 = percentile(sorted!, 75);
                    const q25 = percentile(sorted!, 25);
                    result = q75 - q25;
                } else if (stat === "percentile") {
                    const p90 = percentile(sorted!, 90);
                    const p10 = percentile(sorted!, 10);
                    result = p90 - p10;
                } else if (stat === "extremes") {
                    result = Math.max(...values) - Math.min(...values);
                } else {
                    result = mean;
                }

                statsArrays.get(stat)![i] = result;
                if (isFinite(result)) {
                    const range = statsRanges.get(stat)!;
                    range.min = Math.min(range.min, result);
                    range.max = Math.max(range.max, result);
                }
            }
        }

        statsByVariable.set(targetVariable, statsArrays);
        rangesByVariable.set(targetVariable, statsRanges);
    }

    onProgress?.(90);

    const displayStats = statsByVariable.get(state.ensembleVariable);
    const resultArray = displayStats?.get(state.ensembleStatistic);
    if (!displayStats || !resultArray) {
        throw new Error("Unable to compute ensemble statistics for the selected variable.");
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < resultArray.length; i++) {
        const displayedResult = resultArray[i];
        if (!isFinite(displayedResult)) continue;
        min = Math.min(min, displayedResult);
        max = Math.max(max, displayedResult);
        sum += displayedResult;
        count += 1;
    }

    // Store computed statistics in state:
    // - ensembleStatistics / ensembleStatisticRanges for displayed variable (backward-compatible)
    // - by-variable maps for per-mask variable filtering
    state.ensembleStatistics = displayStats;
    state.ensembleStatisticRanges =
        rangesByVariable.get(state.ensembleVariable) ??
        new Map<EnsembleStatistic, { min: number; max: number }>();
    state.ensembleStatisticsByVariable = statsByVariable;
    state.ensembleStatisticRangesByVariable = rangesByVariable;
    state.ensembleRawSamplesByVariable = rawSamplesByVariable;
    _ensembleStatsCachedResolution = state.resolution;
    _ensembleStatsCachedKey = currentCacheKey;

    // Sync unedited ensemble mask bounds to newly computed ranges
    if (getModeMasks(state).length > 0) {
        for (const mask of getModeMasks(state)) {
            const maskStatistic = mask.statistic || "mean";
            const maskVariable = mask.variable || state.ensembleVariable;
            const maskUnit = mask.unit || state.ensembleUnit;
            const range =
                mask.kind === "probability"
                    ? getEnsembleProbabilityMaskRange(maskVariable, maskUnit)
                    : getEnsembleMaskRange(
                          maskStatistic,
                          maskVariable,
                          maskUnit,
                      );
            if (!mask.lowerEdited) {
                mask.lowerBound = range.min;
            }
            if (!mask.upperEdited) {
                mask.upperBound = range.max;
            }
        }
    }

    if (!isFinite(min) || !isFinite(max)) {
        throw new Error(
            "Ensemble computation produced no valid numeric values.",
        );
    }

    const mean = count > 0 ? sum / count : NaN;

    // Use the first dataset as a template for the result
    const templateRequest = createDataRequest({
        variable: state.ensembleVariable,
        date: ensembleDate,
        model: activeModels[0],
        scenario: activeScenarios[0],
        resolution: state.resolution,
    });

    // We need to create a ClimateData object with the computed statistics
    // For now, we'll use the first dataset's structure
    const templateData = await fetchClimateData(templateRequest);
    // Mark spread/difference measures as differences (not absolute values)
    // so unit conversions don't apply absolute offsets (e.g., Kelvin -> Celsius).
    // Mean/median are absolute; spread measures (std/iqr/percentile/extremes) are differences.
    const isDifferenceStatistic = isDifferenceEnsembleStatistic(
        state.ensembleStatistic,
    );
    const metadata = isDifferenceStatistic
        ? {
              ...(templateData.metadata || {}),
              comparison: {
                  labelA: "Ensemble",
                  labelB:
                      state.ensembleStatistic === "std"
                          ? "Std Dev"
                          : state.ensembleStatistic === "median"
                            ? "Median"
                            : state.ensembleStatistic === "iqr"
                              ? "IQR"
                              : state.ensembleStatistic === "percentile"
                                ? "Percentile Band"
                                : "Extremes",
              },
          }
        : templateData.metadata;

    const ensembleData: ClimateData = {
        ...templateData,
        data: resultArray,
        data_encoding: "none",
        metadata,
    };

    onProgress?.(100);

    return { data: ensembleData, min, max, mean };
}

async function loadCompareDataForWindow2(
    w2: Window2State,
    onProgress?: (progress: number) => void,
): Promise<{ data: ClimateData; min: number; max: number; mean: number }> {
    let activeScenarioForRange = w2.scenario;
    if (w2.compareMode === "Scenarios") {
        activeScenarioForRange = w2.compareScenarioA;
    }
    let requestA = createDataRequest({
        variable: w2.variable,
        date: w2.date,
        model: w2.model,
        scenario: w2.scenario,
        resolution: w2.resolution,
    });
    let requestB = requestA;
    let labelA = "";
    let labelB = "";

    switch (w2.compareMode) {
        case "Scenarios": {
            const scenarioA = w2.compareScenarioA;
            const scenarioB = w2.compareScenarioB;
            const compareDate = clipDateToScenarioRange(
                w2.date,
                activeScenarioForRange,
            );
            if (compareDate !== w2.date) {
                w2.date = compareDate;
            }
            requestA = createDataRequest({
                variable: w2.variable,
                date: compareDate,
                model: w2.model,
                scenario: scenarioA,
                resolution: w2.resolution,
            });
            requestB = createDataRequest({
                variable: w2.variable,
                date: compareDate,
                model: w2.model,
                scenario: scenarioB,
                resolution: w2.resolution,
            });
            labelA = scenarioA;
            labelB = scenarioB;
            break;
        }
        case "Models": {
            const compareDate = clipDateToScenarioRange(
                w2.date,
                activeScenarioForRange,
            );
            if (compareDate !== w2.date) {
                w2.date = compareDate;
            }
            requestA = createDataRequest({
                variable: w2.variable,
                date: compareDate,
                model: w2.compareModelA,
                scenario: w2.scenario,
                resolution: w2.resolution,
            });
            requestB = createDataRequest({
                variable: w2.variable,
                date: compareDate,
                model: w2.compareModelB,
                scenario: w2.scenario,
                resolution: w2.resolution,
            });
            labelA = w2.compareModelA;
            labelB = w2.compareModelB;
            break;
        }
        case "Dates": {
            const startDate = clipDateToScenarioRange(
                w2.compareDateStart,
                w2.scenario,
            );
            const endDate = clipDateToScenarioRange(
                w2.compareDateEnd,
                w2.scenario,
            );
            if (startDate !== w2.compareDateStart) {
                w2.compareDateStart = startDate;
            }
            if (endDate !== w2.compareDateEnd) {
                w2.compareDateEnd = endDate;
            }
            requestA = createDataRequest({
                variable: w2.variable,
                date: startDate,
                model: w2.model,
                scenario: w2.scenario,
                resolution: w2.resolution,
            });
            requestB = createDataRequest({
                variable: w2.variable,
                date: endDate,
                model: w2.model,
                scenario: w2.scenario,
                resolution: w2.resolution,
            });
            labelA = startDate;
            labelB = endDate;
            break;
        }
    }

    const dataA = await fetchClimateData(requestA);
    onProgress?.(65);
    const dataB = await fetchClimateData(requestB);
    onProgress?.(85);
    return createDifferenceData(dataA, dataB, labelA, labelB);
}

async function loadEnsembleDataForWindow2(
    w2: Window2State,
    onProgress?: (progress: number) => void,
): Promise<{ data: ClimateData; min: number; max: number; mean: number }> {
    const activeScenarios =
        w2.ensembleScenarios.length > 0
            ? w2.ensembleScenarios
            : scenarios.filter((s) => s !== "Historical");
    const activeModels =
        w2.ensembleModels.length > 0 ? w2.ensembleModels : models;

    if (activeScenarios.length === 0 || activeModels.length === 0) {
        throw new Error("Please select at least one scenario and one model.");
    }

    const commonRange = intersectScenarioRange(activeScenarios);
    const ensembleDate = clipDateToRange(w2.ensembleDate, commonRange);
    if (ensembleDate !== w2.ensembleDate) {
        w2.ensembleDate = ensembleDate;
    }

    const scenariosKey = activeScenarios.slice().sort().join("|");
    const modelsKey = activeModels.slice().sort().join("|");
    const currentCacheKey: EnsembleStatsCacheKey = {
        date: ensembleDate,
        scenariosKey,
        modelsKey,
        resolution: w2.resolution,
    };

    const statsByVariable = new Map<string, Map<EnsembleStatistic, Float32Array>>();
    const rangesByVariable = new Map<
        string,
        Map<EnsembleStatistic, { min: number; max: number }>
    >();
    const rawSamplesByVariable = new Map<
        string,
        Array<Float32Array | Float64Array>
    >();
    const requestedStatsByVariable = new Map<string, Set<EnsembleStatistic>>();
    const addRequestedStat = (variable: string, stat: EnsembleStatistic) => {
        if (!requestedStatsByVariable.has(variable)) {
            requestedStatsByVariable.set(variable, new Set<EnsembleStatistic>());
        }
        requestedStatsByVariable.get(variable)!.add(stat);
    };
    addRequestedStat(w2.ensembleVariable, w2.ensembleStatistic);
    if (getModeMasks(w2) && getModeMasks(w2).length > 0) {
        for (const mask of getModeMasks(w2)) {
            addRequestedStat(
                mask.variable || w2.ensembleVariable,
                mask.statistic || "mean",
            );
        }
    }

    const variablesToProcess = Array.from(requestedStatsByVariable.keys());
    const requestsPerVariable = activeScenarios.length * activeModels.length;
    const totalRequests = Math.max(1, requestsPerVariable * variablesToProcess.length);
    let completedRequests = 0;
    onProgress?.(10);

    for (const targetVariable of variablesToProcess) {
        const neededStats = requestedStatsByVariable.get(targetVariable)!;

        // Fast path: reuse already-computed raw samples and statistics.
        const w2CachedRaw = w2.ensembleRawSamplesByVariable?.get(targetVariable);
        const w2CachedStats = w2.ensembleStatisticsByVariable?.get(targetVariable);
        if (
            w2CachedRaw &&
            w2CachedStats &&
            [...neededStats].every((s) => w2CachedStats.has(s)) &&
            _w2EnsembleStatsCachedResolution === w2.resolution &&
            _w2EnsembleStatsCachedKey &&
            _w2EnsembleStatsCachedKey.date === currentCacheKey.date &&
            _w2EnsembleStatsCachedKey.scenariosKey === currentCacheKey.scenariosKey &&
            _w2EnsembleStatsCachedKey.modelsKey === currentCacheKey.modelsKey &&
            _w2EnsembleStatsCachedKey.resolution === currentCacheKey.resolution
        ) {
            rawSamplesByVariable.set(targetVariable, w2CachedRaw);
            statsByVariable.set(targetVariable, w2CachedStats);
            rangesByVariable.set(
                targetVariable,
                w2.ensembleStatisticRangesByVariable?.get(targetVariable) ?? new Map(),
            );
            completedRequests += requestsPerVariable;
            const progress = 10 + Math.round((completedRequests / totalRequests) * 78);
            onProgress?.(Math.min(88, progress));
            continue;
        }

        const allDataArrays: (Float32Array | Float64Array)[] = [];
        const allShapes: Array<[number, number]> = [];

        // Parallel fetch for all (scenario × model) combinations.
        const combosW2 = activeScenarios.flatMap((scenario) =>
            activeModels.map((model) => ({ scenario, model }))
        );
        const fetchResultsW2 = await pLimit(
            combosW2.map(({ scenario, model }) => async () => {
                const request = createDataRequest({
                    variable: targetVariable,
                    date: ensembleDate,
                    model,
                    scenario,
                    resolution: w2.resolution,
                });
                try {
                    const data = await fetchClimateData(request);
                    const arrayData = dataToArray(data);
                    return arrayData ? { arrayData, shape: data.shape } : null;
                } catch (error) {
                    console.warn(
                        `Failed to fetch data for ${targetVariable} (${scenario}/${model}):`,
                        error,
                    );
                    return null;
                } finally {
                    completedRequests += 1;
                    const progress =
                        10 + Math.round((completedRequests / totalRequests) * 78);
                    onProgress?.(Math.min(88, progress));
                }
            }),
            PARALLEL_REQUEST_LIMIT,
        );
        for (const result of fetchResultsW2) {
            if (result.status === "fulfilled" && result.value) {
                allDataArrays.push(result.value.arrayData);
                allShapes.push(result.value.shape);
            }
        }

        if (allDataArrays.length === 0) {
            if (targetVariable === w2.ensembleVariable) {
                throw new Error(
                    "No valid data could be loaded for the selected scenarios and models.",
                );
            }
            continue;
        }

        rawSamplesByVariable.set(targetVariable, allDataArrays);

        const firstShape = allShapes[0];
        for (let i = 1; i < allShapes.length; i++) {
            if (
                allShapes[i][0] !== firstShape[0] ||
                allShapes[i][1] !== firstShape[1]
            ) {
                throw new Error(
                    "Ensemble datasets have mismatched shapes. Cannot compute statistics.",
                );
            }
        }

        const length = allDataArrays[0].length;
        const statsArrays = new Map<EnsembleStatistic, Float32Array>();
        const statsRanges = new Map<
            EnsembleStatistic,
            { min: number; max: number }
        >();
        for (const stat of neededStats) {
            statsArrays.set(stat, new Float32Array(length));
            statsRanges.set(stat, { min: Infinity, max: -Infinity });
        }

        const STAT_CHUNK_W2 = 60_000;
        for (let i = 0; i < length; i++) {
            if (i > 0 && i % STAT_CHUNK_W2 === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }

            const values: number[] = [];
            for (const arrayData of allDataArrays) {
                const val = arrayData[i];
                if (!isFinite(val)) continue;
                values.push(
                    targetVariable === "hurs" ? Math.min(val, 100) : val,
                );
            }

            if (values.length === 0) {
                for (const stat of neededStats) {
                    statsArrays.get(stat)![i] = NaN;
                }
                continue;
            }

            const sorted =
                neededStats.has("median") ||
                neededStats.has("iqr") ||
                neededStats.has("percentile")
                    ? [...values].sort((a, b) => a - b)
                    : null;
            const mean =
                neededStats.has("mean") || neededStats.has("std")
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : 0;

            for (const stat of neededStats) {
                let result: number;
                if (stat === "mean") {
                    result = mean;
                } else if (stat === "median") {
                    result = percentile(sorted!, 50);
                } else if (stat === "std") {
                    const variance =
                        values.reduce(
                            (sum, val) => sum + Math.pow(val - mean, 2),
                            0,
                        ) / values.length;
                    result = Math.sqrt(variance);
                } else if (stat === "iqr") {
                    const q75 = percentile(sorted!, 75);
                    const q25 = percentile(sorted!, 25);
                    result = q75 - q25;
                } else if (stat === "percentile") {
                    const p90 = percentile(sorted!, 90);
                    const p10 = percentile(sorted!, 10);
                    result = p90 - p10;
                } else if (stat === "extremes") {
                    result = Math.max(...values) - Math.min(...values);
                } else {
                    result = mean;
                }

                statsArrays.get(stat)![i] = result;
                if (isFinite(result)) {
                    const range = statsRanges.get(stat)!;
                    range.min = Math.min(range.min, result);
                    range.max = Math.max(range.max, result);
                }
            }
        }

        statsByVariable.set(targetVariable, statsArrays);
        rangesByVariable.set(targetVariable, statsRanges);
    }

    onProgress?.(90);

    const displayStats = statsByVariable.get(w2.ensembleVariable);
    const resultArray = displayStats?.get(w2.ensembleStatistic);
    if (!displayStats || !resultArray) {
        throw new Error("Unable to compute ensemble statistics for the selected variable.");
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < resultArray.length; i++) {
        const displayedResult = resultArray[i];
        if (!isFinite(displayedResult)) continue;
        min = Math.min(min, displayedResult);
        max = Math.max(max, displayedResult);
        sum += displayedResult;
        count += 1;
    }

    w2.ensembleStatistics = displayStats;
    w2.ensembleStatisticRanges =
        rangesByVariable.get(w2.ensembleVariable) ??
        new Map<EnsembleStatistic, { min: number; max: number }>();
    w2.ensembleStatisticsByVariable = statsByVariable;
    w2.ensembleStatisticRangesByVariable = rangesByVariable;
    w2.ensembleRawSamplesByVariable = rawSamplesByVariable;
    _w2EnsembleStatsCachedResolution = w2.resolution;
    _w2EnsembleStatsCachedKey = currentCacheKey;

    if (getModeMasks(w2).length > 0) {
        for (const mask of getModeMasks(w2)) {
            const maskStatistic = mask.statistic || "mean";
            const maskVariable = mask.variable || w2.ensembleVariable;
            const maskUnit = mask.unit || w2.ensembleUnit;
            const range =
                mask.kind === "probability"
                    ? getEnsembleProbabilityMaskRangeForWindow2(
                          w2,
                          maskVariable,
                          maskUnit,
                      )
                    : getEnsembleMaskRangeForWindow2(
                          maskStatistic,
                          w2,
                          maskVariable,
                          maskUnit,
                      );
            if (!mask.lowerEdited) {
                mask.lowerBound = range.min;
            }
            if (!mask.upperEdited) {
                mask.upperBound = range.max;
            }
        }
    }

    if (!isFinite(min) || !isFinite(max)) {
        throw new Error(
            "Ensemble computation produced no valid numeric values.",
        );
    }

    const mean = count > 0 ? sum / count : NaN;

    const templateRequest = createDataRequest({
        variable: w2.ensembleVariable,
        date: ensembleDate,
        model: activeModels[0],
        scenario: activeScenarios[0],
        resolution: w2.resolution,
    });

    const templateData = await fetchClimateData(templateRequest);
    const isDifferenceStatistic = isDifferenceEnsembleStatistic(
        w2.ensembleStatistic,
    );
    const metadata = isDifferenceStatistic
        ? {
              ...(templateData.metadata || {}),
              comparison: {
                  labelA: "Ensemble",
                  labelB:
                      w2.ensembleStatistic === "std"
                          ? "Std Dev"
                          : w2.ensembleStatistic === "median"
                            ? "Median"
                            : w2.ensembleStatistic === "iqr"
                              ? "IQR"
                              : w2.ensembleStatistic === "percentile"
                                ? "Percentile Band"
                                : "Extremes",
              },
          }
        : templateData.metadata;

    const ensembleData: ClimateData = {
        ...templateData,
        data: resultArray,
        data_encoding: "none",
        metadata,
    };

    onProgress?.(100);
    return { data: ensembleData, min, max, mean };
}

function getEnsembleMaskRangeForWindow2(
    stat: EnsembleStatistic,
    w2: Window2State,
    variable = w2.ensembleVariable,
    unitLabel = w2.ensembleUnit,
): { min: number | null; max: number | null } {
    const rangesForVariable =
        w2.ensembleStatisticRangesByVariable.get(variable) ??
        (variable === w2.ensembleVariable
            ? w2.ensembleStatisticRanges
            : undefined);
    const range = rangesForVariable?.get(stat);
    let rawMin: number | null = null;
    let rawMax: number | null = null;

    if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
        rawMin = range.min;
        rawMax = range.max;
    } else if (
        stat === w2.ensembleStatistic &&
        w2.dataMin !== null &&
        w2.dataMax !== null
    ) {
        rawMin = w2.dataMin;
        rawMax = w2.dataMax;
    }

    if (rawMin === null || rawMax === null) {
        return { min: null, max: null };
    }

    const converted = convertMinMax(
        rawMin,
        rawMax,
        variable,
        unitLabel,
        { isDifference: isDifferenceEnsembleStatistic(stat) },
    );
    return { min: converted.min, max: converted.max };
}

function getEnsembleProbabilityMaskRangeForWindow2(
    w2: Window2State,
    variable = w2.ensembleVariable,
    unitLabel = w2.ensembleUnit,
): { min: number | null; max: number | null } {
    const sampleArrays = w2.ensembleRawSamplesByVariable.get(variable);
    if (!sampleArrays || sampleArrays.length === 0) {
        return { min: null, max: null };
    }
    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const sample of sampleArrays) {
        for (let i = 0; i < sample.length; i++) {
            const raw = sample[i];
            if (!Number.isFinite(raw)) continue;
            const clipped = variable === "hurs" ? Math.min(raw, 100) : raw;
            rawMin = Math.min(rawMin, clipped);
            rawMax = Math.max(rawMax, clipped);
        }
    }
    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
        return { min: null, max: null };
    }
    const converted = convertMinMax(rawMin, rawMax, variable, unitLabel);
    return { min: converted.min, max: converted.max };
}

// Grid shape constants - matching data_processing/config.py GRID_SHAPE = (600, 1440)
const GRID_HEIGHT = 600;
const GRID_WIDTH = 1440;

/**
 * Convert lat/lon to grid indices (x, y)
 * Grid coordinates: x=0..1439 (longitude 0-360°), y=0..599 (latitude 90° to -60°)
 */
function latLonToGridIndices(lat: number, lon: number): [number, number] {
    // Convert longitude from [-180, 180) to [0, 360) for data grid lookup
    // Climate data uses 0-360° longitude range: x=0 → 0°, x=1440 → 360°
    const lonNormalized = (((lon + 360) % 360) + 360) % 360;
    const xFloat = (lonNormalized / 360) * GRID_WIDTH - 0.5;
    // Latitude: y=0 → 90° (North), y=599 → -60° (South, excluding Antarctica)
    const yFloat = ((90 - lat) / 150) * GRID_HEIGHT - 0.5;

    const clamp = (value: number, min: number, max: number) =>
        Math.min(max, Math.max(min, value));

    const x = clamp(Math.round(xFloat), 0, GRID_WIDTH - 1);
    const y = clamp(Math.round(yFloat), 0, GRID_HEIGHT - 1);

    return [x, y];
}

/**
 * Compute bounding box of a polygon in grid coordinates
 * Returns [x0, x1, y0, y1] where x0 <= x1 and y0 <= y1
 */
function polygonToGridBounds(
    polygon: LatLon[],
): [number, number, number, number] {
    if (!polygon || polygon.length < 3) {
        throw new Error("Polygon must have at least 3 points");
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of polygon) {
        const [x, y] = latLonToGridIndices(point.lat, point.lon);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    // Clamp to valid grid bounds
    minX = Math.max(0, Math.min(minX, GRID_WIDTH - 1));
    maxX = Math.max(0, Math.min(maxX, GRID_WIDTH - 1));
    minY = Math.max(0, Math.min(minY, GRID_HEIGHT - 1));
    maxY = Math.max(0, Math.min(maxY, GRID_HEIGHT - 1));

    return [minX, maxX, minY, maxY];
}

/**
 * Create a mask array for a polygon region within a bounding box
 * Returns 2D array where mask[y][x] = 1 if point is inside polygon, 0 otherwise
 */
function createPolygonMask(
    polygon: LatLon[],
    x0: number,
    x1: number,
    y0: number,
    y1: number,
): number[][] {
    const mask: number[][] = [];

    const lonStep = 360 / GRID_WIDTH;
    const latStep = 150 / GRID_HEIGHT;

    for (let y = y0; y <= y1; y++) {
        const row: number[] = [];
        const lat = 90 - (y + 0.5) * latStep;

        for (let x = x0; x <= x1; x++) {
            // Convert grid x to longitude in [-180, 180] range
            const lonRaw = (x + 0.5) * lonStep;
            const lon = lonRaw > 180 ? lonRaw - 360 : lonRaw;

            // Check if point is inside polygon
            const isInside = isPointInPolygon({ lat, lon }, polygon);
            row.push(isInside ? 1 : 0);
        }
        mask.push(row);
    }

    return mask;
}

function updateChartContainerDOM() {
    const chartContainer = document.querySelector(
        "[data-role='chart-container']",
    );
    if (!chartContainer) return;

    const isRangeMode = state.chartMode === "range";
    const useOverlayChartPaletteLogic = true;
    let body = "";

    if (state.chartLoading) {
        body = `
          <div style="position:absolute; inset:0; pointer-events:none;">
            <div style="${styleAttr(
                mergeStyles(styles.loadingIndicator, {
                    position: "absolute",
                    left: 18,
                    bottom: -95,
                    pointerEvents: "auto",
                }),
            )}">
              <div style="${styleAttr(styles.loadingSpinner)}"></div>
              <div style="${styleAttr(styles.loadingTextGroup)}">
                <div style="${styleAttr(styles.loadingText)}">Loading data</div>
                <div style="${styleAttr(styles.loadingBar)}">
                  <div style="${styleAttr({
                      ...styles.loadingBarFill,
                      width: `${Math.max(
                          0,
                          Math.min(
                              100,
                              Math.round(state.loadingProgress || 25),
                          ),
                      )}%`,
                  })}"></div>
                </div>
                <div style="${styleAttr(styles.loadingSubtext)}">${
                    state.chartLoadingProgress.total > 0
                        ? `${state.chartLoadingProgress.done}/${state.chartLoadingProgress.total} datasets loaded`
                        : "Preparing datasets"
                }</div>
              </div>
            </div>
            ${renderChartLoadingIndicator()}
          </div>
          ${
              !isRangeMode && state.chartBoxes
                  ? renderChartSvg(state.chartBoxes, {
                        lightToDarkNoDarkest: useOverlayChartPaletteLogic,
                    })
                  : isRangeMode && state.chartRangeSeries
                    ? renderChartRangeSvg(state.chartRangeSeries, {
                          lightToDarkNoDarkest: useOverlayChartPaletteLogic,
                      })
                    : ""
          }
        `;
    } else if (state.chartError) {
        body = `<div style="${styleAttr(styles.chartError)}">${
            state.chartError
        }</div>`;
    } else if (
        (!isRangeMode && (!state.chartBoxes || !state.chartBoxes.length)) ||
        (isRangeMode &&
            (!state.chartRangeSeries || !state.chartRangeSeries.length))
    ) {
        const emptyCopy = isRangeMode
            ? "Select scenarios, models, and a date range to see how the distribution evolves over time."
            : "Select scenarios and models to fetch the global box plot.";
        body = `<div style="${styleAttr(styles.chartEmpty)}">${emptyCopy}</div>`;
    } else {
        body = isRangeMode
            ? renderChartRangeSvg(state.chartRangeSeries ?? [], {
                  lightToDarkNoDarkest: useOverlayChartPaletteLogic,
              })
            : renderChartSvg(state.chartBoxes ?? [], {
                  lightToDarkNoDarkest: useOverlayChartPaletteLogic,
              });
    }

    const chartLocationLabel =
        state.chartLocationName ||
        (state.chartLocation === "Point" && state.chartPoint
            ? `Point (${state.chartPoint.lat.toFixed(
                  2,
              )}, ${state.chartPoint.lon.toFixed(2)})`
            : state.chartLocation === "Draw"
              ? "Custom region"
              : state.chartLocation === "World"
                ? "Global"
                : "");
    const chartDateLabel =
        state.chartMode === "range"
            ? `${formatDisplayDate(state.chartRangeStart)} – ${formatDisplayDate(
                  state.chartRangeEnd,
              )}`
            : formatDisplayDate(state.chartDate);

    chartContainer.innerHTML = `
        <div style="${styleAttr(styles.chartPanel)}">
          <div style="${styleAttr(styles.chartHeader)}">
            <div style="${styleAttr(styles.chartTitle)}">${getVariableLabel(
                state.chartVariable,
                state.metaData,
            )}</div>
            <div style="${styleAttr(styles.mapSubtitle)}">${
                chartLocationLabel
                    ? `${escapeHtml(chartLocationLabel)} · ${chartDateLabel}`
                    : chartDateLabel
            }</div>
          </div>
          <div style="${styleAttr(
              mergeStyles(styles.chartPlotWrapper, {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
              }),
          )}">
            ${body}
          </div>
        </div>
      `;

    // Chart content is frequently re-rendered without a full app render, so
    // chart-local palette dropdowns need their own binding here.
    const chartPaletteWrappers = chartContainer.querySelectorAll<HTMLElement>(
        '.overlay-palette-wrapper[data-key="chartPalette"]',
    );
    chartPaletteWrappers.forEach((wrapper) => {
        const trigger = wrapper.querySelector<HTMLElement>(
            ".overlay-palette-trigger",
        );
        const options = wrapper.querySelectorAll<HTMLElement>(
            ".custom-select-option",
        );
        if (!trigger || options.length === 0) return;

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = wrapper.classList.contains("open");
            chartPaletteWrappers.forEach((w) => w.classList.remove("open"));
            wrapper.classList.toggle("open", !isOpen);
        });

        options.forEach((option) => {
            option.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const value = option.dataset.value;
                if (!value) return;
                state.chartPalette = value;
                chartPaletteWrappers.forEach((w) => w.classList.remove("open"));
                updateChartContainerDOM();
            });
        });
    });

    // Add hover event listeners for boxplot model indicators
    if (!isRangeMode && state.chartBoxes && state.chartBoxes.length > 0) {
        // Use setTimeout to ensure DOM is fully parsed
        setTimeout(() => {
            attachBoxplotHoverListeners();
        }, 0);
    }
}

function attachBoxplotHoverListeners() {
    const hoverOverlay = document.querySelector(
        "[data-role='chart-container'] .boxplot-hover-overlay",
    ) as SVGElement | null;
    if (!hoverOverlay) {
        return;
    }
    const svg = hoverOverlay.closest("svg") as SVGElement | null;
    if (!svg) return;

    const hoverAreas = svg.querySelectorAll(".boxplot-hover-area");
    const modelIndicators = svg.querySelectorAll(".model-indicator");

    if (hoverAreas.length === 0) {
        return;
    }

    // Initially hide all indicators
    modelIndicators.forEach((indicator) => {
        (indicator as SVGElement).style.opacity = "0";
    });

    hoverAreas.forEach((area) => {
        const boxplotGroup = area.closest(".boxplot-group") as SVGElement;
        if (!boxplotGroup) return;

        const boxplotIdx = boxplotGroup.getAttribute("data-boxplot-idx");
        if (boxplotIdx === null) return;

        area.addEventListener("mouseenter", () => {
            hoverOverlay.style.opacity = "1";
            hoverOverlay.style.pointerEvents = "auto";
            // Show only indicators for this boxplot
            modelIndicators.forEach((indicator) => {
                const indicatorGroup = indicator as SVGElement;
                const indicatorIdx =
                    indicatorGroup.getAttribute("data-boxplot-idx");
                if (indicatorIdx === boxplotIdx) {
                    indicatorGroup.style.opacity = "1";
                } else {
                    indicatorGroup.style.opacity = "0";
                }
            });
        });

        area.addEventListener("mouseleave", () => {
            hoverOverlay.style.opacity = "0";
            hoverOverlay.style.pointerEvents = "none";
            // Hide all indicators on mouse leave
            modelIndicators.forEach((indicator) => {
                (indicator as SVGElement).style.opacity = "0";
            });
        });
    });
}

function attachMapInfoBoxplotHoverListeners(panelId = "map-info-panel") {
    const hoverOverlay = document.querySelector(
        `#${panelId} .boxplot-hover-overlay`,
    ) as SVGElement | null;
    if (!hoverOverlay) return;
    const svg = hoverOverlay.closest("svg") as SVGElement | null;
    if (!svg) return;

    const hoverAreas = svg.querySelectorAll(".boxplot-hover-area");
    const modelIndicators = svg.querySelectorAll(".model-indicator");

    if (hoverAreas.length === 0) return;

    modelIndicators.forEach((ind) => {
        (ind as SVGElement).style.opacity = "0";
    });

    hoverAreas.forEach((area) => {
        const boxplotGroup = area.closest(".boxplot-group") as SVGElement;
        if (!boxplotGroup) return;
        const boxplotIdx = boxplotGroup.getAttribute("data-boxplot-idx");
        if (boxplotIdx === null) return;

        area.addEventListener("mouseenter", () => {
            hoverOverlay.style.opacity = "1";
            hoverOverlay.style.pointerEvents = "auto";
            modelIndicators.forEach((ind) => {
                const el = ind as SVGElement;
                el.style.opacity = el.getAttribute("data-boxplot-idx") === boxplotIdx ? "1" : "0";
            });
        });

        area.addEventListener("mouseleave", () => {
            hoverOverlay.style.opacity = "0";
            hoverOverlay.style.pointerEvents = "none";
            modelIndicators.forEach((ind) => {
                (ind as SVGElement).style.opacity = "0";
            });
        });
    });
}

async function loadChartData() {
    if (state.canvasView !== "chart") return;
    const updateChartPreview = (samples: ChartSample[]) => {
        state.chartSamples = samples;
        if (state.chartMode === "single") {
            try {
                state.chartBoxes = buildChartBoxes(
                    samples,
                    state.chartVariable,
                    state.chartUnit,
                );
                state.chartRangeSeries = null;
            } catch {
                return;
            }
        } else {
            try {
                state.chartRangeSeries = buildChartRangeSeries(
                    samples,
                    state.chartVariable,
                    state.chartUnit,
                );
                state.chartBoxes = null;
            } catch {
                return;
            }
        }
        updateChartContainerDOM();
    };

    if (
        state.chartLocation === "Draw" &&
        (!state.chartPolygon || state.chartPolygon.length < 3)
    ) {
        state.chartError = "Draw a region on the map to load chart data.";
        state.chartBoxes = null;
        state.chartRangeSeries = null;
        state.chartSamples = [];
        state.chartLoading = false;
        state.chartLoadingProgress = { total: 0, done: 0 };
        updateChartContainerDOM();
        return;
    }
    if (state.chartLocation === "Point" && !state.chartPoint) {
        state.chartError = "Click a point on the map to load chart data.";
        state.chartBoxes = null;
        state.chartRangeSeries = null;
        state.chartSamples = [];
        state.chartLoading = false;
        state.chartLoadingProgress = { total: 0, done: 0 };
        updateChartContainerDOM();
        return;
    }
    if (state.chartLocation === "Search" && !state.chartPoint) {
        state.chartError = state.chartLocationSearchLoading
            ? "Searching for a place..."
            : "Search for a place and pick a result.";
        state.chartBoxes = null;
        state.chartRangeSeries = null;
        state.chartSamples = [];
        state.chartLoading = false;
        state.chartLoadingProgress = { total: 0, done: 0 };
        updateChartContainerDOM();
        return;
    }

    state.chartLoading = true;
    state.chartError = null;
    setLoadingProgress(5, true);
    state.chartLoadingProgress = { total: 0, done: 0 };
    state.chartSamples = [];
    state.chartBoxes = null;
    state.chartRangeSeries = null;
    updateChartContainerDOM();

    try {
        const metaData = state.metaData ?? (await fetchMetadata());
        if (!state.metaData) {
            state.metaData = metaData;
        }

        const scenarioOptions = metaData?.scenarios?.length
            ? Array.from(
                  new Set(metaData.scenarios.map(normalizeScenarioLabel)),
              )
            : scenarios;
        const modelOptions = metaData?.models?.length
            ? metaData.models
            : models;

        const activeScenarios = (
            state.chartScenarios.length ? state.chartScenarios : scenarioOptions
        ).filter((s) => scenarioOptions.includes(s));

        const activeModels = (
            state.chartModels.length ? state.chartModels : modelOptions
        ).filter((m) => modelOptions.includes(m));

        if (!activeScenarios.length || !activeModels.length) {
            state.chartError = "Select at least one scenario and one model.";
            state.chartSamples = [];
            state.chartBoxes = null;
            state.chartRangeSeries = null;
            state.chartLoading = false;
            state.chartLoadingProgress = { total: 0, done: 0 };
            updateChartContainerDOM();
            return;
        }

        const commonRange = intersectScenarioRange(activeScenarios);

        if (state.chartMode === "single") {
            const targetDate = clipDateToRange(state.chartDate, commonRange);
            if (targetDate !== state.chartDate) {
                state.chartDate = targetDate;
            }

            const totalRequests = activeScenarios.length * activeModels.length;
            state.chartLoadingProgress = { total: totalRequests, done: 0 };
            state.chartRangeSeries = null;
            updateChartContainerDOM();

            const samples: ChartSample[] = [];

            // Check if we should use pixel-data API (Point, Search, or Draw locations)
            const usePixelApi =
                (state.chartLocation === "Point" ||
                    state.chartLocation === "Search") &&
                state.chartPoint
                    ? true
                    : state.chartLocation === "Draw" &&
                      state.chartPolygon &&
                      state.chartPolygon.length >= 3;

            if (usePixelApi) {
                if (
                    (state.chartLocation === "Point" ||
                        state.chartLocation === "Search") &&
                    state.chartPoint
                ) {
                    // ── SSE fast path ───────────────────────────────────────────────────
                    // Fire ALL scenario×model combos in one /pixel-data-stream request.
                    // The server fans them out via a ThreadPoolExecutor and emits each
                    // result as an SSE event the moment it completes, giving progressive
                    // chart updates instead of a single burst after the slowest model.
                    const [_isx, _isClientY] = latLonToGridIndices(
                        state.chartPoint.lat,
                        state.chartPoint.lon,
                    );
                    const _isOvY = GRID_HEIGHT - 1 - _isClientY;
                    // Build flat list: all scenario×model combos with per-scenario dates
                    const _isCombos = activeScenarios.flatMap((sc) => {
                        const d = clipDateToRange(
                            state.chartDate,
                            getTimeRangeForScenario(sc),
                        );
                        return activeModels.map((model) => ({
                            model,
                            scenarioLabel: sc,
                            scenario: normalizeScenario(sc),
                            date: d,
                        }));
                    });
                    await fetchPixelDataStream(
                        {
                            variable: state.chartVariable,
                            x0: _isx, x1: _isx, y0: _isOvY, y1: _isOvY,
                            resolution: "low",
                            step_days: 1,
                            combinations: _isCombos.map((c) => ({
                                model: c.model,
                                scenario: c.scenario,
                                start_date: c.date,
                                end_date: c.date,
                            })),
                        },
                        (event) => {
                            if (event.status !== "ok") return;
                            const _ic = _isCombos[event.combo_idx] ??
                                _isCombos.find((c) =>
                                    c.model === event.model &&
                                    c.scenario === event.scenario);
                            if (!_ic) return;
                            const value = event.values?.[0] ?? null;
                            if (value !== null && isFinite(value)) {
                                const rawValue = state.chartVariable === "hurs"
                                    ? Math.min(value, 100) : value;
                                samples.push({
                                    scenario: _ic.scenarioLabel,
                                    model: event.model,
                                    rawValue,
                                    dateUsed: _ic.date,
                                });
                            }
                            state.chartLoadingProgress = {
                                total: totalRequests,
                                done: state.chartLoadingProgress.done + 1,
                            };
                            setLoadingProgress(
                                Math.min(98, Math.round(
                                    (state.chartLoadingProgress.done / totalRequests) * 100,
                                )),
                            );
                            updateChartPreview(samples);
                        },
                    );
                } else {
                // Draw: per-scenario aggregate-on-demand (already batches all models)
                for (const scenario of activeScenarios) {
                    const dateForScenario = clipDateToRange(
                        state.chartDate,
                        getTimeRangeForScenario(scenario),
                    );

                    try {
                        if (
                            (state.chartLocation === "Point" ||
                                state.chartLocation === "Search") &&
                            state.chartPoint
                        ) {
                            // Single point: parallelize pixel-data API requests for all models
                            const [x, _clientY] = latLonToGridIndices(
                                state.chartPoint.lat,
                                state.chartPoint.lon,
                            );
                            // Flip y: OpenVisus is south-up, latLonToGridIndices is north-down
                            const ovY = GRID_HEIGHT - 1 - _clientY;
                            console.log(
                                `Fetching pixel data for point (${x}, ${ovY}) for ${activeModels.length} models`,
                            );

                            // Parallelize requests for all models (rate-limited)
                            const pixelResults = await pLimit(
                                activeModels.map((model) => () =>
                                fetchPixelData({
                                    variable: state.chartVariable,
                                    model,
                                    x0: x,
                                    x1: x,
                                    y0: ovY,
                                    y1: ovY,
                                    start_date: dateForScenario,
                                    end_date: dateForScenario,
                                    scenario: normalizeScenario(scenario),
                                    resolution: "low",
                                    step_days: 1,
                                }).catch((error) => {
                                    console.warn(
                                        `Pixel API failed for model ${model}, falling back:`,
                                        error,
                                    );
                                    // Fallback to old method for this model
                                    if (!state.chartPoint) {
                                        throw error;
                                    }
                                    const request = createDataRequest({
                                        variable: state.chartVariable,
                                        date: dateForScenario,
                                        model,
                                        scenario,
                                        resolution: 1,
                                    });
                                    return fetchClimateData(request).then(
                                        (data) => {
                                            const arr = dataToArray(data);
                                            if (!arr) {
                                                throw new Error(
                                                    "No data returned for chart request.",
                                                );
                                            }
                                            if (!state.chartPoint) {
                                                throw new Error(
                                                    "No chart point selected",
                                                );
                                            }
                                            const avg = valueAtPoint(
                                                arr,
                                                state.chartVariable,
                                                data.shape,
                                                state.chartPoint,
                                            );
                                            return {
                                                model,
                                                value: avg,
                                                fallback: true,
                                            } as {
                                                model: string;
                                                value: number;
                                                fallback: boolean;
                                            };
                                        },
                                    );
                                }),
                            ), PARALLEL_REQUEST_LIMIT);

                            // Process results
                            for (const result of pixelResults) {
                                if (result.status === "fulfilled") {
                                    const data = result.value;
                                    if (
                                        typeof data === "object" &&
                                        "fallback" in data &&
                                        data.fallback
                                    ) {
                                        // Already processed in fallback
                                        samples.push({
                                            scenario,
                                            model: data.model,
                                            rawValue: data.value,
                                            dateUsed: dateForScenario,
                                        });
                                    } else {
                                        // Pixel data response
                                        const pixelData = data as any;
                                        const value = pixelData.values[0];
                                        if (value !== null && isFinite(value)) {
                                            const rawValue =
                                                state.chartVariable === "hurs"
                                                    ? Math.min(value, 100)
                                                    : value;
                                            samples.push({
                                                scenario,
                                                model: pixelData.model,
                                                rawValue,
                                                dateUsed: dateForScenario,
                                            });
                                        }
                                    }
                                } else {
                                    console.warn(
                                        `Failed to fetch pixel data:`,
                                        result.reason,
                                    );
                                }
                            }

                            // Update progress for all models at once
                            state.chartLoadingProgress = {
                                total: totalRequests,
                                done:
                                    state.chartLoadingProgress.done +
                                    activeModels.length,
                            };
                            setLoadingProgress(
                                Math.min(
                                    98,
                                    Math.round(
                                        (state.chartLoadingProgress.done /
                                            totalRequests) *
                                            100,
                                    ),
                                ),
                            );
                            updateChartPreview(samples);
                        } else if (
                            state.chartLocation === "Draw" &&
                            state.chartPolygon &&
                            state.chartPolygon.length >= 3
                        ) {
                            // Polygon: batch all models in a single aggregate-on-demand request
                            const [x0, x1, clientY0, clientY1] = polygonToGridBounds(
                                state.chartPolygon,
                            );
                            // Flip y: OpenVisus south-up vs north-down client convention
                            const y0 = GRID_HEIGHT - 1 - clientY1;
                            const y1 = GRID_HEIGHT - 1 - clientY0;
                            const mask = createPolygonMask(
                                state.chartPolygon,
                                x0,
                                x1,
                                clientY0,
                                clientY1,
                            ).reverse();

                            console.log(
                                `Fetching aggregate data for polygon window [${x0},${x1},${y0},${y1}] for ${activeModels.length} models`,
                            );

                            try {
                                // Batch all models in one request
                                const aggregateData =
                                    await fetchAggregateOnDemand({
                                        variable: state.chartVariable,
                                        models: activeModels,
                                        x0,
                                        x1,
                                        y0,
                                        y1,
                                        start_date: dateForScenario,
                                        end_date: dateForScenario,
                                        scenario: normalizeScenario(scenario),
                                        resolution: "low",
                                        step_days: 1,
                                        mask,
                                    });

                                // Process all models from the batch response
                                for (const model of activeModels) {
                                    const modelData =
                                        aggregateData.models[model];
                                    if (modelData) {
                                        const value = modelData.values[0];
                                        if (value !== null && isFinite(value)) {
                                            const rawValue =
                                                state.chartVariable === "hurs"
                                                    ? Math.min(value, 100)
                                                    : value;
                                            samples.push({
                                                scenario,
                                                model,
                                                rawValue,
                                                dateUsed: dateForScenario,
                                            });
                                        }
                                    }
                                }

                                // Update progress for all models at once
                                state.chartLoadingProgress = {
                                    total: totalRequests,
                                    done:
                                        state.chartLoadingProgress.done +
                                        activeModels.length,
                                };
                                setLoadingProgress(
                                    Math.min(
                                        98,
                                        Math.round(
                                            (state.chartLoadingProgress.done /
                                                totalRequests) *
                                                100,
                                        ),
                                    ),
                                );
                                updateChartPreview(samples);
                            } catch (error) {
                                // If batch fails, fall back to old method for all models
                                console.warn(
                                    "Batch aggregate API failed, falling back to full map load:",
                                    error,
                                );
                                for (const model of activeModels) {
                                    const request = createDataRequest({
                                        variable: state.chartVariable,
                                        date: dateForScenario,
                                        model,
                                        scenario,
                                        resolution: 1,
                                    });
                                    const data =
                                        await fetchClimateData(request);
                                    const arr = dataToArray(data);
                                    if (!arr) {
                                        continue;
                                    }
                                    const avg = averageArrayInPolygon(
                                        arr,
                                        state.chartVariable,
                                        data.shape,
                                        state.chartPolygon,
                                    );
                                    samples.push({
                                        scenario,
                                        model,
                                        rawValue: avg,
                                        dateUsed: dateForScenario,
                                    });
                                }
                                updateChartPreview(samples);
                            }
                        }
                    } catch (error) {
                        console.error("Error in pixel API path:", error);
                        throw error;
                    }
                }
                } // end else: Draw per-scenario aggregate
            } else {
                // World location: use old method (load full map)
                for (const scenario of activeScenarios) {
                    const dateForScenario = clipDateToRange(
                        state.chartDate,
                        getTimeRangeForScenario(scenario),
                    );
                    for (const model of activeModels) {
                        const done = state.chartLoadingProgress.done;
                        setLoadingProgress(
                            Math.min(
                                95,
                                Math.round(
                                    ((done + 0.1) / totalRequests) * 100,
                                ),
                            ),
                        );
                        const request = createDataRequest({
                            variable: state.chartVariable,
                            date: dateForScenario,
                            model,
                            scenario,
                            resolution: 1,
                        });
                        const data = await fetchClimateData(request);
                        const after = state.chartLoadingProgress.done + 1;
                        state.chartLoadingProgress = {
                            total: totalRequests,
                            done: after,
                        };
                        setLoadingProgress(
                            Math.min(
                                98,
                                Math.round((after / totalRequests) * 100),
                            ),
                        );
                        updateChartPreview(samples);
                        const arr = dataToArray(data);
                        if (!arr) {
                            throw new Error(
                                "No data returned for chart request.",
                            );
                        }
                        const avg = averageArray(arr, state.chartVariable);
                        samples.push({
                            scenario,
                            model,
                            rawValue: avg,
                            dateUsed: dateForScenario,
                        });
                    }
                }
            }

            state.chartSamples = samples;
            state.chartBoxes = buildChartBoxes(
                samples,
                state.chartVariable,
                state.chartUnit,
            );
            state.chartLoadingProgress = {
                total: totalRequests,
                done: totalRequests,
            };
            setLoadingProgress(100);
        } else {
            let rangeStart = clipDateToRange(
                state.chartRangeStart,
                commonRange,
            );
            let rangeEnd = clipDateToRange(state.chartRangeEnd, commonRange);
            if (parseDate(rangeStart) > parseDate(rangeEnd)) {
                [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
            }
            state.chartRangeStart = rangeStart;
            state.chartRangeEnd = rangeEnd;
            const useFixedAnnualSamples = shouldUseFixedAnnualSamples(
                rangeStart,
                rangeEnd,
            );
            const fixedReferenceDate = rangeStart;

            if (USE_TOY_RANGE_DATA) {
                const toySeries = generateToyRangeSeries({
                    scenarios: activeScenarios,
                    startDate: rangeStart,
                    endDate: rangeEnd,
                    modelsPerScenario: Math.max(1, activeModels.length),
                });
                state.chartSamples = flattenSeriesToSamples(toySeries);
                state.chartRangeSeries = toySeries;
                state.chartBoxes = null;
                state.chartLoadingProgress = { total: 0, done: 0 };
                setLoadingProgress(100);
            } else {
                // Check if we should use pixel-data API (Point, Search, or Draw locations)
                const usePixelApi =
                    (state.chartLocation === "Point" ||
                        state.chartLocation === "Search") &&
                    state.chartPoint
                        ? true
                        : state.chartLocation === "Draw" &&
                          state.chartPolygon &&
                          state.chartPolygon.length >= 3;

                if (usePixelApi) {
                    console.log("Using pixel-data API for range mode");
                    // Use pixel-data API: single request per scenario/model for full time series
                    const totalRequests =
                        activeScenarios.length * activeModels.length;
                    state.chartLoadingProgress = {
                        total: totalRequests,
                        done: 0,
                    };
                    state.chartBoxes = null;
                    updateChartContainerDOM();

                    const samples: ChartSample[] = [];
                    let _rangeProgressDone = 0;
                    // Called by each parallel task as it completes; streams live preview
                    const _onRangeTaskDone = () => {
                        _rangeProgressDone++;
                        state.chartLoadingProgress = {
                            total: totalRequests,
                            done: _rangeProgressDone,
                        };
                        setLoadingProgress(
                            Math.min(
                                98,
                                Math.round(
                                    (_rangeProgressDone / totalRequests) * 100,
                                ),
                            ),
                        );
                        updateChartPreview(samples);
                    };

                    if (
                        (state.chartLocation === "Point" ||
                            state.chartLocation === "Search") &&
                        state.chartPoint
                    ) {
                        // POINT – fire all model × scenario combos in parallel.
                        // Each loadRangePointSamples call issues one /pixel-data
                        // request for the full date range; completing each one
                        // triggers a live preview update via _onRangeTaskDone.
                        const _point = state.chartPoint;
                        const combinations = activeModels.flatMap((model) =>
                            activeScenarios
                                .map((scenario) => {
                                    const sr = getTimeRangeForScenario(scenario);
                                    const cs = clipDateToRange(rangeStart, sr);
                                    const ce = clipDateToRange(rangeEnd, sr);
                                    return parseDate(cs) <= parseDate(ce)
                                        ? { model, scenario }
                                        : null;
                                })
                                .filter(
                                    (x): x is { model: string; scenario: string } =>
                                        x !== null,
                                ),
                        );

                        const [_rx, _rClientY] = latLonToGridIndices(
                            _point.lat,
                            _point.lon,
                        );
                        const _rOvY = GRID_HEIGHT - 1 - _rClientY;

                        // SSE stream: fire all scenario×model combos at once;
                        // each result triggers a live preview update as it arrives.
                        // step_days targets ~60 data points for the range so the
                        // server's load_pixel_time_series doesn't loop through 200+
                        // dates sequentially (which was causing the 27-second freeze).
                        const _rangeDays = Math.max(1,
                            (parseDate(rangeEnd).getTime() - parseDate(rangeStart).getTime()) / 86400000);
                        const _sseStepDays = useFixedAnnualSamples
                            ? 365
                            : Math.max(7, Math.round(_rangeDays / 60));
                        await fetchPixelDataStream(
                            {
                                variable: state.chartVariable,
                                x0: _rx, x1: _rx, y0: _rOvY, y1: _rOvY,
                                resolution: "low",
                                step_days: _sseStepDays,
                                combinations: combinations.map(({ model, scenario }) => {
                                    const sr = getTimeRangeForScenario(scenario);
                                    return {
                                        model,
                                        scenario: normalizeScenario(scenario),
                                        start_date: clipDateToRange(rangeStart, sr),
                                        end_date:   clipDateToRange(rangeEnd,   sr),
                                    };
                                }),
                            },
                            (event) => {
                                if (event.status !== "ok") return;
                                const _rc = combinations[event.combo_idx] ??
                                    combinations.find((c) => c.model === event.model);
                                if (!_rc) return;
                                for (let _ri = 0; _ri < (event.timestamps?.length ?? 0); _ri++) {
                                    const value = event.values[_ri];
                                    if (value !== null && isFinite(value)) {
                                        const rawValue = state.chartVariable === "hurs"
                                            ? Math.min(value, 100) : value;
                                        samples.push({
                                            scenario: _rc.scenario,
                                            model: event.model,
                                            rawValue,
                                            dateUsed: event.timestamps[_ri],
                                        });
                                    }
                                }
                                _onRangeTaskDone();
                            },
                        );
                    } else if (
                        state.chartLocation === "Draw" &&
                        state.chartPolygon &&
                        state.chartPolygon.length >= 3
                    ) {
                        // POLYGON – one aggregate-on-demand request per scenario batching
                        // ALL models, then fire all scenarios in parallel.
                        const _polygon = state.chartPolygon;
                        const [x0, x1, _clientY0, _clientY1] =
                            polygonToGridBounds(_polygon);
                        // Flip y: OpenVisus south-up vs north-down client convention
                        const y0 = GRID_HEIGHT - 1 - _clientY1;
                        const y1 = GRID_HEIGHT - 1 - _clientY0;
                        const mask = createPolygonMask(
                            _polygon,
                            x0,
                            x1,
                            _clientY0,
                            _clientY1,
                        ).reverse();

                        await Promise.allSettled(
                            activeScenarios.map(async (scenario) => {
                                const scenarioRange =
                                    getTimeRangeForScenario(scenario);
                                const clippedStart = clipDateToRange(
                                    rangeStart,
                                    scenarioRange,
                                );
                                const clippedEnd = clipDateToRange(
                                    rangeEnd,
                                    scenarioRange,
                                );
                                if (
                                    parseDate(clippedStart) >
                                    parseDate(clippedEnd)
                                ) {
                                    // No valid date range for this scenario – count all models done
                                    for (const _m of activeModels)
                                        _onRangeTaskDone();
                                    return;
                                }

                                try {
                                    // Batch all models in a single server request
                                    const aggregateData =
                                        await fetchAggregateOnDemand({
                                            variable: state.chartVariable,
                                            models: activeModels,
                                            x0,
                                            x1,
                                            y0,
                                            y1,
                                            start_date: clippedStart,
                                            end_date: clippedEnd,
                                            scenario:
                                                normalizeScenario(scenario),
                                            resolution: "low",
                                            step_days: 1,
                                            mask,
                                        });

                                    for (const model of activeModels) {
                                        const modelData =
                                            aggregateData.models[model];
                                        if (modelData) {
                                            for (
                                                let i = 0;
                                                i <
                                                modelData.timestamps.length;
                                                i++
                                            ) {
                                                const timestamp =
                                                    modelData.timestamps[i];
                                                if (
                                                    useFixedAnnualSamples &&
                                                    !isSameMonthDay(
                                                        timestamp,
                                                        fixedReferenceDate,
                                                    )
                                                )
                                                    continue;
                                                const value =
                                                    modelData.values[i];
                                                if (
                                                    value !== null &&
                                                    isFinite(value)
                                                ) {
                                                    const rawValue =
                                                        state.chartVariable ===
                                                        "hurs"
                                                            ? Math.min(
                                                                  value,
                                                                  100,
                                                              )
                                                            : value;
                                                    samples.push({
                                                        scenario,
                                                        model,
                                                        rawValue,
                                                        dateUsed: timestamp,
                                                    });
                                                }
                                            }
                                        }
                                        _onRangeTaskDone();
                                    }
                                } catch (error) {
                                    console.warn(
                                        `Aggregate failed for scenario ${scenario}, falling back per-model:`,
                                        error,
                                    );
                                    // Fallback: sequential sampled-date full-raster loads per model
                                    for (const model of activeModels) {
                                        try {
                                            const sampledDates =
                                                useFixedAnnualSamples
                                                    ? buildFixedAnnualSampleDates(
                                                          fixedReferenceDate,
                                                          clippedStart,
                                                          clippedEnd,
                                                          50,
                                                      )
                                                    : buildRangeSampleDates(
                                                          clippedStart,
                                                          clippedEnd,
                                                          50,
                                                      );
                                            for (const dateCandidate of sampledDates) {
                                                const dateForScenario =
                                                    useFixedAnnualSamples
                                                        ? dateCandidate
                                                        : clipDateToRange(
                                                              dateCandidate,
                                                              scenarioRange,
                                                          );
                                                if (
                                                    useFixedAnnualSamples &&
                                                    !isDateWithinRange(
                                                        dateForScenario,
                                                        scenarioRange,
                                                    )
                                                )
                                                    continue;
                                                try {
                                                    const data =
                                                        await fetchClimateData(
                                                            createDataRequest({
                                                                variable:
                                                                    state.chartVariable,
                                                                date: dateForScenario,
                                                                model,
                                                                scenario,
                                                                resolution: 1,
                                                            }),
                                                        );
                                                    const arr =
                                                        dataToArray(data);
                                                    if (arr) {
                                                        const avg =
                                                            averageArrayInPolygon(
                                                                arr,
                                                                state.chartVariable,
                                                                data.shape,
                                                                _polygon,
                                                            );
                                                        samples.push({
                                                            scenario,
                                                            model,
                                                            rawValue: avg,
                                                            dateUsed:
                                                                dateForScenario,
                                                        });
                                                    }
                                                } catch (e) {
                                                    console.warn(
                                                        "Fallback date failed:",
                                                        e,
                                                    );
                                                }
                                            }
                                        } catch (e) {
                                            console.warn(
                                                `Fallback failed for ${model}/${scenario}:`,
                                                e,
                                            );
                                        }
                                        _onRangeTaskDone();
                                    }
                                }
                                updateChartPreview(samples);
                            }),
                        );
                    }

                    state.chartSamples = samples;
                    state.chartRangeSeries = buildChartRangeSeries(
                        samples,
                        state.chartVariable,
                        state.chartUnit,
                    );
                    state.chartLoadingProgress = {
                        total: totalRequests,
                        done: totalRequests,
                    };
                    setLoadingProgress(100);
                } else {
                    const sampledDates = useFixedAnnualSamples
                        ? buildFixedAnnualSampleDates(
                              fixedReferenceDate,
                              rangeStart,
                              rangeEnd,
                              50,
                          )
                        : buildRangeSampleDates(rangeStart, rangeEnd, 50);
                    if (!sampledDates.length) {
                        state.chartError =
                            "Enter a valid date range within the selected scenarios.";
                        state.chartSamples = [];
                        state.chartBoxes = null;
                        state.chartRangeSeries = null;
                        state.chartLoading = false;
                        state.chartLoadingProgress = { total: 0, done: 0 };
                        updateChartContainerDOM();
                        return;
                    }

                    const totalRequests =
                        activeScenarios.length *
                        activeModels.length *
                        sampledDates.length;
                    state.chartLoadingProgress = {
                        total: totalRequests,
                        done: 0,
                    };
                    state.chartBoxes = null;
                    updateChartContainerDOM();

                    const samples: ChartSample[] = [];
                    let _worldProgressDone = 0;

                    // Parallelise across model×scenario combos; within each combo
                    // dates remain sequential so we don't flood the server with all
                    // 1650 requests at once (wall time ≈ 50 requests instead of 1650).
                    await Promise.allSettled(
                      activeModels.flatMap((model) =>
                        activeScenarios.map(async (scenario) => {
                            const scenarioRange =
                                getTimeRangeForScenario(scenario);
                            for (const dateCandidate of sampledDates) {
                                const dateForScenario = useFixedAnnualSamples
                                    ? dateCandidate
                                    : clipDateToRange(
                                          dateCandidate,
                                          scenarioRange,
                                      );
                                if (
                                    useFixedAnnualSamples &&
                                    !isDateWithinRange(
                                        dateForScenario,
                                        scenarioRange,
                                    )
                                ) {
                                    _worldProgressDone++;
                                    continue;
                                }
                                const request = createDataRequest({
                                    variable: state.chartVariable,
                                    date: dateForScenario,
                                    model,
                                    scenario,
                                    resolution: 1,
                                });
                                let data: ClimateData | null = null;
                                try {
                                    data = await fetchClimateData(request);
                                } catch (error) {
                                    console.warn(
                                        "Range request failed, skipping date:",
                                        error,
                                    );
                                    _worldProgressDone++;
                                    continue;
                                }
                                _worldProgressDone++;
                                state.chartLoadingProgress = {
                                    total: totalRequests,
                                    done: _worldProgressDone,
                                };
                                setLoadingProgress(
                                    Math.min(
                                        98,
                                        Math.round(
                                            (_worldProgressDone / totalRequests) * 100,
                                        ),
                                    ),
                                );
                                const arr = dataToArray(data);
                                if (!arr) continue;
                                const avg =
                                    state.chartLocation === "Draw" &&
                                    state.chartPolygon &&
                                    state.chartPolygon.length >= 3
                                        ? averageArrayInPolygon(
                                              arr,
                                              state.chartVariable,
                                              data.shape,
                                              state.chartPolygon,
                                          )
                                        : (state.chartLocation === "Point" ||
                                                state.chartLocation ===
                                                    "Search") &&
                                            state.chartPoint
                                          ? valueAtPoint(
                                                arr,
                                                state.chartVariable,
                                                data.shape,
                                                state.chartPoint,
                                            )
                                          : averageArray(
                                                arr,
                                                state.chartVariable,
                                            );
                                samples.push({
                                    scenario,
                                    model,
                                    rawValue: avg,
                                    dateUsed: dateForScenario,
                                });
                                updateChartPreview(samples);
                            } // end for dateCandidate
                        }), // end scenario async fn
                      ), // end activeScenarios.map
                    ); // end Promise.allSettled

                    state.chartSamples = samples;
                    state.chartRangeSeries = buildChartRangeSeries(
                        samples,
                        state.chartVariable,
                        state.chartUnit,
                    );
                    state.chartLoadingProgress = {
                        total: totalRequests,
                        done: totalRequests,
                    };
                    setLoadingProgress(100);
                }
            }
        }
    } catch (error) {
        state.chartError =
            error instanceof DataClientError && error.statusCode
                ? error.message
                : error instanceof Error
                  ? error.message
                  : String(error);
        state.chartSamples = [];
        state.chartBoxes = null;
        state.chartRangeSeries = null;
        state.chartLoadingProgress = { total: 1, done: 1 };
    } finally {
        state.chartLoading = false;
        updateChartContainerDOM();
    }
}

async function loadClimateData() {
    // Prevent reloads during mask updates - user must click Apply button
    if ((state as any).__updatingMask) {
        console.log("Skipping loadClimateData - mask update in progress");
        return;
    }
    console.log("fetching");
    if (state.canvasView !== "map") {
        return;
    }
    const requestId = ++climateDataRequestId;

    state.isLoading = true;
    setLoadingProgress(5, true);

    state.dataError = null;

    try {
        const metaData = await fetchMetadata();
        state.metaData = metaData;
        state.availableModels = metaData.models;
        setLoadingProgress(20);

        let activeScenarioForRange = state.scenario;
        if (state.mode === "Compare" && state.compareMode === "Scenarios") {
            activeScenarioForRange = state.compareScenarioA;
        } else if (state.mode === "Ensemble") {
            activeScenarioForRange =
                state.ensembleScenarios.length > 0
                    ? state.ensembleScenarios[0]
                    : state.scenario;
        }
        // Update time range based on the scenario driving the current request
        state.timeRange = getTimeRangeForScenario(activeScenarioForRange);
        setLoadingProgress(30);

        const result =
            state.mode === "Compare"
                ? await loadCompareData(
                      activeScenarioForRange,
                      setLoadingProgress,
                  )
                : state.mode === "Ensemble"
                  ? await loadEnsembleData(setLoadingProgress)
                  : await (async () => {
                        setLoadingProgress(40);
                        const clippedDate = clipDateToScenarioRange(
                            state.date,
                            activeScenarioForRange,
                        );
                        if (clippedDate !== state.date) {
                            state.date = clippedDate;
                        }

                        const request = createDataRequest({
                            variable: state.variable,
                            date: clippedDate,
                            model: state.model,
                            scenario: state.scenario,
                            resolution: state.resolution,
                        });

                        setLoadingProgress(55);
                        let data = await fetchClimateData(request);
                        setLoadingProgress(80);
                        let arrayData = dataToArray(data);
                        if (!arrayData) {
                            throw new Error(
                                "No data returned for the selected parameters.",
                            );
                        }

                        // Cap relative humidity to 100% in Explore mode to avoid invalid values
                        if (state.variable === "hurs") {
                            const clamped = new Float32Array(arrayData.length);
                            let min = Infinity;
                            let max = -Infinity;
                            let sum = 0;
                            let count = 0;
                            for (let i = 0; i < arrayData.length; i++) {
                                const val = arrayData[i];
                                if (!isFinite(val)) {
                                    clamped[i] = NaN;
                                    continue;
                                }
                                const capped = Math.min(val, 100);
                                clamped[i] = capped;
                                min = Math.min(min, capped);
                                max = Math.max(max, capped);
                                sum += capped;
                                count += 1;
                            }
                            const mean = count > 0 ? sum / count : NaN;
                            data = {
                                ...data,
                                data: clamped,
                                data_encoding: "none",
                            };
                            arrayData = clamped;
                            return { data, min, max, mean };
                        }

                        const { min, max } = calculateMinMax(arrayData);
                        const mean = averageArray(arrayData, state.variable);
                        setLoadingProgress(95);
                        return { data, min, max, mean };
                    })();

        // Ignore stale responses; only the newest request may update shared state.
        if (requestId !== climateDataRequestId) {
            return;
        }

        state.currentData = result.data;
        state.dataMin = result.min;
        state.dataMax = result.max;
        state.dataMean = result.mean;

        // In Explore mode, load and cache data for all variables used in masks
        if (state.mode === "Explore" && getModeMasks(state) && getModeMasks(state).length > 0) {
            const clippedDate = clipDateToScenarioRange(
                state.date,
                activeScenarioForRange,
            );

            // Collect unique variables from masks (excluding the current variable)
            const maskVariables = new Set<string>();
            for (const mask of getModeMasks(state)) {
                if (mask.variable && mask.variable !== state.variable) {
                    maskVariables.add(mask.variable);
                }
            }

            // Load data for each mask variable
            state.maskVariableData.clear();
            state.maskVariableRanges.clear();
            for (const maskVar of maskVariables) {
                try {
                    const maskRequest = createDataRequest({
                        variable: maskVar,
                        date: clippedDate,
                        model: state.model,
                        scenario: state.scenario,
                        resolution: state.resolution,
                    });

                    const maskData = await fetchClimateData(maskRequest);
                    let maskArrayData = dataToArray(maskData);

                    // Cap relative humidity to 100% if needed
                    if (maskVar === "hurs") {
                        if (maskArrayData) {
                            const clamped = new Float32Array(
                                maskArrayData.length,
                            );
                            for (let i = 0; i < maskArrayData.length; i++) {
                                const val = maskArrayData[i];
                                if (!isFinite(val)) {
                                    clamped[i] = NaN;
                                } else {
                                    clamped[i] = Math.min(val, 100);
                                }
                            }
                            maskArrayData = clamped;
                            state.maskVariableData.set(maskVar, {
                                ...maskData,
                                data: clamped,
                                data_encoding: "none",
                            });
                        } else {
                            state.maskVariableData.set(maskVar, maskData);
                        }
                    } else {
                        state.maskVariableData.set(maskVar, maskData);
                    }

                    if (maskArrayData) {
                        const { min, max } = calculateMinMax(maskArrayData);
                        state.maskVariableRanges.set(maskVar, { min, max });
                    }
                } catch (error) {
                    console.warn(
                        `Failed to load data for mask variable ${maskVar}:`,
                        error,
                    );
                    // Continue loading other variables even if one fails
                }
            }
        }

        // Ignore stale responses; only the newest request may update UI/loading state.
        if (requestId !== climateDataRequestId) {
            return;
        }

        setLoadingProgress(100);
        state.isLoading = false;

        render();

        if (appRoot) {
            const canvas =
                appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
            if (canvas) {
                applyMapInteractions(canvas);
            }
        }
    } catch (error) {
        // Ignore stale failures; a newer request is already in flight.
        if (requestId !== climateDataRequestId) {
            return;
        }

        if (error instanceof DataClientError && error.statusCode) {
            state.dataError = error.message;
        } else {
            state.dataError =
                error instanceof Error ? error.message : String(error);
        }
        state.isLoading = false;
        setLoadingProgress(0, true);
        state.currentData = null;
        state.dataMin = null;
        state.dataMax = null;
        state.dataMean = null;
        render();
    }
}

// ---- Window 2 data loading -----------------------------------------------
let window2DataRequestId = 0;

function setW2LoadingProgress(value: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    state.window2.loadingProgress = clamped;
    render();
}

async function loadClimateDataWindow2() {
    if (!state.splitView || state.window2.canvasView !== "map") return;
    const requestId = ++window2DataRequestId;

    state.window2.isLoading = true;
    state.window2.loadingProgress = 5;
    state.window2.dataError = null;
    render();

    try {
        if (!state.metaData) await fetchMetadata();
        if (requestId !== window2DataRequestId) return;
        const w2 = state.window2;

        let activeScenarioForRange = w2.scenario;
        if (w2.mode === "Compare" && w2.compareMode === "Scenarios") {
            activeScenarioForRange = w2.compareScenarioA;
        } else if (w2.mode === "Ensemble") {
            activeScenarioForRange =
                w2.ensembleScenarios.length > 0
                    ? w2.ensembleScenarios[0]
                    : w2.scenario;
        }
        state.window2.timeRange = getTimeRangeForScenario(activeScenarioForRange);
        setW2LoadingProgress(30);

        let result: { data: ClimateData; min: number; max: number; mean: number };

        if (w2.mode === "Compare") {
            result = await loadCompareDataForWindow2(w2, setW2LoadingProgress);
        } else if (w2.mode === "Ensemble") {
            result = await loadEnsembleDataForWindow2(w2, setW2LoadingProgress);
        } else {
            const clippedDate = clipDateToScenarioRange(w2.date, activeScenarioForRange);
            if (clippedDate !== w2.date) w2.date = clippedDate;
            setW2LoadingProgress(40);

            const request = createDataRequest({
                variable: w2.variable,
                date: clippedDate,
                model: w2.model,
                scenario: w2.scenario,
                resolution: w2.resolution,
            });

            const data = await fetchClimateData(request);
            if (requestId !== window2DataRequestId) return;

            let arrayData = dataToArray(data);
            if (!arrayData) {
                throw new Error("No data returned for the selected parameters.");
            }

            if (w2.variable === "hurs") {
                const clamped = new Float32Array(arrayData.length);
                let min = Infinity;
                let max = -Infinity;
                let sum = 0;
                let count = 0;
                for (let i = 0; i < arrayData.length; i++) {
                    const val = arrayData[i];
                    if (!isFinite(val)) {
                        clamped[i] = NaN;
                        continue;
                    }
                    const capped = Math.min(val, 100);
                    clamped[i] = capped;
                    min = Math.min(min, capped);
                    max = Math.max(max, capped);
                    sum += capped;
                    count += 1;
                }
                const mean = count > 0 ? sum / count : NaN;
                result = {
                    data: { ...data, data: clamped, data_encoding: "none" },
                    min,
                    max,
                    mean,
                };
            } else {
                const { min, max } = calculateMinMax(arrayData);
                const mean = averageArray(arrayData, w2.variable);
                result = { data, min, max, mean };
            }
        }

        if (requestId !== window2DataRequestId) return;

        state.window2.currentData = result.data;
        state.window2.dataMin = result.min;
        state.window2.dataMax = result.max;

        // In Explore mode, load and cache data for all variables used in masks
        if (
            w2.mode === "Explore" &&
            getModeMasks(w2) &&
            getModeMasks(w2).length > 0
        ) {
            const clippedDate = clipDateToScenarioRange(w2.date, activeScenarioForRange);
            const maskVariables = new Set<string>();
            for (const mask of getModeMasks(w2)) {
                if (mask.variable && mask.variable !== w2.variable) {
                    maskVariables.add(mask.variable);
                }
            }
            state.window2.maskVariableData.clear();
            state.window2.maskVariableRanges.clear();
            for (const maskVar of maskVariables) {
                try {
                    const maskRequest = createDataRequest({
                        variable: maskVar,
                        date: clippedDate,
                        model: w2.model,
                        scenario: w2.scenario,
                        resolution: w2.resolution,
                    });
                    const maskData = await fetchClimateData(maskRequest);
                    let maskArrayData = dataToArray(maskData);
                    if (maskVar === "hurs" && maskArrayData) {
                        const clamped = new Float32Array(maskArrayData.length);
                        for (let i = 0; i < maskArrayData.length; i++) {
                            const val = maskArrayData[i];
                            clamped[i] =
                                !isFinite(val) ? NaN : Math.min(val, 100);
                        }
                        maskArrayData = clamped;
                        state.window2.maskVariableData.set(maskVar, {
                            ...maskData,
                            data: clamped,
                            data_encoding: "none",
                        });
                    } else {
                        state.window2.maskVariableData.set(maskVar, maskData);
                    }
                    if (maskArrayData) {
                        const { min, max } = calculateMinMax(maskArrayData);
                        state.window2.maskVariableRanges.set(maskVar, {
                            min,
                            max,
                        });
                    }
                } catch (error) {
                    console.warn(
                        `Failed to load mask variable ${maskVar} for window 2:`,
                        error,
                    );
                }
            }
        }
        if (requestId !== window2DataRequestId) return;

        state.window2.isLoading = false;
        state.window2.loadingProgress = 100;

        render(); // creates / swaps persistentCanvas2 into DOM

        // Full pixel render onto the persistent canvas (already in DOM after render()).
        if (
            persistentCanvas2 &&
            state.window2.currentData &&
            state.window2.dataMin !== null &&
            state.window2.dataMax !== null
        ) {
            const isEnsemble = w2.mode === "Ensemble";
            const displayVariable = isEnsemble ? w2.ensembleVariable : w2.variable;
            const displayUnit = isEnsemble ? w2.ensembleUnit : w2.selectedUnit;
            renderMapDataWindow2(
                state.window2.currentData,
                persistentCanvas2,
                paletteOptions,
                state.window2.mapPalette,
                state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                displayVariable,
                displayUnit,
                getModeMasks(state.window2) && getModeMasks(state.window2).length > 0
                    ? getModeMasks(state.window2)
                    : undefined,
                isEnsemble ? w2.ensembleStatistics ?? undefined : undefined,
                isEnsemble,
                state.window2.maskVariableData.size > 0
                    ? state.window2.maskVariableData
                    : undefined,
                isEnsemble ? w2.ensembleStatisticsByVariable : undefined,
                isEnsemble ? w2.ensembleRawSamplesByVariable : undefined,
            );
            setupWindow2Interactions(persistentCanvas2, displayUnit ?? "", {
                onMapClick: (coords) => void handleMapClickW2(coords),
                onTransform: renderMapMarkerPositionW2,
            });
        }
    } catch (err) {
        if (requestId !== window2DataRequestId) return;
        state.window2.isLoading = false;
        state.window2.dataError =
            err instanceof Error ? err.message : "Failed to load data";
        render();
    }
}

// ---- Window 2 rendering ---------------------------------------------------
function renderWindow2Pane(vpW: number, vpH: number): string {
    const w2 = state.window2;
    const canvasStyle = `position:absolute;top:0;left:50%;transform:translateX(-50%);width:${vpW}px;height:${vpH}px;pointer-events:auto;`;
    const w2ModeTransform = w2.mode === "Explore" ? "translateX(0%)" : w2.mode === "Compare" ? "translateX(-33.333%)" : "translateX(-66.666%)";
    const w2ModeIndicatorTransform = w2.mode === "Explore" ? "translateX(0%)" : w2.mode === "Compare" ? "translateX(100%)" : "translateX(200%)";
    const w2ResolutionFill = ((w2.resolution - 1) / (3 - 1)) * 100;
    const w2TabTransform = w2.panelTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";

    const w2Progress = Math.max(
        0,
        Math.min(100, Math.round(w2.loadingProgress)),
    );
    const loadingHtml = w2.isLoading ? `
        <div style="${styleAttr(styles.loadingIndicator)}">
            <div style="${styleAttr(styles.loadingSpinner)}"></div>
            <div style="${styleAttr(styles.loadingTextGroup)}">
                <div style="${styleAttr(
                    styles.loadingText,
                )}">Loading data · ${w2Progress}%</div>
                <div style="${styleAttr(styles.loadingBar)}">
                    <div style="${styleAttr({
                        ...styles.loadingBarFill,
                        width: `${w2Progress}%`,
                    })}"></div>
                </div>
                <div style="${styleAttr(
                    styles.loadingSubtext,
                )}">Fetching climate tiles</div>
            </div>
        </div>` : "";

    const errorHtml = w2.dataError ? `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:10;">
            <div style="text-align:center;padding:20px;color:#f87171;font-size:13px;">${w2.dataError}</div>
        </div>` : "";

    const noDataHtml = !w2.isLoading && !w2.dataError && !w2.currentData && state.apiAvailable === true ? `
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);z-index:5;pointer-events:none;">
            <div style="text-align:center;">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);">No data loaded</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">Adjust settings to load climate data</div>
            </div>
        </div>` : "";

    return `
        <div id="split-pane-2" style="flex: 0 0 ${((1 - state.splitRatio) * 100).toFixed(2)}%;position:relative;overflow:hidden;">
            <div style="position:absolute;inset:0;">
                <canvas id="map-canvas-2" style="${canvasStyle}"></canvas>
                ${renderMapSearchBar(2)}
                ${loadingHtml}${errorHtml}${noDataHtml}
                ${renderMapMarkerOverlayW2()}
                ${renderMapInfoWindowW2()}
                ${renderMapRangeOverlayW2()}
                <div style="position:absolute;top:12px;right:12px;z-index:15;pointer-events:auto;">
                    <button type="button" data-action="close-split-view" aria-label="Close second window" title="Close second window"
                        style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid rgba(148,163,184,0.3);border-radius:6px;background:rgba(239,68,68,0.12);color:#f87171;cursor:pointer;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <aside data-role="sidebar" data-window="2" class="sidebar sidebar-in-pane" style="position:absolute;right:0;top:0;bottom:0;width:${SIDEBAR_WIDTH}px;transform:${w2.sidebarOpen ? "translateX(0)" : `translateX(${SIDEBAR_WIDTH + 24}px)`};pointer-events:${w2.sidebarOpen ? "auto" : "none"};" aria-hidden="${!w2.sidebarOpen}">
                <div class="sidebar-top">
                  <div class="sidebar-brand"><div class="logo-dot"></div></div>
                  <div class="tab-switch" style="${styleAttr(styles.tabSwitch)}">
                    ${(["Manual", "Chat"] as const).map((v) => renderTabButton(v, w2.panelTab === v ? styles.tabBtnActive : undefined, "panel-tab", "2")).join("")}
                  </div>
                </div>
                <div class="sidebar-content">
                  <div class="tab-viewport">
                    <div data-role="tab-track" class="tab-track" style="transform:${w2TabTransform}">
                      <div class="tab-pane">${w2.canvasView === "map" ? renderManualSection({ modeTransform: w2ModeTransform, resolutionFill: w2ResolutionFill, modeIndicatorTransform: w2ModeIndicatorTransform, window: 2 }) : "Chart view for View 2"}</div>
                      <div class="tab-pane">Chat (View 2)</div>
                    </div>
                  </div>
                </div>
                <div class="sidebar-footer">
                  <div class="sidebar-footer-item"><button type="button" class="sidebar-footer-btn" data-action="open-save-state" data-window="2" title="Save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save</button>${renderConfigDropup(state, "save", "2")}</div>
                  <div class="sidebar-footer-item"><button type="button" class="sidebar-footer-btn" data-action="open-load-state" data-window="2" title="Load"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Load</button>${renderConfigDropup(state, "load", "2")}</div>
                  <button type="button" class="sidebar-footer-btn" data-action="open-export" title="Export"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export</button>
                </div>
              </aside>
              ${renderSidebarToggle(w2.sidebarOpen, "2")}
        </div>
    `;
}

/** Attach drag-to-resize behaviour to the split-view divider. */
function setupSplitDivider() {
    if (!appRoot) return;
    const divider = appRoot.querySelector<HTMLElement>("#split-divider");
    const pane1   = appRoot.querySelector<HTMLElement>("#split-pane-1");
    const pane2   = appRoot.querySelector<HTMLElement>("#split-pane-2");
    if (!divider || !pane1 || !pane2) return;

    const indicator = divider.querySelector<HTMLElement>("div");

    divider.addEventListener("mouseenter", () => {
        if (indicator) indicator.style.background = "rgba(148,163,184,0.6)";
    });
    divider.addEventListener("mouseleave", () => {
        if (indicator) indicator.style.background = "rgba(148,163,184,0.2)";
    });

    divider.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        if (indicator) indicator.style.background = "rgba(148,163,184,0.9)";

        const onMove = (ev: MouseEvent) => {
            const ratio = Math.min(0.8, Math.max(0.2, ev.clientX / window.innerWidth));
            pane1.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
            pane2.style.flex = `0 0 ${((1 - ratio) * 100).toFixed(2)}%`;
            // Move the fixed W2 legend live
            const w2Wrapper = appRoot!.querySelector<HTMLElement>('.legend-wrapper[data-window="2"]');
            if (w2Wrapper) {
                w2Wrapper.style.left = `calc(${(ratio * 100).toFixed(2)}vw + 1rem)`;
            }
            // Live-resize range overlay body to match pane-1 width
            const rangeOverlay = pane1.querySelector<HTMLElement>('#map-range-overlay');
            if (rangeOverlay) {
                const rightOffset = state.sidebarOpen ? SIDEBAR_WIDTH : 0;
                const body = rangeOverlay.querySelector<HTMLElement>('.map-range-body');
                if (body) body.innerHTML = renderMapRangeBody(window.innerWidth * ratio - rightOffset);
            }
            // Live-resize range overlay body to match pane-2 width
            const rangeOverlayW2 = pane2.querySelector<HTMLElement>('#map-range-overlay-w2');
            if (rangeOverlayW2) {
                const w2RightOffset = state.window2.sidebarOpen ? SIDEBAR_WIDTH : 0;
                const bodyW2 = rangeOverlayW2.querySelector<HTMLElement>('.map-range-body-w2');
                if (bodyW2) bodyW2.innerHTML = renderMapRangeBodyW2(window.innerWidth * (1 - ratio) - w2RightOffset);
            }
            // Reposition markers as pane bounds change
            renderMapMarkerPosition();
            renderMapMarkerPositionW2();
        };

        const onUp = (ev: MouseEvent) => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            const ratio = Math.min(0.8, Math.max(0.2, ev.clientX / window.innerWidth));
            state.splitRatio = ratio;
            render();
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}

function renderBranding() {
    const isLight = document.documentElement.dataset.theme === 'light';
    const themeBtnTitle = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    const themeIcon = isLight
        ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
        : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    return `
      <div style="${styleAttr(styles.branding)}">
        <div data-role="brand-eye" style="${styleAttr(styles.brandIcon)}">
          <svg viewBox="0 0 120 80" style="${styleAttr(
              styles.brandSvg,
          )}" aria-hidden="true">
            <defs>
              <clipPath id="brand-eye-clip">
                <rect x="0" y="0" width="120" height="80" style="${styleAttr(
                    styles.brandClipRect,
                )}" />
              </clipPath>
            </defs>
            <g style="${styleAttr(styles.brandLids)}">
              <path
                d="M10 40c10-15 30-30 50-30s40 15 50 30c-10 15-30 30-50 30S20 55 10 40Z"
                style="${styleAttr(styles.brandOutline)}"
              />
            </g>
            <g data-role="brand-iris" style="${styleAttr(
                mergeStyles(styles.brandIrisGroup, styles.brandEyeContent),
            )}">
              <circle cx="60" cy="40" r="20" style="${styleAttr(
                  styles.brandIris,
              )}" />
              <g data-role="brand-pupil" style="${styleAttr(
                  styles.brandPupilGroup,
              )}">
                <circle cx="60" cy="40" r="10" style="${styleAttr(
                    styles.brandPupil,
                )}" />
                <circle cx="72" cy="30" r="4" style="${styleAttr(
                    styles.brandHighlight,
                )}" />
              </g>
            </g>
          </svg>
        </div>
        <span style="${styleAttr(styles.brandName)}">Polyoracle</span>
        <button
          type="button"
          data-action="toggle-theme"
          title="${themeBtnTitle}"
          aria-label="${themeBtnTitle}"
          style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid var(--border-subtle);border-radius:50%;background:transparent;color:var(--text-secondary);cursor:pointer;opacity:0.55;transition:opacity 0.2s ease,border-color 0.2s ease;"
          onmouseover="this.style.opacity='0.9';this.style.borderColor='var(--border-default)';"
          onmouseout="this.style.opacity='0.55';this.style.borderColor='var(--border-subtle)';"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${themeIcon}</svg>
        </button>
      </div>
    `;
}

function renderApiOfflineModal(state: AppState): string {
    if (state.apiAvailable !== false || !apiOfflineDelayReady) return "";

    const overlayStyle = mergeStyles(styles.infoModalOverlay, {
        position: "fixed",
        inset: "0",
        background: "rgba(3,7,18,0.35)",
        backdropFilter: "blur(6px)",
        zIndex: 20000,
        pointerEvents: "auto",
    });

    const modalStyle = mergeStyles(styles.infoModal, {
        maxWidth: "520px",
        width: "min(520px, 94vw)",
    });

    const bodyStyle = mergeStyles(styles.infoModalBody, {
        marginTop: 6,
        lineHeight: 1.6,
        whiteSpace: "normal",
        wordBreak: "break-word",
    });

    const buttonStyle = mergeStyles(styles.infoModalConfirm, {
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
    });

    return `
      <div data-role="api-offline-overlay" style="${styleAttr(overlayStyle)}">
        <div style="${styleAttr(
            modalStyle,
        )}" role="dialog" aria-modal="true" aria-label="Missing data access">
          <div style="${styleAttr(styles.infoModalHeader)}">
            <div style="${styleAttr(styles.infoModalTitle)}">
              Missing data access
            </div>
          </div>
          <div style="${styleAttr(bodyStyle)}">
            <p style="display:block;margin:0 0 10px 0;line-height:1.6;white-space:normal;word-break:break-word;">
              Download our backend and run
              <span style="font-family:var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);font-weight:400;">api_server.py</span>
              on your local machine.
            </p>
            <p style="display:block;margin:0;line-height:1.6;white-space:normal;word-break:break-word;">
              This will start a Python server on
              <span style="font-family:var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);font-weight:400;">http://0.0.0.0:8000</span>.
              Once it is running, refresh this page.
            </p>
          </div>
          <div style="${styleAttr(styles.infoModalFooter)}">
            <a
              href="data_processing.zip"
              download="data_processing.zip"
              style="${styleAttr(buttonStyle)}"
            >
              Download Python server (ZIP)
            </a>
          </div>
        </div>
      </div>
    `;
}

function render() {
    if (!appRoot) return; // Defensive check (should never happen due to initialization check)
    const root = appRoot;
    const openSelectKeys = Array.from(
        root.querySelectorAll<HTMLElement>(".custom-select-wrapper.open"),
    )
        .map((el) => el.getAttribute("data-key"))
        .filter((key): key is string => Boolean(key));
    const resolutionFill = ((state.resolution - 1) / (3 - 1)) * 100;

    const modeTransform =
        state.mode === "Explore"
            ? "translateX(0%)"
            : state.mode === "Compare"
              ? "translateX(-33.333%)"
              : "translateX(-66.666%)";
    const modeIndicatorTransform =
        state.mode === "Explore"
            ? "translateX(0%)"
            : state.mode === "Compare"
              ? "translateX(100%)"
              : "translateX(200%)";
    const tabTransform =
        state.panelTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";
    const hasProbabilityMasks =
        state.mode === "Ensemble" &&
        getModeMasks(state).some((mask) => mask.kind === "probability");

    root.innerHTML = `
    <div style="${styleAttr(styles.page)}">
      <div style="${styleAttr(styles.bgLayer1)}"></div>
      <div style="${styleAttr(styles.bgLayer2)}"></div>
      <div style="${styleAttr(styles.bgOverlay)}"></div>
      ${renderBranding()}
        ${
            state.canvasView === "map" &&
            state.dataMin !== null &&
            state.dataMax !== null
                ? renderLegendWithCollapse(
                      renderMapLegend(
                          hasProbabilityMasks
                              ? "probability"
                              : state.mode === "Ensemble"
                                ? state.ensembleVariable
                                : state.variable,
                          hasProbabilityMasks ? 0 : (state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin),
                          hasProbabilityMasks ? 100 : (state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax),
                          state.metaData,
                          hasProbabilityMasks
                              ? undefined
                              : state.mode === "Ensemble"
                                ? state.ensembleUnit
                                : state.selectedUnit,
                          state.mode === "Compare" ||
                              (state.mode === "Ensemble" &&
                                  isDifferenceEnsembleStatistic(
                                      state.ensembleStatistic,
                                  )),
                          state.mapRangeOpen ? 70 : 0,
                          hasProbabilityMasks
                              ? {
                                    titleOverride: "Joint Probability",
                                    unitOverride: "%",
                                    skipConversion: true,
                                    inWrapper: true,
                                    paletteControlHtml: renderLegendPaletteSelect(),
                                    pinBtnHtml: renderLegendPinBtn("1"),
                                    pinTooltipHtml: renderLegendPinTooltip("1"),
                                    bottomControlsHtml: renderLegendUnitControl(),
                                }
                              : {
                                    inWrapper: true,
                                    paletteControlHtml: renderLegendPaletteSelect(),
                                    pinBtnHtml: renderLegendPinBtn("1"),
                                    pinTooltipHtml: renderLegendPinTooltip("1"),
                                    bottomControlsHtml: renderLegendUnitControl(),
                                },
                      ),
                      state.legendCollapsed,
                      "1",
                      "0.5rem",
                      state.mapRangeOpen ? 70 : 0,
                  )
                : ""
        }
        ${
            state.splitView &&
            state.canvasView === "map" &&
            state.window2.dataMin != null &&
            state.window2.dataMax != null
                ? (() => {
                      const w2 = state.window2;
                      const w2HasProbabilityMasks =
                          w2.mode === "Ensemble" &&
                          getModeMasks(w2).some((mask) => mask.kind === "probability");
                      const w2Variable = w2HasProbabilityMasks
                          ? "probability"
                          : w2.mode === "Ensemble"
                            ? w2.ensembleVariable
                            : w2.variable;
                      const w2Min = w2HasProbabilityMasks ? 0 : (w2.legendPinned && w2.legendPinnedMin !== null ? w2.legendPinnedMin : w2.dataMin!);
                      const w2Max = w2HasProbabilityMasks ? 100 : (w2.legendPinned && w2.legendPinnedMax !== null ? w2.legendPinnedMax : w2.dataMax!);
                      const w2Unit = w2HasProbabilityMasks
                          ? undefined
                          : w2.mode === "Ensemble"
                            ? w2.ensembleUnit
                            : w2.selectedUnit;
                      const w2Left = `calc(${(state.splitRatio * 100).toFixed(2)}vw + 0.5rem)`;
                      return renderLegendWithCollapse(
                          renderMapLegend(
                              w2Variable,
                              w2Min,
                              w2Max,
                              state.metaData,
                              w2Unit,
                              w2HasProbabilityMasks ? false : (
                                  w2.mode === "Compare" ||
                                  (w2.mode === "Ensemble" &&
                                      isDifferenceEnsembleStatistic(w2.ensembleStatistic))
                              ),
                              0,
                              w2HasProbabilityMasks
                                  ? {
                                        titleOverride: "Joint Probability",
                                        unitOverride: "%",
                                        skipConversion: true,
                                        inWrapper: true,
                                        canvasId: "legend-gradient-canvas-w2",
                                        paletteControlHtml: renderLegendW2PaletteSelect(),
                                        pinBtnHtml: renderLegendPinBtn("2"),
                                        pinTooltipHtml: renderLegendPinTooltip("2"),
                                        bottomControlsHtml: renderLegendW2UnitControl(),
                                    }
                                  : {
                                        inWrapper: true,
                                        canvasId: "legend-gradient-canvas-w2",
                                        paletteControlHtml: renderLegendW2PaletteSelect(),
                                        pinBtnHtml: renderLegendPinBtn("2"),
                                        pinTooltipHtml: renderLegendPinTooltip("2"),
                                        bottomControlsHtml: renderLegendW2UnitControl(),
                                    },
                          ),
                          w2.legendCollapsed,
                          "2",
                          w2Left,
                      );
                  })()
                : ""
        }
      <div style="${styleAttr(state.splitView && state.canvasView === 'map'
        ? { ...styles.mapArea, flexDirection: 'row', alignItems: 'stretch', gap: 0, padding: 0 }
        : styles.mapArea)}">
        ${
            state.canvasView === "map"
                ? state.splitView
                    ? (() => {
                        // Each pane is flex:1 wide × full viewport height.
                        // To preserve the same map projection as the single view, make
                        // each canvas exactly window.innerWidth × window.innerHeight px,
                        // centered inside its pane. The pane clips (overflow:hidden) the
                        // horizontal overflow, revealing the center of each map at full height.
                        const vpW = window.innerWidth;
                        const vpH = window.innerHeight;
                        const canvasStyle = `position:absolute;top:0;left:50%;transform:translateX(-50%);width:${vpW}px;height:${vpH}px;pointer-events:auto;`;
                        const w1TabTransform = state.panelTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";
                        const paneInner = `
              <div style="position:absolute;inset:0;">
                <canvas
                  id="map-canvas"
                  style="${canvasStyle}"
                ></canvas>
                ${renderMapSearchBar(1)}
                ${renderDrawOverlay()}
                ${renderPointOverlay()}
                ${renderMapMarkerOverlay()}
                ${renderMapInfoWindow()}
                ${renderLoadingIndicator()}
                ${
                    state.dataError
                        ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);z-index:10;">
                        <div style="text-align:center;max-width:400px;padding:20px;">
                          <div style="${styleAttr(styles.mapTitle)}">Error loading data</div>
                          <div style="${styleAttr(styles.mapSubtitle)}">${state.dataError}</div>
                        </div>
                      </div>`
                        : ""
                }
                ${
                    !state.isLoading && !state.dataError && !state.currentData && state.apiAvailable === true
                        ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);z-index:5;pointer-events:none;">
                        <div style="text-align:center;">
                          <div style="${styleAttr(styles.mapTitle)}">No data loaded</div>
                          <div style="${styleAttr(styles.mapSubtitle)}">Adjust parameters to load climate data</div>
                        </div>
                      </div>`
                        : ""
                }
                ${renderMapRangeOverlay(true)}
              </div>
              <aside data-role="sidebar" data-window="1" class="sidebar sidebar-in-pane" style="position:absolute;right:0;top:0;bottom:0;width:${SIDEBAR_WIDTH}px;transform:${state.sidebarOpen ? "translateX(0)" : `translateX(${SIDEBAR_WIDTH + 24}px)`};pointer-events:${state.sidebarOpen ? "auto" : "none"};" aria-hidden="${!state.sidebarOpen}">
                <div class="sidebar-top">
                  <div class="sidebar-brand"><div class="logo-dot"></div></div>
                  <div class="tab-switch" style="${styleAttr(styles.tabSwitch)}">
                    ${(["Manual", "Chat"] as const).map((v) => renderTabButton(v, state.panelTab === v ? styles.tabBtnActive : undefined, "panel-tab")).join("")}
                  </div>
                </div>
                <div class="sidebar-content">
                  <div class="tab-viewport">
                    <div data-role="tab-track" class="tab-track" style="transform:${w1TabTransform}">
                      <div class="tab-pane">${state.canvasView === "map" ? renderManualSection({ modeTransform, resolutionFill, modeIndicatorTransform }) : renderChartSection()}</div>
                      <div class="tab-pane">${renderChatSectionWrapper()}</div>
                    </div>
                  </div>
                </div>
                <div class="sidebar-footer">
                  <div class="sidebar-footer-item"><button type="button" class="sidebar-footer-btn" data-action="open-save-state" data-window="1" title="Save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save</button>${renderConfigDropup(state, "save", "1")}</div>
                  <div class="sidebar-footer-item"><button type="button" class="sidebar-footer-btn" data-action="open-load-state" data-window="1" title="Load"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Load</button>${renderConfigDropup(state, "load", "1")}</div>
                  <button type="button" class="sidebar-footer-btn" data-action="open-export" title="Export"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export</button>
                </div>
              </aside>
              ${renderSidebarToggle(state.sidebarOpen, "1")}
            `;
                        return `
              <div id="split-pane-1" style="flex: 0 0 ${(state.splitRatio * 100).toFixed(2)}%;position:relative;overflow:hidden;">${paneInner}</div>
              <div id="split-divider" style="width:6px;position:relative;z-index:20;cursor:col-resize;flex-shrink:0;display:flex;align-items:stretch;justify-content:center;pointer-events:auto;">
                <div style="width:2px;background:rgba(148,163,184,0.2);transition:background 0.15s;"></div>
              </div>
              ${renderWindow2Pane(vpW, vpH)}
            `;
                    })()
                    : `
              <canvas
                id="map-canvas"
                style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: auto;"
              ></canvas>
              ${renderMapSearchBar()}
              ${renderDrawOverlay()}
              ${renderPointOverlay()}
              ${renderMapMarkerOverlay()}
              ${renderMapInfoWindow()}
              ${renderLoadingIndicator()}
              ${
                  state.dataError
                      ? state.apiAvailable === false
                          ? ""
                          : `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10;">
                      <div style="text-align: center; max-width: 640px; padding: 24px;">
                        <div style="${styleAttr(
                            styles.mapTitle,
                        )}">Error loading data</div>
                        <div style="${styleAttr(styles.mapSubtitle)}">${
                            state.dataError
                        }</div>
                      </div>
                    </div>`
                      : ""
              }
              ${
                  !state.isLoading && !state.dataError && !state.currentData && state.apiAvailable === true
                      ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); z-index: 5; pointer-events:none;">
                      <div style="text-align: center;">
                        <div style="${styleAttr(
                            styles.mapTitle,
                        )}">No data loaded</div>
                        <div style="${styleAttr(styles.mapSubtitle)}">
                          Adjust parameters to load climate data
                        </div>
                      </div>
                    </div>`
                      : ""
              }
            `
                : `<div data-role="chart-container" style="pointer-events:auto; width:100%; display:flex; align-items:center; justify-content:center; padding:24px;"></div>`
        }
      </div>

      ${!state.splitView ? renderMapRangeOverlay() : ""}

      ${!state.splitView && state.apiAvailable !== false ? `
      <aside data-role="sidebar" class="sidebar" style="width: ${SIDEBAR_WIDTH}px; transform: ${
          state.sidebarOpen
              ? "translateX(0)"
              : `translateX(${SIDEBAR_WIDTH + 24}px)`
      }; pointer-events: ${
          state.sidebarOpen ? "auto" : "none"
      }" aria-hidden="${!state.sidebarOpen}">
        <div class="sidebar-top">
          <div class="sidebar-brand">
            <div class="logo-dot"></div>
          </div>
          <div class="tab-switch" style="${styleAttr(styles.tabSwitch)}">
            ${(["Manual", "Chat"] as const)
                .map((value) =>
                    renderTabButton(
                        value,
                        state.panelTab === value
                            ? styles.tabBtnActive
                            : undefined,
                        "panel-tab",
                    ),
                )
                .join("")}
          </div>
        </div>

        <div class="sidebar-content">
          <div class="tab-viewport">
            <div data-role="tab-track" class="tab-track" style="transform: ${tabTransform}">
              <div class="tab-pane">
                ${
                    state.canvasView === "map"
                        ? renderManualSection({
                              modeTransform,
                              resolutionFill,
                              modeIndicatorTransform,
                          })
                        : renderChartSection()
                }
              </div>
              <div class="tab-pane">
                ${renderChatSectionWrapper()}
              </div>
            </div>
          </div>
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-footer-item">
            <button type="button" class="sidebar-footer-btn" data-action="open-save-state" data-window="1" title="Save current settings locally or export as a JSON file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Save
            </button>
            ${renderConfigDropup(state, "save", "1")}
          </div>
          <div class="sidebar-footer-item">
            <button type="button" class="sidebar-footer-btn" data-action="open-load-state" data-window="1" title="Load settings from saved configs or import a JSON file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Load
            </button>
            ${renderConfigDropup(state, "load", "1")}
          </div>
          <button type="button" class="sidebar-footer-btn" data-action="open-export" title="Export — Screenshot, Animation, Report, Data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
        </div>
      </aside>

      ${renderCompareInfo(state)}

      ${renderSidebarToggle(state.sidebarOpen)}
      ` : ""}

      ${
          !state.splitView &&
          state.canvasView === "map" &&
          !state.mapRangeOpen &&
          state.apiAvailable !== false
              ? renderTimeSlider({
                    date:
                        state.mode == "Ensemble"
                            ? state.ensembleDate
                            : state.date,
                    timeRange: state.timeRange,
                    sidebarOpen: state.sidebarOpen,
                    sidebarWidth: SIDEBAR_WIDTH,
                    mode: state.mode,
                    compareMode: state.compareMode,
                    compareDateStart: state.compareDateStart,
                    compareDateEnd: state.compareDateEnd,
                })
              : ""
      }

      ${renderTutorialOverlay(getTutorialState())}
      ${renderApiOfflineModal(state)}
      ${renderConfigDescriptionEditor(state)}
      ${renderConfigNotes(state)}
    </div>
  `;

    attachEventHandlers({ resolutionFill });

    const tutorialBox = root.querySelector<HTMLElement>(".tutorial-box");
    if (tutorialBox) {
        const rect = tutorialBox.getBoundingClientRect();
        const padding = 16;
        let deltaX = 0;
        let deltaY = 0;

        if (rect.right > window.innerWidth - padding) {
            deltaX = window.innerWidth - padding - rect.right;
        } else if (rect.left < padding) {
            deltaX = padding - rect.left;
        }

        if (rect.bottom > window.innerHeight - padding) {
            deltaY = window.innerHeight - padding - rect.bottom;
        } else if (rect.top < padding) {
            deltaY = padding - rect.top;
        }

        if (deltaX !== 0 || deltaY !== 0) {
            const existingTransform = tutorialBox.style.transform || "";
            tutorialBox.style.transform = `${existingTransform} translate(${deltaX}px, ${deltaY}px)`;
        }
    }

    openSelectKeys.forEach((key) => {
        const wrapper = root.querySelector<HTMLElement>(
            `.custom-select-wrapper[data-key="${key}"]`,
        );
        if (wrapper) {
            wrapper.classList.add("open");
        }
    });

    mapCanvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");

    if (mapCanvas) {
        setMapOverlayVisibility({
            showBorders: state.mapShowBorders,
            showLabels: state.mapShowCities,
        });
        if (
            state.currentData &&
            !state.dataError &&
            state.dataMin !== null &&
            state.dataMax !== null
        ) {
            try {
                applyMapInteractions(mapCanvas);
                renderMapData(
                    state.currentData,
                    mapCanvas,
                    paletteOptions,
                    state.mapPalette,
                    state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
                    state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
                    state.mode === "Ensemble"
                        ? state.ensembleVariable
                        : state.variable,
                    state.mode === "Ensemble"
                        ? state.ensembleUnit
                        : state.selectedUnit,
                    getModeMasks(state),
                    state.mode === "Ensemble" ? state.ensembleStatistics : null,
                    state.mode === "Ensemble",
                    state.mode === "Explore"
                        ? state.maskVariableData
                        : undefined,
                    state.mode === "Ensemble"
                        ? state.ensembleStatisticsByVariable
                        : null,
                    state.mode === "Ensemble"
                        ? state.ensembleRawSamplesByVariable
                        : null,
                );

                // Draw the gradient on the legend canvas
                const palette =
                    paletteOptions.find((p) => p.name === state.mapPalette) ||
                    paletteOptions[0];
                drawLegendGradient("legend-gradient-canvas", palette.colors);

                // Draw gradient on the Window 2 legend canvas
                if (state.splitView && state.window2.dataMin !== null) {
                    const w2Pal =
                        paletteOptions.find(
                            (p) => p.name === state.window2.mapPalette,
                        ) || paletteOptions[0];
                    drawLegendGradient("legend-gradient-canvas-w2", w2Pal.colors);
                }

                // Render overlay if actively drawing or if there's a completed polygon
                if (
                    state.drawState.active ||
                    (state.mapPolygon !== null && state.mapPolygon.length >= 3)
                ) {
                    requestAnimationFrame(renderDrawOverlayPaths);
                }
            } catch (mapErr) {
                console.error(
                    "Map render failed (e.g. changing display variable with masks):",
                    mapErr,
                );
            }
        }
    }

    // Persist canvas-2 across re-renders so D3 zoom is never torn down.
    if (state.splitView && state.canvasView === "map") {
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const isNew = !persistentCanvas2;
        if (!persistentCanvas2) {
            persistentCanvas2 = document.createElement("canvas");
            persistentCanvas2.id = "map-canvas-2";
        }
        persistentCanvas2.style.cssText =
            `position:absolute;top:0;left:50%;transform:translateX(-50%);` +
            `width:${vpW}px;height:${vpH}px;cursor:grab;pointer-events:auto;`;
        // Swap the innerHTML-generated placeholder with our persistent element.
        const placeholder = root.querySelector<HTMLCanvasElement>("#map-canvas-2");
        if (placeholder && placeholder !== persistentCanvas2) {
            placeholder.parentElement?.replaceChild(persistentCanvas2, placeholder);
        }
        // Wire D3 zoom only once (keeps same listener across re-renders).
        if (isNew) {
            setupWindow2Interactions(persistentCanvas2, state.window2.selectedUnit ?? "", {
                onMapClick: (coords) => void handleMapClickW2(coords),
                onTransform: renderMapMarkerPositionW2,
            });
        }
        // Redraw from cache if data is already loaded (e.g. sidebar toggle).
        if (isW2CacheReady()) {
            resizeWindow2Canvas(persistentCanvas2);
        }
    }

    // Attach drag-resize to split-view divider (re-attaches each render, old element is gone).
    setupSplitDivider();
    // Apply responsive padding to charts after DOM is ready
    const currentPadding = (state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24) + 8;
    const scale = state.sidebarOpen ? 1 : 0.9;
    applyChartLayoutOffset(currentPadding, scale);
    updateMapSearchPosition();

    // Update chart view if active
    if (state.canvasView === "chart") {
        updateChartContainerDOM();
    }

    // Re-attach hover listeners for map info boxplots whenever the panel is visible
    if (state.mapInfoOpen && state.mapInfoBoxes?.length) {
        setTimeout(() => { attachMapInfoBoxplotHoverListeners(); }, 0);
    }
    if (state.window2.mapInfoOpen && state.window2.mapInfoBoxes?.length) {
        setTimeout(() => { attachMapInfoBoxplotHoverListeners("map-info-panel-w2"); }, 0);
    }
}

function renderLoadingIndicator() {
    if (!state.isLoading) return "";
    const progress = Math.max(
        0,
        Math.min(100, Math.round(state.loadingProgress)),
    );
    return `
      <div style="${styleAttr(styles.loadingIndicator)}">
        <div style="${styleAttr(styles.loadingSpinner)}"></div>
        <div style="${styleAttr(styles.loadingTextGroup)}">
          <div style="${styleAttr(
              styles.loadingText,
          )}">Loading data · ${progress}%</div>
          <div style="${styleAttr(styles.loadingBar)}">
            <div style="${styleAttr({
                ...styles.loadingBarFill,
                width: `${progress}%`,
            })}"></div>
          </div>
          <div style="${styleAttr(
              styles.loadingSubtext,
          )}">Fetching climate tiles</div>
        </div>
      </div>
    `;
}

function renderChartLoadingIndicator() {
    return `
      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;">
      </div>
    `;
}

function formatNumberCompact(value: number): string {
    if (!Number.isFinite(value)) return "-";
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toFixed(0);
    if (abs >= 100) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(2);
    return value.toPrecision(2);
}

function renderChartSvg(
    boxes: ChartBox[],
    options?: { lightToDarkNoDarkest?: boolean },
): string {
    if (!boxes.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const sortedBoxes = [...boxes].sort((a, b) => {
        return scenarios.indexOf(a.scenario) - scenarios.indexOf(b.scenario);
    });

    const palette =
        paletteOptions.find((p) => p.name === state.chartPalette) ||
        paletteOptions[0];
    const overlayColors =
        options?.lightToDarkNoDarkest && palette.colors.length > 2
            ? palette.colors.slice(1).reverse()
            : options?.lightToDarkNoDarkest
              ? [...palette.colors].reverse()
              : palette.colors;
    const colors = overlayColors.length ? overlayColors : palette.colors;

    const width = 900;
    const height = 440;
    const margin = { top: 26, right: 36, bottom: 70, left: 86 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const allExtrema = sortedBoxes.flatMap((b) => [b.stats.min, b.stats.max]);
    const minVal = Math.min(...allExtrema);
    const maxVal = Math.max(...allExtrema);
    const pad = Math.max(Math.abs(maxVal - minVal) * 0.12, 1e-6);

    const yScale = d3
        .scaleLinear()
        .domain([minVal - pad, maxVal + pad])
        .range([plotHeight, 0]);
    const yTicks = yScale.ticks(6);

    const xStep = plotWidth / (sortedBoxes.length + 1);

    const axisTicks = yTicks
        .map((tick) => {
            const y = yScale(tick) + margin.top;
            return `
        <g>
          <line x1="${margin.left}" x2="${
              width - margin.right
          }" y1="${y}" y2="${y}" stroke="var(--border-medium)" />
          <text x="${margin.left - 10}" y="${
              y + 4
          }" fill="var(--text-secondary)" font-size="11" text-anchor="end">
            ${formatNumberCompact(tick)}
          </text>
        </g>
      `;
        })
        .join("");

    const boxesMarkup = sortedBoxes
        .map((box, idx) => {
            const x = margin.left + xStep * (idx + 1);
            const colorIdx =
                sortedBoxes.length === 1
                    ? Math.floor(colors.length / 2)
                    : idx % colors.length;
            const color = colors[colorIdx];
            const { min, q1, median, q3, max, mean } = box.stats;
            const boxTop = yScale(q3) + margin.top;
            const boxBottom = yScale(q1) + margin.top;
            const rectHeight = Math.max(2, boxBottom - boxTop);
            const whiskerTop = yScale(min) + margin.top;
            const whiskerBottom = yScale(max) + margin.top;
            return `
        <g data-boxplot-idx="${idx}" class="boxplot-group">
          <line x1="${x}" x2="${x}" y1="${whiskerTop}" y2="${whiskerBottom}" stroke="${color}" stroke-width="2" stroke-linecap="round" />
          <rect x="${
              x - 24
          }" y="${boxTop}" width="48" height="${rectHeight}" fill="var(--border-subtle)" stroke="${color}" stroke-width="2" rx="6" />
          <line x1="${x - 24}" x2="${x + 24}" y1="${
              yScale(median) + margin.top
          }" y2="${
              yScale(median) + margin.top
          }" stroke="${color}" stroke-width="2.4" />
          <circle cx="${x}" cy="${
              yScale(mean) + margin.top
          }" r="4" fill="${color}" stroke="rgba(0,0,0,0.55)" stroke-width="1" />
          <text x="${x}" y="${
              height - margin.bottom + 32
          }" fill="var(--text-primary)" font-weight="700" font-size="12" text-anchor="middle">${
              box.scenario
          }</text>
          <text x="${x}" y="${
              height - margin.bottom + 48
          }" fill="var(--text-secondary)" font-size="11" text-anchor="middle">${
              box.samples.length
          } model${box.samples.length === 1 ? "" : "s"}</text>
          <rect x="${
              x - 35
          }" y="${margin.top}" width="70" height="${plotHeight}" fill="transparent" class="boxplot-hover-area" style="cursor: pointer; pointer-events: all;" />
        </g>
      `;
        })
        .join("");

    // Create hover overlay group for model value indicators
    const hoverOverlayMarkup = sortedBoxes
        .map((box, idx) => {
            const x = margin.left + xStep * (idx + 1);
            const boxplotRight = x + 30; // Right edge of boxplot
            const lineStartX = boxplotRight;
            const lineEndX = boxplotRight + 6; // Horizontal line to show position
            const labelStartX = lineEndX + 6; // Start of label text

            const modelIndicators = box.samples
                .map((sample) => {
                    const y = yScale(sample.value) + margin.top;
                    return {
                        model: sample.model,
                        value: sample.value,
                        y,
                    };
                })
                .sort((a, b) => a.y - b.y); // Sort by y position

            // Adjust label positions to avoid overlaps
            const minLabelSpacing = 12; // Minimum vertical spacing between labels
            const adjustedIndicators: Array<{
                model: string;
                value: number;
                y: number;
                adjustedY: number;
            }> = [];
            modelIndicators.forEach((indicator, i) => {
                if (i === 0) {
                    adjustedIndicators.push({
                        ...indicator,
                        adjustedY: indicator.y,
                    });
                } else {
                    const prevY = adjustedIndicators[i - 1].adjustedY;
                    const minY = prevY + minLabelSpacing;
                    adjustedIndicators.push({
                        ...indicator,
                        adjustedY: Math.max(indicator.y, minY),
                    });
                }
            });

            const indicatorsHtml = adjustedIndicators
                .map((indicator) => {
                    const labelY = indicator.adjustedY || indicator.y;
                    return `
                    <g class="model-indicator" data-boxplot-idx="${idx}">
                      <line x1="${lineStartX}" x2="${lineEndX}" y1="${indicator.y}" y2="${indicator.y}" stroke="var(--text-primary)" stroke-width="1" stroke-linecap="round" />
                      <text x="${labelStartX}" y="${labelY + 4}" fill="var(--text-primary)" font-size="10" font-weight="300" opacity="0.95">${indicator.model}</text>
                    </g>
                  `;
                })
                .join("");

            return indicatorsHtml;
        })
        .join("");

    const axisLine = `
      <line
        x1="${margin.left}"
        x2="${margin.left}"
        y1="${margin.top}"
        y2="${height - margin.bottom}"
        stroke="var(--text-secondary)"
        stroke-width="1.2"
      />
    `;

    const yLabel = `
      <text
        x="${margin.left - 70}"
        y="${margin.top + plotHeight / 2}"
        fill="var(--text-secondary)"
        font-size="12"
        text-anchor="middle"
        transform="rotate(-90 ${margin.left - 70} ${
            margin.top + plotHeight / 2
        })"
      >
        ${state.chartUnit}
      </text>
    `;

    return `
      <div style="position:relative; width:100%;">
        <div style="position:absolute; top:10px; right:12px; z-index:2;">
          ${renderOverlayPaletteSelect("chartPalette", state.chartPalette)}
        </div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Global box plots" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto;">
          ${axisLine}
          ${axisTicks}
          ${boxesMarkup}
          <g class="boxplot-hover-overlay" style="opacity: 0; pointer-events: none;">
            ${hoverOverlayMarkup}
          </g>
          ${yLabel}
        </svg>
      </div>
    `;
}

function renderMiniChartSvg(
    boxes: ChartBox[],
    unitLabel: string,
    paletteName: string,
    yDomain?: [number, number],
): string {
    if (!boxes.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const sortedBoxes = [...boxes].sort((a, b) => {
        return scenarios.indexOf(a.scenario) - scenarios.indexOf(b.scenario);
    });

    const palette =
        paletteOptions.find((p) => p.name === paletteName) || paletteOptions[0];
    const overlayColors =
        palette.colors.length > 2
            ? palette.colors.slice(1).reverse()
            : [...palette.colors].reverse();
    const colors = overlayColors.length ? overlayColors : palette.colors;

    const width = 560;
    const height = 300;
    const margin = { top: 18, right: 16, bottom: 52, left: 48 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const allExtrema = sortedBoxes.flatMap((b) => [b.stats.min, b.stats.max]);
    const minVal = yDomain ? yDomain[0] : Math.min(...allExtrema);
    const maxVal = yDomain ? yDomain[1] : Math.max(...allExtrema);
    const pad = yDomain ? 0 : Math.max(Math.abs(maxVal - minVal) * 0.12, 1e-6);

    const yScale = d3
        .scaleLinear()
        .domain([minVal - pad, maxVal + pad])
        .range([plotHeight, 0]);
    const yTicks = yScale.ticks(4);

    const xStep = plotWidth / (sortedBoxes.length + 1);

    const axisTicks = yTicks
        .map((tick) => {
            const y = yScale(tick) + margin.top;
            return `
        <g>
          <line x1="${margin.left}" x2="${
              width - margin.right
          }" y1="${y}" y2="${y}" stroke="var(--border-subtle)" />
          <text x="${margin.left - 8}" y="${
              y + 3
          }" fill="var(--text-secondary)" font-size="9" text-anchor="end">
            ${formatNumberCompact(tick)}
          </text>
        </g>
      `;
        })
        .join("");

    const boxesMarkup = sortedBoxes
        .map((box, idx) => {
            const x = margin.left + xStep * (idx + 1);
            const colorIdx =
                sortedBoxes.length === 1
                    ? Math.floor(colors.length / 2)
                    : idx % colors.length;
            const color = colors[colorIdx];
            const { min, q1, median, q3, max, mean } = box.stats;
            const boxTop = yScale(q3) + margin.top;
            const boxBottom = yScale(q1) + margin.top;
            const rectHeight = Math.max(2, boxBottom - boxTop);
            return `
        <g data-boxplot-idx="${idx}" class="boxplot-group">
          <line x1="${x}" x2="${x}" y1="${yScale(min) + margin.top}" y2="${
              yScale(max) + margin.top
          }" stroke="${color}" stroke-width="1.6" stroke-linecap="round" />
          <rect x="${
              x - 16
          }" y="${boxTop}" width="32" height="${rectHeight}" fill="var(--border-subtle)" stroke="${color}" stroke-width="1.6" rx="5" />
          <line x1="${x - 16}" x2="${x + 16}" y1="${
              yScale(median) + margin.top
          }" y2="${
              yScale(median) + margin.top
          }" stroke="${color}" stroke-width="2" />
          <circle cx="${x}" cy="${
              yScale(mean) + margin.top
          }" r="3.2" fill="${color}" stroke="rgba(0,0,0,0.55)" stroke-width="0.8" />
          <text x="${x}" y="${
              height - margin.bottom + 26
          }" fill="var(--text-primary)" font-weight="700" font-size="10" text-anchor="middle">${
              box.scenario
          }</text>
          <text x="${x}" y="${
              height - margin.bottom + 40
          }" fill="var(--text-secondary)" font-size="9" text-anchor="middle">${
              box.samples.length
          } model${box.samples.length === 1 ? "" : "s"}</text>
          <rect x="${x - 28}" y="${margin.top}" width="56" height="${plotHeight}" fill="transparent" class="boxplot-hover-area" style="cursor: default; pointer-events: all;" />
        </g>
      `;
        })
        .join("");

    // Hover overlay: one model-indicator per sample, shown on hover
    const hoverOverlayMarkup = sortedBoxes
        .map((box, idx) => {
            const x = margin.left + xStep * (idx + 1);
            const lineStartX = x + 20;
            const lineEndX = lineStartX + 5;
            const labelStartX = lineEndX + 4;

            const modelIndicators = box.samples
                .map((sample) => ({
                    model: sample.model,
                    value: sample.value,
                    y: yScale(sample.value) + margin.top,
                }))
                .sort((a, b) => a.y - b.y);

            const minSpacing = 11;
            const adjusted: Array<{ model: string; value: number; y: number; adjustedY: number }> = [];
            modelIndicators.forEach((ind, i) => {
                if (i === 0) {
                    adjusted.push({ ...ind, adjustedY: ind.y });
                } else {
                    const prevY = adjusted[i - 1].adjustedY;
                    adjusted.push({ ...ind, adjustedY: Math.max(ind.y, prevY + minSpacing) });
                }
            });

            return adjusted.map((ind) => `
                <g class="model-indicator" data-boxplot-idx="${idx}">
                  <line x1="${lineStartX}" x2="${lineEndX}" y1="${ind.y}" y2="${ind.y}" stroke="var(--text-secondary)" stroke-width="1" stroke-linecap="round" />
                  <text x="${labelStartX}" y="${ind.adjustedY + 4}" fill="var(--text-primary)" font-size="9" font-weight="300">${escapeHtml(ind.model)}</text>
                </g>
            `).join("");
        })
        .join("");

    const axisLine = `
      <line
        x1="${margin.left}"
        x2="${margin.left}"
        y1="${margin.top}"
        y2="${height - margin.bottom}"
        stroke="var(--text-secondary)"
        stroke-width="1"
      />
    `;

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mini box plots" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; overflow: visible;">
        ${axisLine}
        ${axisTicks}
        ${boxesMarkup}
        <g class="boxplot-hover-overlay" style="opacity: 0; pointer-events: none;">
          ${hoverOverlayMarkup}
        </g>
        <text x="${margin.left}" y="${margin.top - 6}" fill="var(--text-secondary)" font-size="9">${escapeHtml(
            unitLabel,
        )}</text>
      </svg>
    `;
}

function getRangeOverlayWidth(): number {
    const el = document.getElementById('map-range-overlay');
    if (el) {
        const w = el.getBoundingClientRect().width;
        if (w > 0) return Math.round(w);
    }
    const rightOffset = state.sidebarOpen ? SIDEBAR_WIDTH : 0;
    return Math.round(window.innerWidth - rightOffset);
}

function renderChartRangeSvg(
    series: ChartSeries[],
    options?: {
        compact?: boolean;
        unitLabel?: string;
        paletteName?: string;
        lightToDarkNoDarkest?: boolean;
        containerWidth?: number;
        hiddenScenarios?: string[];
        currentDate?: string;
    },
): string {
    if (!series.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const paletteName = options?.paletteName ?? state.chartPalette;
    const palette =
        paletteOptions.find((p) => p.name === paletteName) || paletteOptions[0];
    const overlayColors =
        options?.lightToDarkNoDarkest && palette.colors.length > 2
            ? palette.colors.slice(1).reverse()
            : options?.lightToDarkNoDarkest
              ? [...palette.colors].reverse()
              : palette.colors;
    const colors = overlayColors.length ? overlayColors : palette.colors;

    const compact = options?.compact ?? false;
    const unitLabel = options?.unitLabel ?? state.chartUnit;

    const width = (compact && options?.containerWidth) ? options.containerWidth : 960;
    const height = compact ? 220 : 460;
    const margin = compact
        ? { top: 24, right: 26, bottom: 40, left: 70 }
        : { top: 28, right: 32, bottom: 82, left: 86 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const tickFont = compact ? 10 : 11;
    const legendFont = compact ? 10.5 : 11.5;
    const yLabelOffset = compact ? 54 : 70;

    const allPoints = series.flatMap((s) => s.points);
    const allDates = allPoints.map((p) => parseDate(p.date));
    const minDate = d3.min(allDates);
    const maxDate = d3.max(allDates);

    if (!minDate || !maxDate) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const padDayMs = 24 * 60 * 60 * 1000;
    const domainStart = new Date(minDate.getTime() - padDayMs * 0.25);
    const domainEnd = new Date(maxDate.getTime() + padDayMs * 0.25);

    const xScale = d3
        .scaleTime()
        .domain([domainStart, domainEnd])
        .range([0, plotWidth]);
    const xTicks = xScale.ticks(compact ? 5 : 6);
    const formatTick = d3.timeFormat("%b %Y");

    const allExtrema = allPoints.flatMap((p) => [p.stats.min, p.stats.max]);
    const minVal = Math.min(...allExtrema);
    const maxVal = Math.max(...allExtrema);
    const pad = Math.max(Math.abs(maxVal - minVal) * 0.12, 1e-6);

    const yScale = d3
        .scaleLinear()
        .domain([minVal - pad, maxVal + pad])
        .range([plotHeight, 0]);
    const yTicks = yScale.ticks(6);

    const axisTicksY = yTicks
        .map((tick) => {
            const y = yScale(tick) + margin.top;
            return `
        <g>
          <line x1="${margin.left}" x2="${
              width - margin.right
          }" y1="${y}" y2="${y}" stroke="var(--border-medium)" />
          <text x="${margin.left - 10}" y="${
              y + 4
          }" fill="var(--text-secondary)" font-size="${tickFont}" text-anchor="end">
            ${formatNumberCompact(tick)}
          </text>
        </g>
      `;
        })
        .join("");

    const axisTicksX = xTicks
        .map((tick) => {
            const x = xScale(tick) + margin.left;
            return `
        <g>
          <line x1="${x}" x2="${x}" y1="${margin.top}" y2="${
              height - margin.bottom
          }" stroke="var(--border-subtle)" />
          <text x="${x}" y="${height - margin.bottom + 26}" fill="var(--text-secondary)" font-size="${tickFont}" text-anchor="middle">
            ${formatTick(tick)}
          </text>
        </g>
      `;
        })
        .join("");

    const steps = Math.max(variables.length, 4);

    const seriesMarkup = series
        .map((entry, idx) => {
            if (!entry.points.length) return "";
            const color = colors[idx % colors.length];
            if (options?.hiddenScenarios?.includes(entry.scenario)) return "";

            // Precompute evenly spaced levels between min and max for each point
            const pointLevels = entry.points.map((p) => {
                const levels = Array.from({ length: steps + 1 }, (_, i) => {
                    const t = i / steps;
                    return p.stats.min + (p.stats.max - p.stats.min) * t;
                });
                return { point: p, levels };
            });

            const buildSteppedBand = (bandIdx: number) => {
                const upperPath = pointLevels
                    .map(({ point, levels }) => {
                        const x = xScale(parseDate(point.date)) + margin.left;
                        const y = yScale(levels[bandIdx + 1]) + margin.top;
                        return `${x},${y}`;
                    })
                    .join(" L ");
                const lowerPath = [...pointLevels]
                    .reverse()
                    .map(({ point, levels }) => {
                        const x = xScale(parseDate(point.date)) + margin.left;
                        const y = yScale(levels[bandIdx]) + margin.top;
                        return `${x},${y}`;
                    })
                    .join(" L ");
                return `M ${upperPath} L ${lowerPath} Z`;
            };

            const bandPaths = Array.from({ length: steps }, (_, i) => {
                const path = buildSteppedBand(i);
                const mid = steps / 2;
                const centerWeight =
                    1 - Math.min(Math.abs(i + 0.5 - mid) / mid, 1);
                const opacity = 0.55 * centerWeight + 0.08;
                return `<path d="${path}" fill="${color}" fill-opacity="${opacity.toFixed(
                    3,
                )}" stroke="none" />`;
            }).join("");

            const medianPath = entry.points
                .map((p, i) => {
                    const x = xScale(parseDate(p.date)) + margin.left;
                    const y = yScale(p.stats.median) + margin.top;
                    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                })
                .join(" ");
            const meanPath = entry.points
                .map((p, i) => {
                    const x = xScale(parseDate(p.date)) + margin.left;
                    const y = yScale(p.stats.mean) + margin.top;
                    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                })
                .join(" ");

            return `
        <g>
          ${bandPaths}
          <path d="${medianPath}" fill="none" stroke="${color}" stroke-width="2.2" />
          <path d="${meanPath}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="6 6" stroke-opacity="0.9" />
          <circle cx="${
              xScale(parseDate(entry.points[entry.points.length - 1].date)) +
              margin.left
          }" cy="${
              yScale(entry.points[entry.points.length - 1].stats.median) +
              margin.top
          }" r="4" fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="1" />
        </g>
      `;
        })
        .join("");

    const yLabel = `
      <text
        x="${margin.left - yLabelOffset}"
        y="${margin.top + plotHeight / 2}"
        fill="var(--text-secondary)"
        font-size="${compact ? 11 : 12}"
        text-anchor="middle"
        transform="rotate(-90 ${margin.left - yLabelOffset} ${margin.top + plotHeight / 2})"
      >
        ${unitLabel}
      </text>
    `;

    return `
      <div style="width:100%; display:flex; flex-direction:column; gap:12px; align-items:center;">
        <div style="position:relative; width:100%; display:flex; justify-content:center;">
          <div style="position:absolute; top:10px; right:16px; display:flex; gap:12px; align-items:center; color:var(--text-secondary); font-size:${legendFont}px; z-index:2;">
            ${
                compact
                    ? ""
                    : `<div>${renderOverlayPaletteSelect("chartPalette", state.chartPalette)}</div>`
            }
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:26px; height:0; border-top:1px solid var(--text-primary);"></span>
              <span>Median</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:26px; height:0; border-top:1px dashed var(--text-primary);"></span>
              <span>Mean</span>
            </div>
          </div>
          <svg
            ${compact ? `id="map-range-svg"
              data-margin-left="${margin.left}" data-margin-right="${margin.right}"
              data-margin-top="${margin.top}" data-margin-bottom="${margin.bottom}"
              data-domain-start="${domainStart.getTime()}" data-domain-end="${domainEnd.getTime()}"
              data-plot-width="${plotWidth}" data-plot-height="${plotHeight}"` : ""}
            viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution over time" preserveAspectRatio="xMidYMid meet" style="width:100%; height:${compact ? "220px" : "auto"}; display:block; ${compact ? "cursor:crosshair;" : ""}">
            ${axisTicksY}
            ${axisTicksX}
            <path
              d="M ${margin.left} ${margin.top} L ${margin.left} ${height - margin.bottom} L ${width - margin.right} ${height - margin.bottom}"
              fill="none"
              stroke="var(--text-secondary)"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            ${seriesMarkup}
            ${yLabel}
            ${compact ? (() => {
                const selDate = parseDate(options?.currentDate ?? state.date);
                const selTs = selDate.getTime();
                const inDomain = selTs >= domainStart.getTime() && selTs <= domainEnd.getTime();
                const sx = inDomain ? Math.round(xScale(selDate) + margin.left) : -999;
                const bgW = 74;
                const bgX = Math.max(margin.left, Math.min(sx - bgW / 2, margin.left + plotWidth - bgW));
                const displayDate = options?.currentDate ?? state.date;
                return `
            ${inDomain ? `
            <g class="mrd" pointer-events="none">
              <line x1="${sx}" x2="${sx}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="var(--text-primary)" stroke-width="1.5"/>
              <rect x="${bgX}" y="${margin.top - 20}" width="${bgW}" height="16" rx="3" fill="var(--dark-bg-strong)"/>
              <text fill="var(--text-primary)" font-size="10" text-anchor="middle" x="${bgX + bgW / 2}" y="${margin.top - 7}">${displayDate}</text>
            </g>
            ` : ""}
            <g class="mrh" opacity="0" pointer-events="none">
              <line class="mrh-line" x1="0" x2="0" y1="${margin.top}" y2="${height - margin.bottom}" stroke="var(--text-secondary)" stroke-width="1.2" stroke-dasharray="5 3"/>
              <rect class="mrh-bg" x="0" y="${margin.top - 20}" width="74" height="16" rx="3" fill="var(--dark-bg-strong)"/>
              <text class="mrh-text" fill="var(--text-primary)" font-size="10" text-anchor="middle" x="0" y="${margin.top - 7}"></text>
            </g>
            `;
            })() : ""}
          </svg>
        </div>
        ${
            compact
                ? ""
                : `<div style="${styleAttr(styles.chartLegend)}">
          ${series
              .map((entry, idx) => {
                  const color = colors[idx % colors.length];
                  return `
            <div style="display:flex; align-items:center; gap:8px; font-size:12; color:var(--text-secondary);">
              <span style="display:inline-block; width:16px; height:8px; background:${color}; border-radius:999px;"></span>
              <span style="color:var(--text-primary); font-weight:700;">${entry.scenario}</span>
            </div>
          `;
              })
              .join("")}
        </div>`
        }
      </div>
    `;
}

function renderField(label: string, controlHtml: string) {
    return `
    <div style="${styleAttr(styles.field)}">
      ${
          label
              ? `<div style="${styleAttr(styles.fieldLabel)}">${label}</div>`
              : ""
      }
      ${controlHtml}
    </div>
  `;
}

function renderInput(
    name: string,
    value: string,
    opts?: {
        type?: string;
        dataKey?: string;
        min?: string;
        max?: string;
        dataRole?: string;
        dataWindow?: "1" | "2";
    },
) {
    const type = opts?.type ?? "date";
    const dataKey = opts?.dataKey ?? name;
    const minAttr = opts?.min ? `min="${opts.min}"` : "";
    const maxAttr = opts?.max ? `max="${opts.max}"` : "";
    const dataRole = opts?.dataRole ? `data-role="${opts.dataRole}"` : "";
    const dataWindow = opts?.dataWindow ? `data-window="${opts.dataWindow}"` : "";
    return `
    <input
      type="${type}"
      value="${value}"
      data-action="update-input"
      data-key="${dataKey}"
      ${minAttr}
      ${maxAttr}
      ${dataRole}
      ${dataWindow}
    />
  `;
}

function renderSelect(
    name: string,
    options: string[],
    current: string,
    opts?: {
        disabled?: boolean;
        dataKey?: string;
        infoType?: "scenario" | "variable" | "model";
        selectedLabel?: string;
        extraContent?: string;
        dataRole?: string;
        dataWindow?: "1" | "2";
    },
) {
    const dataKey = opts?.dataKey ?? name;
    const disabled = opts?.disabled ? "disabled" : "";
    const uniqueId = `custom-select-${dataKey}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
    const infoType = opts?.infoType;
    const displayValue = escapeHtml(opts?.selectedLabel ?? current);
    const extraContent = opts?.extraContent ?? "";
    const dataRole = opts?.dataRole ? `data-role="${opts.dataRole}"` : "";
    const dataWindow = opts?.dataWindow ? `data-window="${opts.dataWindow}"` : "";

    return `
    <div class="custom-select-container">
      <div class="custom-select-info-panel" id="${uniqueId}-info" role="tooltip"></div>
      <div class="custom-select-wrapper" ${dataRole} data-key="${dataKey}" ${
          disabled ? 'data-disabled="true"' : ""
      } ${infoType ? `data-info-type="${infoType}"` : ""} ${dataWindow}>
        <div class="custom-select-trigger" data-action="update-select" data-key="${dataKey}" id="${uniqueId}-trigger" ${
            disabled ? 'aria-disabled="true"' : ""
        } tabindex="${disabled ? "-1" : "0"}" ${dataWindow}>
          <span class="custom-select-value">${displayValue}</span>
          <svg class="custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="custom-select-dropdown" id="${uniqueId}-dropdown" role="listbox">
          ${options
              .map((opt) => {
                  // Format statistic labels for better display
                  const displayLabel =
                      dataKey === "ensembleStatistic" ||
                      dataKey === "maskStatistic"
                          ? opt === "mean"
                              ? "Mean"
                              : opt === "median"
                                ? "Median"
                                : opt === "std"
                                  ? "Std"
                                  : opt === "iqr"
                                    ? "IQR"
                                    : opt === "percentile"
                                      ? "Percentile"
                                      : opt === "extremes"
                                        ? "Extremes"
                                        : opt
                          : opt;
                  return `
                <div class="custom-select-option ${
                    opt === current ? "selected" : ""
                }" 
                     data-value="${opt}" 
                     data-action="update-select" 
                     data-key="${dataKey}"
                     ${dataWindow}
                     role="option"
                     ${opt === current ? 'aria-selected="true"' : ""}
                     tabindex="0">
                  ${displayLabel}
                </div>
              `;
              })
              .join("")}
          ${extraContent}
        </div>
      </div>
    </div>
  `;
}

function renderLegendWithCollapse(
    legendHtml: string,
    collapsed: boolean,
    window: "1" | "2",
    leftStyle: string,
    offsetY = 0,
): string {
    const transformY = offsetY ? `transform: translateY(calc(-50% - ${offsetY}px));` : "transform: translateY(-50%);";
    return `
      <div class="legend-wrapper" data-window="${window}" style="left:${leftStyle}; top:50%; ${transformY}">
        <button type="button" class="legend-toggle-btn" data-action="toggle-legend" data-window="${window}" aria-label="${collapsed ? "Show legend" : "Hide legend"}" title="${collapsed ? "Show legend" : "Hide legend"}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${collapsed ? '<polyline points="9 18 15 12 9 6"/>' : '<polyline points="15 18 9 12 15 6"/>'}
          </svg>
        </button>
        <div class="legend-slide-wrapper${collapsed ? " collapsed" : ""}">
          ${legendHtml}
        </div>
      </div>
    `;
}

function renderLegendPaletteSelect() {
    const uniqueId = `legend-palette-${Math.random().toString(36).substr(2, 9)}`;
    return `
    <div class="custom-select-container">
      <div class="custom-select-wrapper legend-palette-wrapper" data-key="mapPalette" data-role="palette-selector">
        <button
          type="button"
          class="custom-select-trigger legend-palette-trigger"
          data-action="update-select"
          data-key="mapPalette"
          id="${uniqueId}-trigger"
          aria-label="Select color palette"
        >
          <span class="custom-select-value legend-palette-current">${escapeHtml(state.mapPalette)}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 4a8 8 0 1 0 0 16h1.2c1.4 0 2.3-1.5 1.6-2.7-.6-1-.2-2.3.9-2.8 1.1-.5 2.3.2 2.4 1.4.1 1.2 1.1 2.1 2.3 2.1H21a3 3 0 0 0 3-3c0-6.1-5.4-11-12-11Z" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="7.3" cy="11.2" r="1.1" fill="currentColor"/>
            <circle cx="10.1" cy="8.2" r="1.1" fill="currentColor"/>
            <circle cx="14.1" cy="8.6" r="1.1" fill="currentColor"/>
            <circle cx="16.8" cy="11.7" r="1.1" fill="currentColor"/>
          </svg>
        </button>
        <div class="custom-select-dropdown legend-palette-dropdown" id="${uniqueId}-dropdown" role="listbox">
          ${paletteOptions
              .map(
                  (palette) => `
            <div class="custom-select-option ${
                palette.name === state.mapPalette ? "selected" : ""
            }"
                 data-value="${palette.name}"
                 data-action="update-select"
                 data-key="mapPalette"
                 role="option"
                 ${palette.name === state.mapPalette ? 'aria-selected="true"' : ""}
                 tabindex="0">
              <div class="legend-palette-option-content">
                <div class="legend-palette-swatches">
                  ${palette.colors
                      .slice(0, 4)
                      .map(
                          (color) =>
                              `<span class="legend-palette-dot" style="background:${color};"></span>`,
                      )
                      .join("")}
                </div>
                <span class="legend-palette-name">${escapeHtml(palette.name)}</span>
              </div>
            </div>
          `,
              )
              .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderOverlayPaletteSelect(
    dataKey: "mapInfoPalette" | "mapRangePalette" | "chartPalette",
    currentPalette: string,
) {
    const uniqueId = `overlay-palette-${dataKey}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
    return `
    <div class="custom-select-container">
      <div class="custom-select-wrapper overlay-palette-wrapper" data-key="${dataKey}">
        <button
          type="button"
          class="custom-select-trigger overlay-palette-trigger"
          data-action="update-select"
          data-key="${dataKey}"
          id="${uniqueId}-trigger"
          aria-label="Select color palette"
        >
          <span class="custom-select-value">${escapeHtml(currentPalette)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 4a8 8 0 1 0 0 16h1.2c1.4 0 2.3-1.5 1.6-2.7-.6-1-.2-2.3.9-2.8 1.1-.5 2.3.2 2.4 1.4.1 1.2 1.1 2.1 2.3 2.1H21a3 3 0 0 0 3-3c0-6.1-5.4-11-12-11Z" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="7.3" cy="11.2" r="1.1" fill="currentColor"/>
            <circle cx="10.1" cy="8.2" r="1.1" fill="currentColor"/>
            <circle cx="14.1" cy="8.6" r="1.1" fill="currentColor"/>
            <circle cx="16.8" cy="11.7" r="1.1" fill="currentColor"/>
          </svg>
        </button>
        <div class="custom-select-dropdown overlay-palette-dropdown" id="${uniqueId}-dropdown" role="listbox">
          ${paletteOptions
              .map(
                  (palette) => `
            <div class="custom-select-option ${
                palette.name === currentPalette ? "selected" : ""
            }"
                 data-value="${palette.name}"
                 data-action="update-select"
                 data-key="${dataKey}"
                 role="option"
                 ${palette.name === currentPalette ? 'aria-selected="true"' : ""}
                 tabindex="0">
              <div class="legend-palette-option-content">
                <div class="legend-palette-swatches">
                  ${palette.colors
                      .slice(0, 4)
                      .map(
                          (color) =>
                              `<span class="legend-palette-dot" style="background:${color};"></span>`,
                      )
                      .join("")}
                </div>
                <span class="legend-palette-name">${escapeHtml(palette.name)}</span>
              </div>
            </div>
          `,
              )
              .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderLegendUnitControl() {
    const isEnsemble = state.mode === "Ensemble";
    const unitKey = isEnsemble ? "ensembleUnit" : "unit";
    const currentUnit = isEnsemble ? state.ensembleUnit : state.selectedUnit;
    const unitVariable = isEnsemble ? state.ensembleVariable : state.variable;
    return `
    <div class="legend-unit-select">
      ${renderSelect(
          unitKey,
          getUnitOptions(unitVariable).map((opt) => opt.label),
          currentUnit,
          { dataKey: unitKey, dataRole: "unit-selector" },
      )}
    </div>
  `;
}

function renderLegendW2PaletteSelect() {
    const uniqueId = `w2-legend-palette-${Math.random().toString(36).substr(2, 9)}`;
    return `
    <div class="custom-select-container">
      <div class="custom-select-wrapper legend-palette-wrapper" data-key="w2mapPalette" data-role="palette-selector">
        <button
          type="button"
          class="custom-select-trigger legend-palette-trigger"
          data-action="update-select"
          data-key="w2mapPalette"
          id="${uniqueId}-trigger"
          aria-label="Select color palette for View 2"
        >
          <span class="custom-select-value legend-palette-current">${escapeHtml(state.window2.mapPalette)}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 4a8 8 0 1 0 0 16h1.2c1.4 0 2.3-1.5 1.6-2.7-.6-1-.2-2.3.9-2.8 1.1-.5 2.3.2 2.4 1.4.1 1.2 1.1 2.1 2.3 2.1H21a3 3 0 0 0 3-3c0-6.1-5.4-11-12-11Z" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="7.3" cy="11.2" r="1.1" fill="currentColor"/>
            <circle cx="10.1" cy="8.2" r="1.1" fill="currentColor"/>
            <circle cx="14.1" cy="8.6" r="1.1" fill="currentColor"/>
            <circle cx="16.8" cy="11.7" r="1.1" fill="currentColor"/>
          </svg>
        </button>
        <div class="custom-select-dropdown legend-palette-dropdown" id="${uniqueId}-dropdown" role="listbox">
          ${paletteOptions
              .map(
                  (palette) => `
            <div class="custom-select-option ${palette.name === state.window2.mapPalette ? "selected" : ""}"
                 data-value="${palette.name}"
                 data-action="update-select"
                 data-key="w2mapPalette"
                 role="option"
                 ${palette.name === state.window2.mapPalette ? 'aria-selected="true"' : ""}
                 tabindex="0">
              <div class="legend-palette-option-content">
                <div class="legend-palette-swatches">
                  ${palette.colors.slice(0, 4).map((color) => `<span class="legend-palette-dot" style="background:${color};"></span>`).join("")}
                </div>
                <span class="legend-palette-name">${escapeHtml(palette.name)}</span>
              </div>
            </div>
          `,
              )
              .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderLegendW2UnitControl() {
    const w2 = state.window2;
    const isEnsemble = w2.mode === "Ensemble";
    const unitKey = isEnsemble ? "w2ensembleUnit" : "w2unit";
    const unitVariable = isEnsemble ? w2.ensembleVariable : w2.variable;
    const currentUnit = isEnsemble ? w2.ensembleUnit : w2.selectedUnit;
    return `
    <div class="legend-unit-select">
      ${renderSelect(
          unitKey,
          getUnitOptions(unitVariable).map((opt) => opt.label),
          currentUnit,
          { dataKey: unitKey, dataRole: "unit-selector" },
      )}
    </div>
  `;
}

function redrawMapForPinnedRange(w: "1" | "2") {
    if (w === "2") {
        if (!state.window2.canvasView || state.window2.canvasView !== "map") return;
        if (!state.window2.currentData || !persistentCanvas2 || state.window2.dataMin === null || state.window2.dataMax === null) return;
        const isEns = state.window2.mode === "Ensemble";
        renderMapDataWindow2(
            state.window2.currentData, persistentCanvas2, paletteOptions, state.window2.mapPalette,
            state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
            state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
            isEns ? state.window2.ensembleVariable : state.window2.variable,
            isEns ? state.window2.ensembleUnit : state.window2.selectedUnit,
            getModeMasks(state.window2).length > 0 ? getModeMasks(state.window2) : undefined,
            isEns ? state.window2.ensembleStatistics ?? undefined : undefined,
            isEns,
            state.window2.maskVariableData.size > 0 ? state.window2.maskVariableData : undefined,
            isEns ? state.window2.ensembleStatisticsByVariable : undefined,
            isEns ? state.window2.ensembleRawSamplesByVariable : undefined,
        );
    } else {
        if (state.canvasView !== "map" || !state.currentData || state.dataMin === null || state.dataMax === null) return;
        const canvas = appRoot?.querySelector<HTMLCanvasElement>("#map-canvas");
        if (!canvas) return;
        const isEns = state.mode === "Ensemble";
        renderMapData(
            state.currentData, canvas, paletteOptions, state.mapPalette,
            state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
            state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
            isEns ? state.ensembleVariable : state.variable,
            isEns ? state.ensembleUnit : state.selectedUnit,
            getModeMasks(state),
            isEns ? state.ensembleStatistics : null,
            isEns,
            (state.mode === "Explore" || state.mode === "Compare") ? state.maskVariableData : undefined,
            isEns ? state.ensembleStatisticsByVariable : null,
            isEns ? state.ensembleRawSamplesByVariable : null,
        );
    }
}

function renderLegendPinBtn(win: "1" | "2"): string {
    const s = win === "2" ? state.window2 : state;
    const pinned = s.legendPinned;
    const tooltipOpen = legendPinTooltipOpen === win;

    const lockPaths = pinned
        ? `<rect x="3" y="11" width="18" height="11" rx="2" stroke-width="1.7"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-width="1.7"/>`
        : `<rect x="3" y="11" width="18" height="11" rx="2" stroke-width="1.7"/><path d="M7 11V7a5 5 0 0 1 9.9-1" stroke-width="1.7"/>`;

    return `<div class="legend-pin-anchor">
      <button type="button"
              class="legend-pin-btn${pinned ? " active" : ""}"
              data-action="legend-pin-toggle"
              data-window="${win}"
              title="${pinned ? (tooltipOpen ? "Close" : "Edit fixed range") : "Pin color range"}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          ${lockPaths}
        </svg>
      </button>
    </div>`;
}

function renderLegendPinTooltip(win: "1" | "2"): string {
    const s = win === "2" ? state.window2 : state;
    if (!s.legendPinned || legendPinTooltipOpen !== win) return "";

    const isEnsemble = s.mode === "Ensemble";
    const variable = isEnsemble ? s.ensembleVariable : s.variable;
    const selectedUnitLabel = isEnsemble ? s.ensembleUnit : s.selectedUnit;
    const unitAbbrev =
        getUnitOptions(variable).find((opt) => opt.label === selectedUnitLabel)?.unit ?? "";
    const isDiff = s.mode === "Compare" || (isEnsemble && isDifferenceEnsembleStatistic(s.ensembleStatistic));

    const displayMin =
        s.legendPinnedMin !== null
            ? convertMinMax(s.legendPinnedMin, s.legendPinnedMin, variable, selectedUnitLabel, { isDifference: isDiff }).min
            : null;
    const displayMax =
        s.legendPinnedMax !== null
            ? convertMinMax(s.legendPinnedMax, s.legendPinnedMax, variable, selectedUnitLabel, { isDifference: isDiff }).max
            : null;

    const fmt = (v: number | null) =>
        v !== null && Number.isFinite(v) ? String(parseFloat(v.toFixed(4))) : "";

    const unitSuffix = unitAbbrev
        ? `<span class="legend-pin-unit">${unitAbbrev}</span>`
        : "";

    return `<div class="legend-pin-tooltip" data-window="${win}">
      <div class="legend-pin-tooltip-header">
        <span class="legend-pin-tooltip-title">Fixed range</span>
        <button type="button" class="legend-pin-close-btn"
                data-action="legend-pin-toggle" data-window="${win}"
                title="Close">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <label class="legend-pin-tooltip-row">
        <span class="legend-pin-tooltip-label">Max</span>
        <input type="number" class="legend-pin-input"
               data-action="legend-pin-range" data-key="legendPinnedMax" data-window="${win}"
               value="${fmt(displayMax)}" step="any">${unitSuffix}
      </label>
      <label class="legend-pin-tooltip-row">
        <span class="legend-pin-tooltip-label">Min</span>
        <input type="number" class="legend-pin-input"
               data-action="legend-pin-range" data-key="legendPinnedMin" data-window="${win}"
               value="${fmt(displayMin)}" step="any">${unitSuffix}
      </label>
      <div class="legend-pin-tooltip-actions">
        <button type="button" class="legend-pin-reset-btn"
                data-action="legend-pin-reset" data-window="${win}">Reset</button>
        <button type="button" class="legend-pin-unpin-btn"
                data-action="legend-pin-unpin" data-window="${win}">Unpin</button>
      </div>
    </div>`;
}

function renderTabButton(
    value: PanelTab,
    activeStyle?: Style,
    dataKey = "panel-tab",
    dataWindow?: "1" | "2",
) {
    const dataWindowAttr = dataWindow ? ` data-window="${dataWindow}"` : "";
    return `
    <button
      type="button"
      data-action="set-tab"
      data-key="${dataKey}"
      data-value="${value}"
      ${dataWindowAttr}
      style="${styleAttr(mergeStyles(styles.tabBtn, activeStyle))}"
    >
      ${value}
    </button>
  `;
}

function renderManualSection(params: {
    modeTransform: string;
    resolutionFill: number;
    modeIndicatorTransform: string;
    window?: 1 | 2;
}) {
    const { modeTransform, resolutionFill, modeIndicatorTransform, window = 1 } = params;
    const s = getWindowState(window);
    const dataWindowOpt = window === 2 ? ("2" as const) : undefined;
    const hasProbabilityMasks =
        s.mode === "Ensemble" &&
        getModeMasks(s).some((mask) => mask.kind === "probability");

    const renderCollapsible = (
        label: string,
        open: boolean,
        countLabel: string,
        content: string,
        dataKey: string,
        dataWindow?: "1" | "2",
    ) => {
        return `
          <div style="${styleAttr({
              border: "1px solid var(--border-medium)",
              borderRadius: 12,
              background: "var(--bg-subtle)",
              padding: "10px 12px",
          })}">
            <button
              type="button"
              data-action="toggle-collapse"
              data-key="${dataKey}"
              ${dataWindow ? `data-window="${dataWindow}"` : ""}
              style="${styleAttr({
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
              })}"
            >
              <span>${label}</span>
              <span style="${styleAttr({
                  color: "var(--text-secondary)",
                  fontWeight: 600,
                  fontSize: 12,
              })}">${countLabel} ${open ? "▴" : "▾"}</span>
            </button>
            ${
                open
                    ? `<div style="${styleAttr({
                          marginTop: 10,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                      })}">${content}</div>`
                    : ""
            }
          </div>
        `;
    };
    const compareParameters =
        s.compareMode === "Models"
            ? [
                  renderField(
                      "Scenario",
                      renderSelect("scenario", scenarios, s.scenario, {
                          infoType: "scenario",
                          dataWindow: dataWindowOpt,
                      }),
                  ),
                  renderField("Date", renderInput("date", s.date, { dataWindow: dataWindowOpt })),
              ]
            : s.compareMode === "Dates"
              ? [
                    renderField(
                        "Scenario",
                        renderSelect("scenario", scenarios, s.scenario, {
                            infoType: "scenario",
                            dataWindow: dataWindowOpt,
                        }),
                    ),
                    renderField(
                        "Model",
                        renderSelect("model", models, s.model, {
                            infoType: "model",
                            dataWindow: dataWindowOpt,
                        }),
                    ),
                ]
              : [
                    renderField(
                        "Model",
                        renderSelect("model", models, s.model, {
                            infoType: "model",
                            dataWindow: dataWindowOpt,
                        }),
                    ),
                    renderField("Date", renderInput("date", s.date, { dataWindow: dataWindowOpt })),
                ];

    return `
    <div style="${styleAttr(styles.modeSwitch)}">
      <div data-role="mode-indicator" style="${styleAttr({
          ...styles.modeIndicator,
          transform: modeIndicatorTransform,
      })}"></div>
      ${(["Explore", "Compare", "Ensemble"] as const)
          .map(
              (value) =>
                  `
            <button
              type="button"
              class="mode-btn"
              data-action="set-mode"
              data-value="${value}"
              ${dataWindowOpt ? `data-window="${dataWindowOpt}"` : ""}
              style="${styleAttr(
                  mergeStyles(
                      styles.modeBtn,
                      s.mode === value ? styles.modeBtnActive : undefined,
                  ),
              )}"
            >
              ${value}
            </button>
          `,
          )
          .join("")}
    </div>

    <div style="${styleAttr(styles.modeViewport)}">
      <div data-role="mode-track" style="${styleAttr({
          ...styles.modeTrack,
          transform: modeTransform,
      })}">
        <div class="mode-pane-scrollable" style="${styleAttr(styles.modePane)}">
          <div style="${styleAttr({
              display: "flex",
              flexDirection: "column",
              gap: 8,
          })}">
            <div style="${styleAttr(styles.sectionTitle)}">Parameters</div>
            <div style="${styleAttr(styles.paramGrid)}">
              ${renderField(
                  "Scenario",
                  renderSelect("scenario", scenarios, s.scenario, {
                      infoType: "scenario",
                      dataRole: "scenario-selector",
                      dataWindow: dataWindowOpt,
                  }),
              )}
              ${renderField(
                  "Model",
                  renderSelect("model", models, s.model, {
                      infoType: "model",
                      dataRole: "model-selector",
                      dataWindow: dataWindowOpt,
                  }),
              )}
              ${renderField(
                  "Date",
                  (() => {
                      const timeRange = getTimeRangeForScenario(s.scenario);
                      return renderInput("date", s.date, {
                          min: timeRange.start,
                          max: timeRange.end,
                          dataRole: "date-picker",
                          dataWindow: dataWindowOpt,
                      });
                  })(),
              )}
              ${renderField(
                  "Variable",
                  renderSelect("variable", variables, s.variable, {
                      infoType: "variable",
                      dataRole: "variable-selector",
                      dataWindow: dataWindowOpt,
                  }),
              )}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Resolution</div>
              <div style="${styleAttr(styles.resolutionRow)}">
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value="${s.resolution}"
                  data-action="set-resolution"
                  ${dataWindowOpt ? `data-window="${dataWindowOpt}"` : ""}
                  class="resolution-slider"
                  style="${styleAttr(
                      mergeStyles(styles.range, {
                          "--slider-fill": `${resolutionFill}%`,
                      }),
                  )}"
                />
                <div data-role="resolution-value" style="${styleAttr(
                    styles.resolutionValue,
                )}">${
                    s.resolution === 1
                        ? "Low"
                        : s.resolution === 2
                          ? "Medium"
                          : "High"
                }</div>
              </div>
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Mask</div>
              ${
                  getModeMasks(s).length > 0
                      ? `
                      <div style="${styleAttr({
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                      })}">
                        ${getModeMasks(s)
                            .map((mask, index) => {
                                const maskVar =
                                    mask.variable ||
                                    (s.mode === "Ensemble"
                                        ? s.ensembleVariable
                                        : s.variable);
                                const maskUnit =
                                    mask.unit ||
                                    (s.mode === "Ensemble"
                                        ? s.ensembleUnit
                                        : getDefaultUnitOption(maskVar).label);
                                const maskRange =
                                    s.mode === "Explore"
                                        ? getMaskRangeFor(maskVar, maskUnit)
                                        : null;
                                const ensembleRange =
                                    s.mode === "Ensemble"
                                        ? mask.kind === "probability"
                                            ? getEnsembleProbabilityMaskRange(
                                                  maskVar,
                                                  maskUnit,
                                              )
                                            : getEnsembleMaskRange(
                                                  mask.statistic || "mean",
                                                  maskVar,
                                                  maskUnit,
                                              )
                                        : null;
                                const lowerPlaceholder =
                                    s.mode === "Ensemble"
                                        ? (ensembleRange?.min ?? null)
                                        : (maskRange?.min ??
                                          (maskVar === s.variable
                                              ? s.dataMin
                                              : null));
                                const upperPlaceholder =
                                    s.mode === "Ensemble"
                                        ? (ensembleRange?.max ?? null)
                                        : (maskRange?.max ??
                                          (maskVar === s.variable
                                              ? s.dataMax
                                              : null));
                                return `
                          ${
                              s.mode === "Ensemble"
                                  ? `
                                  <div style="${styleAttr({
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 4,
                                  })}">
                                    ${
                                        mask.kind === "probability"
                                            ? ""
                                            : renderSelect(
                                                  "maskStatistic",
                                                  [
                                                      "mean",
                                                      "std",
                                                      "median",
                                                      "iqr",
                                                      "percentile",
                                                      "extremes",
                                                  ],
                                                  mask.statistic || "mean",
                                                  {
                                                      dataKey: "maskStatistic",
                                                      selectedLabel:
                                                          mask.statistic ===
                                                          "mean"
                                                              ? "Mean"
                                                              : mask.statistic ===
                                                                  "std"
                                                                ? "Std"
                                                                : mask.statistic ===
                                                                    "median"
                                                                  ? "Median"
                                                                  : mask.statistic ===
                                                                      "iqr"
                                                                    ? "IQR"
                                                                    : mask.statistic ===
                                                                        "percentile"
                                                                      ? "Percentile"
                                                                      : mask.statistic ===
                                                                          "extremes"
                                                                        ? "Extremes"
                                                                        : "Mean",
                                                  },
                                              ).replace(
                                                  'class="custom-select-wrapper"',
                                                  `class="custom-select-wrapper" data-mask-index="${index}" style="width: 100px;"`,
                                              )
                                    }
                                    ${renderSelect(
                                        "maskVariable",
                                        variables,
                                        maskVar,
                                        {
                                            dataKey: "maskVariable",
                                            infoType: "variable",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                    )}
                                    ${renderSelect(
                                        "maskUnit",
                                        getUnitOptions(maskVar).map(
                                            (opt) => opt.label,
                                        ),
                                        maskUnit,
                                        {
                                            dataKey: "maskUnit",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                    )}
                                  </div>
                                  `
                                  : s.mode === "Explore"
                                    ? `
                                  <div style="${styleAttr({
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 4,
                                  })}">
                                    ${renderSelect(
                                        "maskVariable",
                                        variables,
                                        mask.variable || s.variable,
                                        {
                                            dataKey: "maskVariable",
                                            infoType: "variable",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                    )}
                                    ${renderSelect(
                                        "maskUnit",
                                        getUnitOptions(
                                            mask.variable || s.variable,
                                        ).map((opt) => opt.label),
                                        mask.unit ||
                                            getDefaultUnitOption(
                                                mask.variable || s.variable,
                                            ).label,
                                        {
                                            dataKey: "maskUnit",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                    )}
                                  </div>
                                  `
                                    : ""
                          }
                          <div style="${styleAttr({
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                          })}">
                            <input
                              type="number"
                              step="any"
                              value="${mask.lowerEdited && mask.lowerBound !== null ? mask.lowerBound : ""}"
                              data-action="update-mask-bound"
                              data-mask-index="${index}"
                              data-bound="lower"
                              placeholder="${formatMaskLimit(lowerPlaceholder)}"
                              style="${styleAttr({
                                  width: "90px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <span style="${styleAttr({
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                                minWidth: "20px",
                                textAlign: "center",
                            })}">to</span>
                            <input
                              type="number"
                              step="any"
                              value="${mask.upperEdited && mask.upperBound !== null ? mask.upperBound : ""}"
                              data-action="update-mask-bound"
                              data-mask-index="${index}"
                              data-bound="upper"
                              placeholder="${formatMaskLimit(upperPlaceholder)}"
                              style="${styleAttr({
                                  width: "90px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <button
                              type="button"
                              data-action="remove-mask"
                              data-mask-index="${index}"
                              style="${styleAttr({
                                  width: 28,
                                  height: 28,
                                  padding: 0,
                                  borderRadius: 6,
                                  border: "1px solid var(--border-medium)",
                                  background: "var(--bg-transparent)",
                                  color: "var(--text-secondary)",
                                  fontSize: 16,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                              })}"
                              onmouseover="this.style.borderColor='var(--border-bright)'; this.style.background='var(--bg-medium)'"
                              onmouseout="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-transparent)'"
                            >
                              −
                            </button>
                          </div>
                          ${mask.kind === "probability" ? `
                          <div style="${styleAttr({
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginTop: 4,
                          })}">
                            <span style="${styleAttr({
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                whiteSpace: "nowrap",
                            })}">Min. prob. ≥</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value="${Math.round((mask.probabilityThreshold ?? 0.5) * 100)}"
                              data-action="update-mask-probability-threshold"
                              data-mask-index="${index}"
                              placeholder="50"
                              style="${styleAttr({
                                  width: "70px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <span style="${styleAttr({
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                            })}">%</span>
                          </div>
                          ` : ""}
                        `;
                            })
                            .join("")}
                        <button
                          type="button"
                          data-action="apply-masks"
                          style="${styleAttr({
                              padding: "10px 16px",
                              borderRadius: 10,
                              border: "1px solid var(--border-strong)",
                              background: "var(--gradient-primary)",
                              color: "white",
                              fontSize: 12.5,
                              fontWeight: 700,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "center",
                              width: "100%",
                              marginTop: 8,
                              boxShadow: "var(--shadow-combined)",
                          })}"
                          onmouseover="this.style.borderColor='var(--accent-border-bright)'; this.style.boxShadow='var(--shadow-elevated)'"
                          onmouseout="this.style.borderColor='var(--border-strong)'; this.style.boxShadow='var(--shadow-combined)'"
                        >
                          Apply Masks
                        </button>
                        <button
                          type="button"
                          data-action="add-mask"
                          style="${styleAttr({
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: "1px solid var(--border-subtle)",
                              background: "var(--bg-transparent)",
                              color: "var(--text-secondary)",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "left",
                              width: "100%",
                              marginTop: 4,
                          })}"
                          onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                          onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                        >
                          + Add Mask
                        </button>
                        ${
                            s.mode === "Ensemble"
                                ? `
                        <button
                          type="button"
                          data-action="add-probability-mask"
                          style="${styleAttr({
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: "1px solid var(--border-subtle)",
                              background: "var(--bg-transparent)",
                              color: "var(--text-secondary)",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "left",
                              width: "100%",
                              marginTop: 4,
                          })}"
                          onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                          onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                        >
                          + Add Probability Mask
                        </button>
                        `
                                : ""
                        }
                      </div>
                      `
                      : `
                      <button
                        type="button"
                        data-action="add-mask"
                        style="${styleAttr({
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--bg-transparent)",
                            color: "var(--text-secondary)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            textAlign: "left",
                            width: "100%",
                        })}"
                        onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                        onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                      >
                        + Add Mask
                      </button>
                      ${
                          s.mode === "Ensemble"
                              ? `
                      <button
                        type="button"
                        data-action="add-probability-mask"
                        style="${styleAttr({
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--bg-transparent)",
                            color: "var(--text-secondary)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            textAlign: "left",
                            width: "100%",
                            marginTop: 4,
                        })}"
                        onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                        onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                      >
                        + Add Probability Mask
                      </button>
                      `
                              : ""
                      }
                      `
              }
            </div>
          </div>
        </div>

                <div class="mode-pane-scrollable" style="${styleAttr(styles.modePane)}">
                    <div data-role="compare-parameters" style="${styleAttr({
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                    })}">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Compare</div>
              <div style="${styleAttr(styles.paramGrid)}">
                ${renderField(
                    "What do you want to compare?",
                    renderSelect(
                        "compareMode",
                        ["Scenarios", "Models", "Dates"],
                        s.compareMode,
                        {
                            dataKey: "compareMode",
                            dataWindow: dataWindowOpt,
                        },
                    ),
                )}
              </div>

              ${
                  s.compareMode === "Scenarios"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Scenario A",
                            renderSelect(
                                "compareScenarioA",
                                ["SSP245", "SSP370", "SSP585"],
                                s.compareScenarioA,
                                {
                                    dataKey: "compareScenarioA",
                                    infoType: "scenario",
                                    dataWindow: dataWindowOpt,
                                },
                            ),
                        )}
                        ${renderField(
                            "Scenario B",
                            renderSelect(
                                "compareScenarioB",
                                ["SSP245", "SSP370", "SSP585"],
                                s.compareScenarioB,
                                {
                                    dataKey: "compareScenarioB",
                                    infoType: "scenario",
                                    dataWindow: dataWindowOpt,
                                },
                            ),
                        )}
                      </div>
                    `
                      : ""
              }

              ${
                  s.compareMode === "Models"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Model A",
                            renderSelect(
                                "compareModelA",
                                (() => {
                                    const filtered = models.filter(
                                        (m) => m !== s.compareModelB,
                                    );
                                    // Ensure current value is always available
                                    if (
                                        !filtered.includes(s.compareModelA)
                                    ) {
                                        return [
                                            s.compareModelA,
                                            ...filtered,
                                        ];
                                    }
                                    return filtered;
                                })(),
                                s.compareModelA,
                                { dataKey: "compareModelA", infoType: "model", dataWindow: dataWindowOpt },
                            ),
                        )}
                        ${renderField(
                            "Model B",
                            renderSelect(
                                "compareModelB",
                                (() => {
                                    const filtered = models.filter(
                                        (m) => m !== s.compareModelA,
                                    );
                                    // Ensure current value is always available
                                    if (
                                        !filtered.includes(s.compareModelB)
                                    ) {
                                        return [
                                            s.compareModelB,
                                            ...filtered,
                                        ];
                                    }
                                    return filtered;
                                })(),
                                s.compareModelB,
                                { dataKey: "compareModelB", infoType: "model", dataWindow: dataWindowOpt },
                            ),
                        )}
                      </div>
                    `
                      : ""
              }

              ${
                  s.compareMode === "Dates"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Start date",
                            renderInput(
                                "compareDateStart",
                                s.compareDateStart,
                                { dataKey: "compareDateStart", dataWindow: dataWindowOpt },
                            ),
                        )}
                        ${renderField(
                            "End date",
                            renderInput(
                                "compareDateEnd",
                                s.compareDateEnd,
                                { dataKey: "compareDateEnd", dataWindow: dataWindowOpt },
                            ),
                        )}
  </div>
`
                      : ""
              }

              <div style="${styleAttr(styles.paramGrid)}">
                ${compareParameters.join("")}
                ${renderField(
                    "Variable",
                    renderSelect("variable", variables, s.variable, {
                        infoType: "variable",
                        dataWindow: dataWindowOpt,
                    }),
                )}
              </div>

              <div style="margin-top:14px">
                <div style="${styleAttr({
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                })}">
                  <div style="${styleAttr(
                      styles.sectionTitle,
                  )}">Resolution</div>
                  <div style="${styleAttr(styles.resolutionRow)}">
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="1"
                      value="${s.resolution}"
                      data-action="set-resolution"
                      ${dataWindowOpt ? `data-window="${dataWindowOpt}"` : ""}
                      class="resolution-slider"
                      style="${styleAttr(
                          mergeStyles(styles.range, {
                              "--slider-fill": `${resolutionFill}%`,
                          }),
                      )}"
                    />
                    <div data-role="resolution-value" style="${styleAttr(
                        styles.resolutionValue,
                    )}">${
                    s.resolution === 1
                        ? "Low"
                        : s.resolution === 2
                          ? "Medium"
                          : "High"
                }</div>
                  </div>
                </div>
              </div>

              <div style="margin-top:14px">
                <div style="${styleAttr({
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                })}">
                  <div style="${styleAttr(styles.sectionTitle)}">Mask</div>
                  ${
                      getModeMasks(s).length > 0
                          ? `
                          <div style="${styleAttr({
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                          })}">
                            ${getModeMasks(s)
                                .map((mask, index) => {
                                    const maskVar =
                                        mask.variable ||
                                        (s.mode === "Ensemble"
                                            ? s.ensembleVariable
                                            : s.variable);
                                    const maskUnit =
                                        mask.unit ||
                                        (s.mode === "Ensemble"
                                            ? s.ensembleUnit
                                            : getDefaultUnitOption(maskVar).label);
                                    const maskRange =
                                        s.mode === "Explore"
                                            ? getMaskRangeFor(maskVar, maskUnit)
                                            : null;
                                    const ensembleRange =
                                        s.mode === "Ensemble"
                                            ? mask.kind === "probability"
                                                ? getEnsembleProbabilityMaskRange(
                                                      maskVar,
                                                      maskUnit,
                                                  )
                                                : getEnsembleMaskRange(
                                                      mask.statistic || "mean",
                                                      maskVar,
                                                      maskUnit,
                                                  )
                                            : null;
                                    const lowerPlaceholder =
                                        s.mode === "Ensemble"
                                            ? (ensembleRange?.min ?? null)
                                            : (maskRange?.min ??
                                              (maskVar === s.variable
                                                  ? s.dataMin
                                                  : null));
                                    const upperPlaceholder =
                                        s.mode === "Ensemble"
                                            ? (ensembleRange?.max ?? null)
                                            : (maskRange?.max ??
                                              (maskVar === s.variable
                                                  ? s.dataMax
                                                  : null));
                                    return `
                              <div style="${styleAttr({
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                              })}">
                                ${
                                    s.mode === "Ensemble"
                                        ? (mask.kind === "probability"
                                              ? ""
                                              : renderSelect(
                                                    "maskStatistic",
                                                    [
                                                        "mean",
                                                        "std",
                                                        "median",
                                                        "iqr",
                                                        "percentile",
                                                        "extremes",
                                                    ],
                                                    mask.statistic || "mean",
                                                    {
                                                        dataKey: "maskStatistic",
                                                        selectedLabel:
                                                            mask.statistic ===
                                                            "mean"
                                                                ? "Mean"
                                                                : mask.statistic ===
                                                                    "std"
                                                                  ? "Std"
                                                                  : mask.statistic ===
                                                                      "median"
                                                                    ? "Median"
                                                                    : mask.statistic ===
                                                                        "iqr"
                                                                      ? "IQR"
                                                                      : mask.statistic ===
                                                                          "percentile"
                                                                        ? "Percentile"
                                                                        : mask.statistic ===
                                                                            "extremes"
                                                                          ? "Extremes"
                                                                          : "Mean",
                                                    },
                                                )
                                                    .replace(
                                                        'data-key="maskStatistic"',
                                                        `data-key="maskStatistic" data-mask-index="${index}"`,
                                                    )
                                                    .replace(
                                                        'class="custom-select-wrapper"',
                                                        `class="custom-select-wrapper" data-mask-index="${index}"`,
                                                    )) +
                                          renderSelect(
                                              "maskVariable",
                                              variables,
                                              maskVar,
                                              {
                                                  dataKey: "maskVariable",
                                                  infoType: "variable",
                                              },
                                          ).replace(
                                              'class="custom-select-wrapper"',
                                              `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                          ) +
                                          renderSelect(
                                              "maskUnit",
                                              getUnitOptions(maskVar).map(
                                                  (opt) => opt.label,
                                              ),
                                              maskUnit,
                                              {
                                                  dataKey: "maskUnit",
                                              },
                                          ).replace(
                                              'class="custom-select-wrapper"',
                                              `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                          )
                                        : s.mode === "Explore"
                                          ? `
                                            ${renderSelect(
                                                "maskVariable",
                                                variables,
                                                mask.variable || s.variable,
                                                {
                                                    dataKey: "maskVariable",
                                                    infoType: "variable",
                                                },
                                            ).replace(
                                                'class="custom-select-wrapper"',
                                                `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                            )}
                                            ${renderSelect(
                                                "maskUnit",
                                                getUnitOptions(
                                                    mask.variable ||
                                                        s.variable,
                                                ).map((opt) => opt.label),
                                                mask.unit ||
                                                    getDefaultUnitOption(
                                                        mask.variable ||
                                                            s.variable,
                                                    ).label,
                                                {
                                                    dataKey: "maskUnit",
                                                },
                                            ).replace(
                                                'class="custom-select-wrapper"',
                                                `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                            )}
                                          `
                                          : ""
                                }
                                <input
                                  type="number"
                                  step="any"
                                  value="${mask.lowerEdited && mask.lowerBound !== null ? mask.lowerBound : ""}"
                                  data-action="update-mask-bound"
                                  data-mask-index="${index}"
                                  data-bound="lower"
                                  placeholder="${formatMaskLimit(lowerPlaceholder)}"
                                  style="${styleAttr({
                                      width: "90px",
                                      background: "var(--gradient-bg)",
                                      border: "1px solid var(--border-strong)",
                                      borderRadius: 8,
                                      color: "var(--text-primary)",
                                      padding: "6px 10px",
                                      fontSize: 12.5,
                                      fontWeight: 600,
                                      fontFamily: "var(--font-geist-sans)",
                                      letterSpacing: 0.25,
                                      minHeight: 32,
                                      boxShadow:
                                          "inset 0 1px 0 var(--inset-light)",
                                  })}"
                                />
                                <span style="${styleAttr({
                                    fontSize: 12.5,
                                    color: "var(--text-secondary)",
                                    minWidth: "20px",
                                    textAlign: "center",
                                })}">to</span>
                                <input
                                  type="number"
                                  step="any"
                                  value="${mask.upperEdited && mask.upperBound !== null ? mask.upperBound : ""}"
                                  data-action="update-mask-bound"
                                  data-mask-index="${index}"
                                  data-bound="upper"
                                  placeholder="${formatMaskLimit(upperPlaceholder)}"
                                  style="${styleAttr({
                                      width: "90px",
                                      background: "var(--gradient-bg)",
                                      border: "1px solid var(--border-strong)",
                                      borderRadius: 8,
                                      color: "var(--text-primary)",
                                      padding: "6px 10px",
                                      fontSize: 12.5,
                                      fontWeight: 600,
                                      fontFamily: "var(--font-geist-sans)",
                                      letterSpacing: 0.25,
                                      minHeight: 32,
                                      boxShadow:
                                          "inset 0 1px 0 var(--inset-light)",
                                  })}"
                                />
                                <button
                                  type="button"
                                  data-action="remove-mask"
                                  data-mask-index="${index}"
                                  style="${styleAttr({
                                      width: 28,
                                      height: 28,
                                      padding: 0,
                                      borderRadius: 6,
                                      border: "1px solid var(--border-medium)",
                                      background: "var(--bg-transparent)",
                                      color: "var(--text-secondary)",
                                      fontSize: 16,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      transition: "all 0.15s ease",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flexShrink: 0,
                                  })}"
                                  onmouseover="this.style.borderColor='var(--border-bright)'; this.style.background='var(--bg-medium)'"
                                  onmouseout="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-transparent)'"
                                >
                                  −
                                </button>
                              </div>
                              ${mask.kind === "probability" ? `
                              <div style="${styleAttr({
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginTop: 4,
                              })}">
                                <span style="${styleAttr({
                                    fontSize: 12,
                                    color: "var(--text-secondary)",
                                    whiteSpace: "nowrap",
                                })}">Min. prob. ≥</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value="${Math.round((mask.probabilityThreshold ?? 0.5) * 100)}"
                                  data-action="update-mask-probability-threshold"
                                  data-mask-index="${index}"
                                  placeholder="50"
                                  style="${styleAttr({
                                      width: "70px",
                                      background: "var(--gradient-bg)",
                                      border: "1px solid var(--border-strong)",
                                      borderRadius: 8,
                                      color: "var(--text-primary)",
                                      padding: "6px 10px",
                                      fontSize: 12.5,
                                      fontWeight: 600,
                                      fontFamily: "var(--font-geist-sans)",
                                      letterSpacing: 0.25,
                                      minHeight: 32,
                                      boxShadow: "inset 0 1px 0 var(--inset-light)",
                                  })}"
                                />
                                <span style="${styleAttr({
                                    fontSize: 12.5,
                                    color: "var(--text-secondary)",
                                })}">%</span>
                              </div>
                              ` : ""}
                            `;
                                })
                                .join("")}
                            <button
                              type="button"
                              data-action="apply-masks"
                              style="${styleAttr({
                                  padding: "10px 16px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-strong)",
                                  background: "var(--gradient-primary)",
                                  color: "white",
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                  textAlign: "center",
                                  width: "100%",
                                  marginTop: 8,
                                  boxShadow: "var(--shadow-combined)",
                              })}"
                              onmouseover="this.style.borderColor='var(--accent-border-bright)'; this.style.boxShadow='var(--shadow-elevated)'"
                              onmouseout="this.style.borderColor='var(--border-strong)'; this.style.boxShadow='var(--shadow-combined)'"
                            >
                              Apply Masks
                            </button>
                            <button
                              type="button"
                              data-action="add-mask"
                              style="${styleAttr({
                                  padding: "8px 14px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-subtle)",
                                  background: "var(--bg-transparent)",
                                  color: "var(--text-secondary)",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                  textAlign: "left",
                                  width: "100%",
                                  marginTop: 4,
                              })}"
                              onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                              onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                            >
                              + Add Mask
                            </button>
                            ${
                                s.mode === "Ensemble"
                                    ? `
                            <button
                              type="button"
                              data-action="add-probability-mask"
                              style="${styleAttr({
                                  padding: "8px 14px",
                                  borderRadius: 10,
                                  border: "1px solid var(--border-subtle)",
                                  background: "var(--bg-transparent)",
                                  color: "var(--text-secondary)",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                  textAlign: "left",
                                  width: "100%",
                                  marginTop: 4,
                              })}"
                              onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                              onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                            >
                              + Add Probability Mask
                            </button>
                            `
                                    : ""
                            }
                          </div>
                          `
                          : `
                          <button
                            type="button"
                            data-action="add-mask"
                            style="${styleAttr({
                                padding: "8px 14px",
                                borderRadius: 10,
                                border: "1px solid var(--border-subtle)",
                                background: "var(--bg-transparent)",
                                color: "var(--text-secondary)",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                textAlign: "left",
                                width: "100%",
                            })}"
                            onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                            onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                          >
                            + Add Mask
                          </button>
                          ${
                              s.mode === "Ensemble"
                                  ? `
                          <button
                            type="button"
                            data-action="add-probability-mask"
                            style="${styleAttr({
                                padding: "8px 14px",
                                borderRadius: 10,
                                border: "1px solid var(--border-subtle)",
                                background: "var(--bg-transparent)",
                                color: "var(--text-secondary)",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                textAlign: "left",
                                width: "100%",
                                marginTop: 4,
                            })}"
                            onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                            onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                          >
                            + Add Probability Mask
                          </button>
                          `
                                  : ""
                          }
                          `
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mode-pane-scrollable" style="${styleAttr(styles.modePane)}">
          <div style="${styleAttr({
              display: "flex",
              flexDirection: "column",
              gap: 8,
          })}">
            <div style="${styleAttr(styles.sectionTitle)}">Parameters</div>
            <div style="${styleAttr(styles.paramGrid)}">
              ${renderField(
                  "Date",
                  (() => {
                      const commonRange = intersectScenarioRange(
                          s.ensembleScenarios.length
                              ? s.ensembleScenarios
                              : scenarios,
                      );
                      return renderInput("ensembleDate", s.ensembleDate, {
                          dataKey: "ensembleDate",
                          min: commonRange.start,
                          max: commonRange.end,
                          dataWindow: dataWindowOpt,
                      });
                  })(),
              )}
              ${renderField(
                  "Variable",
                  renderSelect(
                      "ensembleVariable",
                      variables,
                      s.ensembleVariable,
                      {
                          dataKey: "ensembleVariable",
                          infoType: "variable",
                          disabled: hasProbabilityMasks,
                          selectedLabel: hasProbabilityMasks
                              ? "Probability"
                              : undefined,
                          dataWindow: dataWindowOpt,
                      },
                  ),
              )}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Statistic</div>
              ${renderField(
                  "",
                  renderSelect(
                      "ensembleStatistic",
                      [
                          "mean",
                          "median",
                          "std",
                          "iqr",
                          "percentile",
                          "extremes",
                      ],
                      s.ensembleStatistic,
                      {
                          dataKey: "ensembleStatistic",
                          dataWindow: dataWindowOpt,
                          selectedLabel:
                              s.ensembleStatistic === "mean"
                                  ? "Mean"
                                  : s.ensembleStatistic === "median"
                                    ? "Median"
                                    : s.ensembleStatistic === "std"
                                      ? "Std Deviation"
                                      : s.ensembleStatistic === "iqr"
                                        ? "IQR (Interquartile Range)"
                                        : s.ensembleStatistic ===
                                            "percentile"
                                          ? "Percentile Band (90th-10th)"
                                          : "Extremes (Max-Min)",
                      },
                  ),
              )}
            </div>
          </div>

          <div style="margin-top:14px">
            ${renderCollapsible(
                "Scenarios",
                s.ensembleDropdown.scenariosOpen,
                `${s.ensembleScenarios.length} selected`,
                renderChipGroup(
                    state.metaData?.scenarios?.length
                        ? Array.from(
                              new Set(
                                  state.metaData.scenarios.map(
                                      normalizeScenarioLabel,
                                  ),
                              ),
                          )
                        : scenarios,
                    s.ensembleScenarios,
                    "ensembleScenarios",
                    dataWindowOpt,
                ),
                "ensembleScenarios",
                dataWindowOpt,
            )}
          </div>

          <div style="margin-top:14px">
            ${renderCollapsible(
                "Models",
                s.ensembleDropdown.modelsOpen,
                `${s.ensembleModels.length} selected`,
                renderChipGroup(
                    state.metaData?.models?.length
                        ? state.metaData.models
                        : models,
                    s.ensembleModels,
                    "ensembleModels",
                    dataWindowOpt,
                ),
                "ensembleModels",
                dataWindowOpt,
            )}
          </div>

          <div style="margin-top:14px">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Resolution</div>
              <div style="${styleAttr(styles.resolutionRow)}">
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value="${s.resolution}"
                  data-action="set-resolution"
                  ${dataWindowOpt ? `data-window="${dataWindowOpt}"` : ""}
                  class="resolution-slider"
                  style="${styleAttr(
                      mergeStyles(styles.range, {
                          "--slider-fill": `${resolutionFill}%`,
                      }),
                  )}"
                />
                <div data-role="resolution-value" style="${styleAttr(
                    styles.resolutionValue,
                )}">${
                    s.resolution === 1
                        ? "Low"
                        : s.resolution === 2
                          ? "Medium"
                          : "High"
                }</div>
              </div>
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${styleAttr({
                display: "flex",
                flexDirection: "column",
                gap: 8,
            })}">
              <div style="${styleAttr(styles.sectionTitle)}">Mask</div>
              ${
                  getModeMasks(s).length > 0
                      ? `
                      <div style="${styleAttr({
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                      })}">
                        ${getModeMasks(s)
                            .map((mask, index) => {
                                const maskVar =
                                    mask.variable ||
                                    (s.mode === "Ensemble"
                                        ? s.ensembleVariable
                                        : s.variable);
                                const maskUnit =
                                    mask.unit ||
                                    (s.mode === "Ensemble"
                                        ? s.ensembleUnit
                                        : getDefaultUnitOption(maskVar).label);
                                const maskRange =
                                    s.mode === "Explore"
                                        ? getMaskRangeFor(maskVar, maskUnit)
                                        : null;
                                const ensembleRange =
                                    s.mode === "Ensemble"
                                        ? mask.kind === "probability"
                                            ? getEnsembleProbabilityMaskRange(
                                                  maskVar,
                                                  maskUnit,
                                              )
                                            : getEnsembleMaskRange(
                                                  mask.statistic || "mean",
                                                  maskVar,
                                                  maskUnit,
                                              )
                                        : null;
                                const lowerPlaceholder =
                                    s.mode === "Ensemble"
                                        ? (ensembleRange?.min ?? null)
                                        : (maskRange?.min ??
                                          (maskVar === s.variable
                                              ? s.dataMin
                                              : null));
                                const upperPlaceholder =
                                    s.mode === "Ensemble"
                                        ? (ensembleRange?.max ?? null)
                                        : (maskRange?.max ??
                                          (maskVar === s.variable
                                              ? s.dataMax
                                              : null));
                                return `
                          ${
                              s.mode === "Ensemble"
                                  ? `
                                  <div style="${styleAttr({
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 4,
                                  })}">
                                    ${
                                        mask.kind === "probability"
                                            ? ""
                                            : renderSelect(
                                                  "maskStatistic",
                                                  [
                                                      "mean",
                                                      "std",
                                                      "median",
                                                      "iqr",
                                                      "percentile",
                                                      "extremes",
                                                  ],
                                                  mask.statistic || "mean",
                                                  {
                                                      dataKey: "maskStatistic",
                                                      selectedLabel:
                                                          mask.statistic ===
                                                          "mean"
                                                              ? "Mean"
                                                              : mask.statistic ===
                                                                  "std"
                                                                ? "Std"
                                                                : mask.statistic ===
                                                                    "median"
                                                                  ? "Median"
                                                                  : mask.statistic ===
                                                                      "iqr"
                                                                    ? "IQR"
                                                                    : mask.statistic ===
                                                                        "percentile"
                                                                      ? "Percentile"
                                                                      : mask.statistic ===
                                                                          "extremes"
                                                                        ? "Extremes"
                                                                        : "Mean",
                                                  },
                                              ).replace(
                                                  'class="custom-select-wrapper"',
                                                  `class="custom-select-wrapper" data-mask-index="${index}" style="width: 100px;"`,
                                              )
                                    }
                                    ${renderSelect(
                                        "maskVariable",
                                        variables,
                                        maskVar,
                                        {
                                            dataKey: "maskVariable",
                                            infoType: "variable",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                    )}
                                    ${renderSelect(
                                        "maskUnit",
                                        getUnitOptions(maskVar).map(
                                            (opt) => opt.label,
                                        ),
                                        maskUnit,
                                        {
                                            dataKey: "maskUnit",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                    )}
                                  </div>
                                  `
                                  : s.mode === "Explore"
                                    ? `
                                  <div style="${styleAttr({
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 4,
                                  })}">
                                    ${renderSelect(
                                        "maskVariable",
                                        variables,
                                        mask.variable || s.variable,
                                        {
                                            dataKey: "maskVariable",
                                            infoType: "variable",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 90px;"`,
                                    )}
                                    ${renderSelect(
                                        "maskUnit",
                                        getUnitOptions(
                                            mask.variable || s.variable,
                                        ).map((opt) => opt.label),
                                        mask.unit ||
                                            getDefaultUnitOption(
                                                mask.variable || s.variable,
                                            ).label,
                                        {
                                            dataKey: "maskUnit",
                                        },
                                    ).replace(
                                        'class="custom-select-wrapper"',
                                        `class="custom-select-wrapper" data-mask-index="${index}" style="width: 120px;"`,
                                    )}
                                  </div>
                                  `
                                    : ""
                          }
                          <div style="${styleAttr({
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                          })}">
                            <input
                              type="number"
                              step="any"
                              value="${mask.lowerEdited && mask.lowerBound !== null ? mask.lowerBound : ""}"
                              data-action="update-mask-bound"
                              data-mask-index="${index}"
                              data-bound="lower"
                              placeholder="${formatMaskLimit(lowerPlaceholder)}"
                              style="${styleAttr({
                                  width: "90px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <span style="${styleAttr({
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                                minWidth: "20px",
                                textAlign: "center",
                            })}">to</span>
                            <input
                              type="number"
                              step="any"
                              value="${mask.upperEdited && mask.upperBound !== null ? mask.upperBound : ""}"
                              data-action="update-mask-bound"
                              data-mask-index="${index}"
                              data-bound="upper"
                              placeholder="${formatMaskLimit(upperPlaceholder)}"
                              style="${styleAttr({
                                  width: "90px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <button
                              type="button"
                              data-action="remove-mask"
                              data-mask-index="${index}"
                              style="${styleAttr({
                                  width: 28,
                                  height: 28,
                                  padding: 0,
                                  borderRadius: 6,
                                  border: "1px solid var(--border-medium)",
                                  background: "var(--bg-transparent)",
                                  color: "var(--text-secondary)",
                                  fontSize: 16,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                              })}"
                              onmouseover="this.style.borderColor='var(--border-bright)'; this.style.background='var(--bg-medium)'"
                              onmouseout="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-transparent)'"
                            >
                              −
                            </button>
                          </div>
                          ${mask.kind === "probability" ? `
                          <div style="${styleAttr({
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginTop: 4,
                          })}">
                            <span style="${styleAttr({
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                whiteSpace: "nowrap",
                            })}">Min. prob. ≥</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value="${Math.round((mask.probabilityThreshold ?? 0.5) * 100)}"
                              data-action="update-mask-probability-threshold"
                              data-mask-index="${index}"
                              placeholder="50"
                              style="${styleAttr({
                                  width: "70px",
                                  background: "var(--gradient-bg)",
                                  border: "1px solid var(--border-strong)",
                                  borderRadius: 8,
                                  color: "var(--text-primary)",
                                  padding: "6px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  fontFamily: "var(--font-geist-sans)",
                                  letterSpacing: 0.25,
                                  minHeight: 32,
                                  boxShadow: "inset 0 1px 0 var(--inset-light)",
                              })}"
                            />
                            <span style="${styleAttr({
                                fontSize: 12.5,
                                color: "var(--text-secondary)",
                            })}">%</span>
                          </div>
                          ` : ""}
                        `;
                            })
                            .join("")}
                        <button
                          type="button"
                          data-action="apply-masks"
                          style="${styleAttr({
                              padding: "10px 16px",
                              borderRadius: 10,
                              border: "1px solid var(--border-strong)",
                              background: "var(--gradient-primary)",
                              color: "white",
                              fontSize: 12.5,
                              fontWeight: 700,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "center",
                              width: "100%",
                              marginTop: 8,
                              boxShadow: "var(--shadow-combined)",
                          })}"
                          onmouseover="this.style.borderColor='var(--accent-border-bright)'; this.style.boxShadow='var(--shadow-elevated)'"
                          onmouseout="this.style.borderColor='var(--border-strong)'; this.style.boxShadow='var(--shadow-combined)'"
                        >
                          Apply Masks
                        </button>
                        <button
                          type="button"
                          data-action="add-mask"
                          style="${styleAttr({
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: "1px solid var(--border-subtle)",
                              background: "var(--bg-transparent)",
                              color: "var(--text-secondary)",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "left",
                              width: "100%",
                              marginTop: 4,
                          })}"
                          onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                          onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                        >
                          + Add Mask
                        </button>
                        ${
                            s.mode === "Ensemble"
                                ? `
                        <button
                          type="button"
                          data-action="add-probability-mask"
                          style="${styleAttr({
                              padding: "8px 14px",
                              borderRadius: 10,
                              border: "1px solid var(--border-subtle)",
                              background: "var(--bg-transparent)",
                              color: "var(--text-secondary)",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              textAlign: "left",
                              width: "100%",
                              marginTop: 4,
                          })}"
                          onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                          onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                        >
                          + Add Probability Mask
                        </button>
                        `
                                : ""
                        }
                      </div>
                      `
                      : `
                      <button
                        type="button"
                        data-action="add-mask"
                        style="${styleAttr({
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--bg-transparent)",
                            color: "var(--text-secondary)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            textAlign: "left",
                            width: "100%",
                        })}"
                        onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                        onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                      >
                        + Add Mask
                      </button>
                      ${
                          s.mode === "Ensemble"
                              ? `
                      <button
                        type="button"
                        data-action="add-probability-mask"
                        style="${styleAttr({
                            padding: "8px 14px",
                            borderRadius: 10,
                            border: "1px solid var(--border-subtle)",
                            background: "var(--bg-transparent)",
                            color: "var(--text-secondary)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            textAlign: "left",
                            width: "100%",
                            marginTop: 4,
                        })}"
                        onmouseover="this.style.borderColor='var(--border-medium)'; this.style.background='var(--bg-subtle)'"
                        onmouseout="this.style.borderColor='var(--border-subtle)'; this.style.background='var(--bg-transparent)'"
                      >
                        + Add Probability Mask
                      </button>
                      `
                              : ""
                      }
                      `
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderChipGroup(
    options: string[],
    selected: string[],
    dataKey: string,
    dataWindow?: "1" | "2",
) {
    const selectedSet = new Set(selected);
    return `
      <div style="${styleAttr(styles.chipRow)}">
        ${options
            .map((opt) => {
                const active = selectedSet.has(opt);
                return `
                  <button
                    type="button"
                    data-action="toggle-multi"
                    data-key="${dataKey}"
                    data-value="${opt}"
                    ${dataWindow ? `data-window="${dataWindow}"` : ""}
                    style="${styleAttr(
                        mergeStyles(
                            styles.chip,
                            active ? styles.chipActive : undefined,
                        ),
                    )}"
                  >
                    ${opt}
                  </button>
                `;
            })
            .join("")}
      </div>
    `;
}

function renderChartLocationExtras() {
    const results =
        state.chartLocationSearchResults.length > 0
            ? state.chartLocationSearchResults
                  .map(
                      (res) => `
                <button
                  type="button"
                  class="location-search-result"
                  data-role="location-search-result"
                  data-name="${escapeHtml(res.displayName)}"
                  data-lat="${res.lat}"
                  data-lon="${res.lon}"
                >
                  <div class="location-search-result-name">${escapeHtml(
                      res.displayName,
                  )}</div>
                  <div class="location-search-result-coord">
                    ${res.lat.toFixed(3)}, ${res.lon.toFixed(3)}
                  </div>
                </button>
              `,
                  )
                  .join("")
            : "";

    const hasQuery = state.chartLocationSearchQuery.trim().length > 0;
    const statusMessage = state.chartLocationSearchError
        ? `<div class="location-search-error">${escapeHtml(
              state.chartLocationSearchError,
          )}</div>`
        : state.chartLocationSearchLoading
          ? `<div class="location-search-status">Searching...</div>`
          : state.chartLocationSearchResults.length === 0 && hasQuery
            ? `<div class="location-search-status">No places found. Try refining your query.</div>`
            : "";

    return `
      <div class="custom-select-extra" data-role="chart-location-search">
        <div class="location-search-row">
          <input
            type="text"
            class="location-search-input"
            value="${escapeHtml(state.chartLocationSearchQuery)}"
            placeholder="Search a place (e.g. Aachen)"
            data-role="location-search-input"
          />
        </div>
        ${statusMessage}
        <div class="location-search-results" data-role="location-search-results">
          ${results || ""}
        </div>
      </div>
    `;
}

/** Get the effective state for a window (1 = main, 2 = split pane 2). */
function getWindowState(window: 1 | 2) {
    return window === 2 ? state.window2 : state;
}

function getModeMasks(ms: AppState | Window2State): MaskArray {
    return ms.mode === "Explore" ? ms.exploreMasks : ms.mode === "Compare" ? ms.compareMasks : ms.ensembleMasks;
}

function getCurrentDateForMode(state: AppState | Window2State): string {
    switch (state.mode) {
        case "Ensemble":
            return state.ensembleDate;
        case "Compare":
            return state.date; // Compare mode uses the main date field
        case "Explore":
        default:
            return state.date;
    }
}

function renderMapSearchBar(window: 1 | 2 = 1) {
    const s = getWindowState(window);
    if (s.canvasView !== "map") return "";
    const dataWindow = window === 2 ? ' data-window="2"' : "";
    const results =
        s.mapLocationSearchResults.length > 0
            ? s.mapLocationSearchResults
                  .map(
                      (res) => `
                <button
                  type="button"
                  class="location-search-result"
                  data-role="map-location-search-result"
                  data-name="${escapeHtml(res.displayName)}"
                  data-lat="${res.lat}"
                  data-lon="${res.lon}"
                  ${dataWindow}
                >
                  <div class="location-search-result-name">${escapeHtml(
                      res.displayName,
                  )}</div>
                  <div class="location-search-result-coord">
                    ${res.lat.toFixed(3)}, ${res.lon.toFixed(3)}
                  </div>
                </button>
              `,
                  )
                  .join("")
            : "";

    const hasQuery = s.mapLocationSearchQuery.trim().length > 0;
    const statusMessage = s.mapLocationSearchError
        ? `<div class="location-search-error">${escapeHtml(
              s.mapLocationSearchError,
          )}</div>`
        : s.mapLocationSearchLoading
          ? `<div class="location-search-status">Searching...</div>`
          : s.mapLocationSearchResults.length === 0 &&
              hasQuery &&
              !s.mapLocationSearchSelection
            ? `<div class="location-search-status">No places found. Try refining your query.</div>`
            : "";

    const showResultsPanel = Boolean(
        results || (statusMessage && !s.mapLocationSearchLoading),
    );
    // In split view each pane has its own search bar and sidebar.
    const shift = (!state.splitView && state.sidebarOpen) ? -SIDEBAR_WIDTH / 2 : 0;
    const wrapStyle = mergeStyles(styles.mapSearchWrap, {
        top: 18,
        transform: `translateX(calc(-50% + ${shift}px))`,
    });

    return `
      <div data-role="map-location-search" data-window="${window}" style="${styleAttr(wrapStyle)}">
        <div class="location-search-row" style="display: flex; align-items: center; gap: 8px; position: relative;">
          <input
            type="text"
            class="location-search-input"
            value="${escapeHtml(s.mapLocationSearchQuery)}"
            placeholder="Search a place"
            data-role="map-location-search-input"
            data-window="${window}"
            style="flex: 1;"
          />
          <button
            type="button"
            data-action="toggle-map-draw"
            data-window="${window}"
            aria-label="${s.drawState.active ? "Stop drawing" : "Start drawing"}"
            class="map-icon-btn${s.drawState.active ? ' map-icon-btn--active-green' : ''}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          ${(s.mapPolygon !== null && s.mapPolygon.length >= 3) || s.drawState.active ? `
          <button
            type="button"
            data-action="clear-map-draw"
            data-window="${window}"
            aria-label="Clear drawn selection"
            title="Clear drawn selection"
            class="map-icon-btn map-icon-btn--active-green"
            style="color:#f87171;background:rgba(239,68,68,0.10);border-color:rgba(239,68,68,0.3);"
            onmouseover="this.style.background='rgba(239,68,68,0.22)';"
            onmouseout="this.style.background='rgba(239,68,68,0.10)';"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>` : ""}
          <button
            type="button"
            data-action="toggle-map-options-menu"
            data-window="${window}"
            aria-label="Map options"
            aria-expanded="${s.mapOptionsOpen ? "true" : "false"}"
            class="map-icon-btn${s.mapOptionsOpen ? ' map-icon-btn--active-blue' : ''}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"></path>
              <path d="M7 12h14"></path>
              <path d="M11 18h10"></path>
              <path d="M5 6l0 0"></path>
              <circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none"></circle>
              <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"></circle>
              <circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none"></circle>
            </svg>
          </button>
          ${
              s.mapOptionsOpen
                  ? `
          <div
            data-role="map-options-menu"
            class="map-options-menu"
          >
            <div style="font-size: 11px; letter-spacing: 0.45px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px;">
              Map options
            </div>
            <label style="display:flex; align-items:center; gap:8px; padding:6px 4px; cursor:pointer; color:var(--text-primary); font-size:13px; font-weight:600;">
              <input type="checkbox" data-action="toggle-map-borders" data-window="${window}" ${s.mapShowBorders ? "checked" : ""} />
              Show borders
            </label>
            <label style="display:flex; align-items:center; gap:8px; padding:6px 4px; cursor:pointer; color:var(--text-primary); font-size:13px; font-weight:600;">
              <input type="checkbox" data-action="toggle-map-cities" data-window="${window}" ${s.mapShowCities ? "checked" : ""} />
              Show city names
            </label>
          </div>`
                  : ""
          }
          ${!state.splitView && window === 1 ? `
          <button
            type="button"
            data-action="toggle-split-view"
            aria-label="Add second view"
            title="Add second view"
            class="map-icon-btn"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="12" y1="3" x2="12" y2="21"/>
              <line x1="12" y1="12" x2="21" y2="12"/>
              <line x1="15" y1="9" x2="18" y2="12" stroke-width="1.5"/>
              <line x1="15" y1="15" x2="18" y2="12" stroke-width="1.5"/>
            </svg>
          </button>` : ""}
        </div>
        ${s.mapLocationSearchLoading ? statusMessage : ""}
        ${
            showResultsPanel
                ? `
        ${!state.mapLocationSearchLoading ? statusMessage : ""}
        <div
          class="location-search-results"
          data-role="map-location-search-results"
          style="${styleAttr(styles.mapSearchResults)}"
        >
          ${results || ""}
        </div>`
                : ""
        }
      </div>
    `;
}

function renderChartSection() {
    console.log("Rendering chart section with state:", state);
    const chartModeIndicatorTransform =
        state.chartMode === "single" ? "translateX(0%)" : "translateX(100%)";
    const availableScenarios = state.metaData?.scenarios?.length
        ? Array.from(
              new Set(state.metaData.scenarios.map(normalizeScenarioLabel)),
          )
        : scenarios;
    const availableModels = state.metaData?.models?.length
        ? state.metaData.models
        : models;
    const commonRange = intersectScenarioRange(
        state.chartScenarios.length ? state.chartScenarios : availableScenarios,
    );

    const renderCollapsible = (
        label: string,
        open: boolean,
        countLabel: string,
        content: string,
        dataKey: string,
    ) => {
        return `
          <div style="${styleAttr({
              border: "1px solid var(--border-medium)",
              borderRadius: 12,
              background: "var(--bg-subtle)",
              padding: "10px 12px",
          })}">
            <button
              type="button"
              data-action="toggle-collapse"
              data-key="${dataKey}"
              style="${styleAttr({
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
              })}"
            >
              <span>${label}</span>
              <span style="${styleAttr({
                  color: "var(--text-secondary)",
                  fontWeight: 600,
                  fontSize: 12,
              })}">${countLabel} ${open ? "▴" : "▾"}</span>
            </button>
            ${
                open
                    ? `<div style="${styleAttr({
                          marginTop: 10,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                      })}">${content}</div>`
                    : ""
            }
          </div>
        `;
    };

    const singleContent = `
      <div style="${styleAttr(styles.paramGrid)}">
        ${renderField(
            "Date",
            renderInput("chartDate", state.chartDate, {
                dataKey: "chartDate",
                min: commonRange.start,
                max: commonRange.end,
            }),
        )}
        ${renderField(
            "Variable",
            renderSelect("chartVariable", variables, state.chartVariable, {
                dataKey: "chartVariable",
                infoType: "variable",
            }),
        )}
      </div>
    
      <div style="margin-top:10px">
        ${renderField(
            "Location",
            renderSelect(
                "chartLocation",
                ["World", "Draw", "Point"],
                state.chartLocation,
                {
                    dataKey: "chartLocation",
                    selectedLabel:
                        state.chartLocation === "Search" &&
                        state.chartLocationName
                            ? `Search: ${state.chartLocationName}`
                            : state.chartLocation,
                    extraContent: renderChartLocationExtras(),
                },
            ),
        )}
      </div>

      <div style="margin-top:14px">
        ${renderCollapsible(
            "Scenarios",
            state.chartDropdown.scenariosOpen,
            `${state.chartScenarios.length} selected`,
            renderChipGroup(
                availableScenarios,
                state.chartScenarios,
                "chartScenarios",
            ),
            "chartScenarios",
        )}
      </div>

      <div style="margin-top:14px">
        ${renderCollapsible(
            "Models",
            state.chartDropdown.modelsOpen,
            `${state.chartModels.length} selected`,
            renderChipGroup(availableModels, state.chartModels, "chartModels"),
            "chartModels",
        )}
      </div>

      <div style="margin-top:14px">
        <div style="${styleAttr(styles.sectionTitle)}">Unit</div>
        ${renderField(
            "",
            renderSelect(
                "chartUnit",
                getUnitOptions(state.chartVariable).map((opt) => opt.label),
                state.chartUnit,
                { dataKey: "chartUnit" },
            ),
        )}
      </div>
    `;

    const rangeContent = `
      <div style="${styleAttr(styles.paramGrid)}">
        ${renderField(
            "Start date",
            renderInput("chartRangeStart", state.chartRangeStart, {
                dataKey: "chartRangeStart",
                min: commonRange.start,
                max: commonRange.end,
            }),
        )}
        ${renderField(
            "End date",
            renderInput("chartRangeEnd", state.chartRangeEnd, {
                dataKey: "chartRangeEnd",
                min: commonRange.start,
                max: commonRange.end,
            }),
        )}
      </div>

      <div style="${styleAttr(
          mergeStyles(styles.paramGrid, { marginTop: 12 }),
      )}">
        ${renderField(
            "Variable",
            renderSelect("chartVariable", variables, state.chartVariable, {
                dataKey: "chartVariable",
                infoType: "variable",
            }),
        )}
      </div>

      <div style="margin-top:10px">
        ${renderField(
            "Location",
            renderSelect(
                "chartLocation",
                ["World", "Draw", "Point"],
                state.chartLocation,
                {
                    dataKey: "chartLocation",
                    selectedLabel:
                        state.chartLocation === "Search" &&
                        state.chartLocationName
                            ? `Search: ${state.chartLocationName}`
                            : state.chartLocation,
                    extraContent: renderChartLocationExtras(),
                },
            ),
        )}
      </div>

      <div style="margin-top:14px">
        ${renderCollapsible(
            "Scenarios",
            state.chartDropdown.scenariosOpen,
            `${state.chartScenarios.length} selected`,
            renderChipGroup(
                availableScenarios,
                state.chartScenarios,
                "chartScenarios",
            ),
            "chartScenarios",
        )}
      </div>

      <div style="margin-top:14px">
        ${renderCollapsible(
            "Models",
            state.chartDropdown.modelsOpen,
            `${state.chartModels.length} selected`,
            renderChipGroup(availableModels, state.chartModels, "chartModels"),
            "chartModels",
        )}
      </div>

      <div style="margin-top:14px">
        <div style="${styleAttr(styles.sectionTitle)}">Unit</div>
        ${renderField(
            "",
            renderSelect(
                "chartUnit",
                getUnitOptions(state.chartVariable).map((opt) => opt.label),
                state.chartUnit,
                { dataKey: "chartUnit" },
            ),
        )}
      </div>
    `;

    return `
      <div style="${styleAttr(styles.modeSwitch)}">
        <div data-role="chart-mode-indicator" style="${styleAttr({
            ...styles.modeIndicator,
            transform: chartModeIndicatorTransform,
        })}"></div>
        ${(["single", "range"] as const)
            .map((value) => {
                const label = value === "single" ? "Single dates" : "Range";
                return `
              <button
                type="button"
                class="mode-btn"
                data-action="set-chart-mode"
                data-value="${value}"
                style="${styleAttr(
                    mergeStyles(
                        styles.modeBtn,
                        state.chartMode === value
                            ? styles.modeBtnActive
                            : undefined,
                    ),
                )}"
              >
                ${label}
              </button>
            `;
            })
            .join("")}
      </div>

      <div class="mode-pane-scrollable" style="${styleAttr(styles.modePane)}">
        ${state.chartMode === "single" ? singleContent : rangeContent}
      </div>
    `;
}

function renderChatSectionWrapper() {
    return `
    <div data-role="chat-section" style="${styleAttr({
        display: "flex",
        flexDirection: "column",
        gap: 8,
    })}">
      <div style="${styleAttr(styles.sectionTitle)}">Chat</div>
      ${renderChatSection(
          state.chatMessages,
          state.chatInput,
          state.chatIsLoading,
          false,
          state.selectedChatModel,
      )}
    </div>
  `;
}

function clampOffsetToRadius(dx: number, dy: number, limit: number) {
    const distance = Math.hypot(dx, dy);
    if (!distance || !isFinite(distance) || limit <= 0) {
        return { x: 0, y: 0 };
    }
    const scale = Math.min(1, limit / distance);
    return { x: dx * scale, y: dy * scale };
}

function setupBrandEyeTracking(root: HTMLElement) {
    if (cleanupBrandEyeTracking) {
        cleanupBrandEyeTracking();
        cleanupBrandEyeTracking = null;
    }
    if (brandEyeFrame !== null) {
        cancelAnimationFrame(brandEyeFrame);
        brandEyeFrame = null;
    }
    if (brandBlinkFrame !== null) {
        cancelAnimationFrame(brandBlinkFrame);
        brandBlinkFrame = null;
    }
    if (brandBlinkTimeout !== null) {
        clearTimeout(brandBlinkTimeout);
        brandBlinkTimeout = null;
    }
    if (brandEyeIdleTimeout !== null) {
        clearTimeout(brandEyeIdleTimeout);
        brandEyeIdleTimeout = null;
    }

    const brandEye = root.querySelector<HTMLElement>('[data-role="brand-eye"]');
    if (!brandEye) return;

    let targetIris = { x: 0, y: 0 };
    let targetPupil = { x: 0, y: 0 };
    let currentIris = { x: 0, y: 0 };
    let currentPupil = { x: 0, y: 0 };
    let blinkOpen = 1;
    let blinking = false;
    const idleDelayMs = 30000;

    const updateTargets = (clientX: number, clientY: number) => {
        const rect = brandEye.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const base = Math.min(rect.width, rect.height);
        const irisLimit = base * 0.14;
        const pupilLimit = irisLimit * 0.6;
        targetIris = clampOffsetToRadius(dx, dy, irisLimit);
        targetPupil = clampOffsetToRadius(dx, dy, pupilLimit);
    };

    const setBlinkValue = (value: number) => {
        blinkOpen = Math.max(0, Math.min(1, value));
        brandEye.style.setProperty("--blink-open", `${blinkOpen}`);
    };

    const resetIdleTimer = () => {
        if (brandEyeIdleTimeout !== null) {
            clearTimeout(brandEyeIdleTimeout);
        }
        brandEyeIdleTimeout = window.setTimeout(() => {
            targetIris = { x: 0, y: 0 };
            targetPupil = { x: 0, y: 0 };
        }, idleDelayMs);
    };

    const tick = () => {
        currentIris.x += (targetIris.x - currentIris.x) * 0.28;
        currentIris.y += (targetIris.y - currentIris.y) * 0.28;
        currentPupil.x += (targetPupil.x - currentPupil.x) * 0.32;
        currentPupil.y += (targetPupil.y - currentPupil.y) * 0.32;

        brandEye.style.setProperty("--iris-x", `${currentIris.x}px`);
        brandEye.style.setProperty("--iris-y", `${currentIris.y}px`);
        brandEye.style.setProperty("--pupil-x", `${currentPupil.x}px`);
        brandEye.style.setProperty("--pupil-y", `${currentPupil.y}px`);

        brandEyeFrame = requestAnimationFrame(tick);
    };

    const animateBlink = () => {
        if (blinking) return;
        blinking = true;
        const keyframes = [
            { t: 0, v: 1 },
            { t: 0.16, v: 0.08 },
            { t: 0.26, v: 0.02 },
            { t: 0.4, v: 1 },
        ];
        const duration = 350; // ms
        const start = performance.now();

        const run = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(1, elapsed / duration);

            let lower = keyframes[0];
            let upper = keyframes[keyframes.length - 1];
            for (let i = 0; i < keyframes.length - 1; i++) {
                const a = keyframes[i];
                const b = keyframes[i + 1];
                if (progress >= a.t && progress <= b.t) {
                    lower = a;
                    upper = b;
                    break;
                }
            }

            const localRange = upper.t - lower.t || 1;
            const localT = Math.min(
                1,
                Math.max(0, (progress - lower.t) / localRange),
            );
            const eased = 1 - Math.pow(1 - localT, 2); // ease-out
            const value = lower.v + (upper.v - lower.v) * eased;
            setBlinkValue(value);

            if (progress < 1) {
                brandBlinkFrame = requestAnimationFrame(run);
            } else {
                setBlinkValue(1);
                blinking = false;
                scheduleNextBlink();
            }
        };

        brandBlinkFrame = requestAnimationFrame(run);
    };

    const scheduleNextBlink = () => {
        const delay = 3000 + Math.random() * 15000; // 5-20s
        brandBlinkTimeout = window.setTimeout(animateBlink, delay);
    };

    const recenter = () => {
        const rect = brandEye.getBoundingClientRect();
        updateTargets(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    const handlePointerMove = (event: PointerEvent) => {
        updateTargets(event.clientX, event.clientY);
        resetIdleTimer();
    };
    const handlePointerLeave = () => recenter();

    recenter();
    tick();
    scheduleNextBlink();
    resetIdleTimer();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);

    cleanupBrandEyeTracking = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerleave", handlePointerLeave);
        if (brandEyeFrame !== null) {
            cancelAnimationFrame(brandEyeFrame);
            brandEyeFrame = null;
        }
        if (brandBlinkFrame !== null) {
            cancelAnimationFrame(brandBlinkFrame);
            brandBlinkFrame = null;
        }
        if (brandBlinkTimeout !== null) {
            clearTimeout(brandBlinkTimeout);
            brandBlinkTimeout = null;
        }
        if (brandEyeIdleTimeout !== null) {
            clearTimeout(brandEyeIdleTimeout);
            brandEyeIdleTimeout = null;
        }
    };
}

function attachEventHandlers(_params: { resolutionFill: number }) {
    if (!appRoot) return;
    const root = appRoot;

    // Theme toggle
    const themeBtn = root.querySelector<HTMLButtonElement>('[data-action="toggle-theme"]');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isLight = document.documentElement.dataset.theme === 'light';
            document.documentElement.dataset.theme = isLight ? '' : 'light';
            localStorage.setItem('theme', isLight ? 'dark' : 'light');
            render();
        });
    }

    setupBrandEyeTracking(root);

    // Handle mask inputs FIRST, before other input handlers
    // This ensures mask inputs are handled before any other blur handlers
    const maskBoundInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="update-mask-bound"]',
    );
    maskBoundInputs.forEach((input) => {
        // Mark this input so other handlers can skip it
        (input as any).__isMaskInput = true;

        // Only commit changes on blur or Enter key, not on every input
        const commitMaskChange = (e?: Event) => {
            if (e) {
                e.stopPropagation(); // Prevent event from bubbling up
                e.preventDefault(); // Prevent any default behavior
                e.stopImmediatePropagation(); // Stop all other handlers on this element
            }
            const bound = input.dataset.bound;
            const indexStr = input.dataset.maskIndex;
            if (!bound || indexStr === undefined) return;
            const index = Number.parseInt(indexStr, 10);
            // Route to the correct window's masks based on which sidebar contains this input
            const isW2 = input.closest('[data-window="2"]') !== null;
            const targetMasks = isW2 ? getModeMasks(state.window2) : getModeMasks(state);
            if (
                Number.isNaN(index) ||
                index < 0 ||
                index >= targetMasks.length
            ) {
                return;
            }

            const value = input.value.trim();
            const numValue = value === "" ? null : Number.parseFloat(value);
            if (value === "" || !Number.isNaN(numValue!)) {
                const mask = targetMasks[index];
                let changed = false;
                if (bound === "lower") {
                    if (mask.lowerBound !== numValue) {
                        mask.lowerBound = numValue;
                        mask.lowerEdited = value !== "";
                        changed = true;
                    }
                } else {
                    if (mask.upperBound !== numValue) {
                        mask.upperBound = numValue;
                        mask.upperEdited = value !== "";
                        changed = true;
                    }
                }
                // Don't reload map automatically - user will click Apply button
                // Only re-render the UI, don't trigger any data reloads
                if (changed) {
                    // Set a flag to prevent any reloads during this render
                    (state as any).__updatingMask = true;
                    render();
                    // Clear the flag immediately after render completes
                    // Use setTimeout with 0 delay to ensure it runs after render
                    setTimeout(() => {
                        (state as any).__updatingMask = false;
                    }, 0);
                }
            }
        };

        // Use capture phase and stopImmediatePropagation to ensure this runs first
        input.addEventListener(
            "blur",
            (e) => {
                commitMaskChange(e);
            },
            { capture: true },
        );
        input.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    commitMaskChange(e);
                    input.blur(); // Trigger blur to close any dropdowns
                }
            },
            { capture: true },
        );
    });

    // Handle probability threshold inputs for probability masks
    const maskProbThresholdInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="update-mask-probability-threshold"]',
    );
    maskProbThresholdInputs.forEach((input) => {
        const commitThreshold = (e?: Event) => {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            const indexStr = (input as HTMLElement).dataset.maskIndex;
            if (indexStr === undefined) return;
            const index = Number.parseInt(indexStr, 10);
            const isW2 = input.closest('[data-window="2"]') !== null;
            const targetMasks = isW2 ? getModeMasks(state.window2) : getModeMasks(state);
            if (Number.isNaN(index) || index < 0 || index >= targetMasks.length) return;
            const value = input.value.trim();
            const pct = value === "" ? 50 : Number.parseFloat(value);
            if (!Number.isNaN(pct)) {
                const mask = targetMasks[index];
                const newThreshold = Math.max(0, Math.min(100, pct)) / 100;
                if (mask.probabilityThreshold !== newThreshold) {
                    mask.probabilityThreshold = newThreshold;
                    (state as any).__updatingMask = true;
                    render();
                    setTimeout(() => { (state as any).__updatingMask = false; }, 0);
                }
            }
        };
        input.addEventListener("blur", (e) => commitThreshold(e), { capture: true });
        input.addEventListener("keydown", (e) => {
            if ((e as KeyboardEvent).key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                commitThreshold(e);
                input.blur();
            }
        }, { capture: true });
    });

    attachSidebarHandlers({
        root,
        getSidebarOpen: (w) => (w === "2" ? state.window2.sidebarOpen : state.sidebarOpen),
        setSidebarOpen: (isOpen, w) => {
            if (w === "2") state.window2.sidebarOpen = isOpen;
            else state.sidebarOpen = isOpen;
        },
        onTimeSliderUpdate: (isOpen) => {
            updateTimeSliderPosition(isOpen, SIDEBAR_WIDTH);
        },
        onCanvasToggleUpdate: (right) => {
            // keep charts aligned with toggle; +8 matches previous offset
            const scale = state.sidebarOpen ? 1 : 0.9;
            applyChartLayoutOffset(right + 8, scale);
            updateMapSearchPosition();
            // Shift the W1 range overlay to fill or vacate sidebar space
            const rangeOverlay = appRoot?.querySelector<HTMLElement>('#map-range-overlay');
            if (rangeOverlay) {
                const newRight = state.sidebarOpen ? SIDEBAR_WIDTH : 0;
                rangeOverlay.style.right = `${newRight}px`;
                // Re-render chart body with updated container width,
                // and once more after the CSS transition finishes (220ms)
                const paneWidth = state.splitView ? window.innerWidth * state.splitRatio : window.innerWidth;
                const newContainerWidth = paneWidth - newRight;
                const body = rangeOverlay.querySelector<HTMLElement>('.map-range-body');
                if (body) body.innerHTML = renderMapRangeBody(newContainerWidth);
                setTimeout(() => {
                    const b = rangeOverlay.querySelector<HTMLElement>('.map-range-body');
                    const pw = state.splitView ? window.innerWidth * state.splitRatio : window.innerWidth;
                    if (b) b.innerHTML = renderMapRangeBody(pw - (state.sidebarOpen ? SIDEBAR_WIDTH : 0));
                }, 240);
            }
            // Shift the W2 range overlay when W2 sidebar changes
            if (state.splitView) {
                const rangeOverlayW2 = appRoot?.querySelector<HTMLElement>('#map-range-overlay-w2');
                if (rangeOverlayW2) {
                    const w2NewRight = state.window2.sidebarOpen ? SIDEBAR_WIDTH : 0;
                    rangeOverlayW2.style.right = `${w2NewRight}px`;
                    const pane2Width = window.innerWidth * (1 - state.splitRatio);
                    const w2ContainerWidth = pane2Width - w2NewRight;
                    const bodyW2 = rangeOverlayW2.querySelector<HTMLElement>('.map-range-body-w2');
                    if (bodyW2) bodyW2.innerHTML = renderMapRangeBodyW2(w2ContainerWidth);
                    setTimeout(() => {
                        const b2 = rangeOverlayW2.querySelector<HTMLElement>('.map-range-body-w2');
                        if (b2) b2.innerHTML = renderMapRangeBodyW2(window.innerWidth * (1 - state.splitRatio) - (state.window2.sidebarOpen ? SIDEBAR_WIDTH : 0));
                    }, 240);
                }
            }
        },
    });

    // ── Export / Load state ──────────────────────────────────────
    const SAVEABLE_KEYS: (keyof AppState)[] = [
        "mode", "canvasView", "panelTab",
        "scenario", "model", "variable", "date", "selectedUnit",
        "mapPalette", "mapInfoPalette", "mapRangePalette", "chartPalette",
        "compareMode", "compareScenarioA", "compareScenarioB",
        "compareModelA", "compareModelB", "compareDateStart", "compareDateEnd",
        "ensembleScenarios", "ensembleModels", "ensembleStatistic",
        "ensembleDate", "ensembleVariable", "ensembleUnit",
        "chartMode", "chartDate", "chartRangeStart", "chartRangeEnd",
        "chartVariable", "chartUnit", "chartScenarios", "chartModels",
        "chartLocation", "chartLocationName", "chartPoint",
        "exploreMasks", "compareMasks", "ensembleMasks",
        "mapShowBorders", "mapShowCities",
        "mapPolygon", "chartPolygon", "mapMarker",
        "mapRangeStart", "mapRangeEnd", "mapRangeNumSamples", "mapRangePreset",
        "configDescription",
    ];

    const W2_APPLICABLE_KEYS: (keyof Window2State)[] = [
        "mode", "canvasView", "panelTab", "scenario", "model", "variable", "date",
        "selectedUnit", "mapPalette", "resolution", "mapShowBorders", "mapShowCities",
        "mapPolygon", "mapMarker", "exploreMasks", "compareMasks", "ensembleMasks",
        "compareMode", "compareScenarioA", "compareScenarioB",
        "compareModelA", "compareModelB", "compareDateStart", "compareDateEnd",
        "ensembleScenarios", "ensembleModels", "ensembleStatistic",
        "ensembleDate", "ensembleVariable", "ensembleUnit",
    ];

    function commitConfigDescriptionDraft() {
        const draftTitle = state.configDescriptionDraftTitle?.trim() ?? "";
        const draftBody = state.configDescriptionDraftBody?.trim() ?? "";
        if (!draftTitle && !draftBody) {
            // If there is already a saved description, leave it as-is.
            return;
        }
        const baseTitle =
            draftTitle ||
            state.saveConfigNameDraft.trim() ||
            state.configDescription?.title ||
            "Scenario description";
        state.configDescription = {
            title: baseTitle,
            body: draftBody,
            scenario: state.scenario,
            model: state.model,
            variable: state.variable,
            date: state.date,
            selectedUnit: state.selectedUnit,
            mode: state.mode,
            stateSnapshot: buildDescriptionSnapshotFromState(state),
        };
        // If no explicit config name has been set yet, use the description title
        // so users don't have to type the name twice.
        if (!state.saveConfigNameDraft.trim() && draftTitle) {
            state.saveConfigNameDraft = draftTitle;
        }
    }

    const buildSaveData = () => {
        const saveData: Record<string, any> = { __version: 1 };
        for (const key of SAVEABLE_KEYS) {
            saveData[key] = (state as any)[key];
        }
        // Persist current map pan/zoom for both windows
        saveData._mapTransform   = getMapTransform();
        saveData._w2MapTransform = getW2MapTransform();
        return saveData;
    };

    const applySavedData = (data: Record<string, any>, targetWindow?: "1" | "2") => {
        const target = targetWindow ?? state.loadTargetWindow;

        if (target === "2") {
            // Only clear Window 2's cached tiles when we are actually
            // applying a config to Window 2. Leaving the cache intact
            // keeps panning responsive when loading configs into Window 1.
            clearW2Cache();
            for (const key of W2_APPLICABLE_KEYS) {
                if (key in data) {
                    (state.window2 as any)[key] = data[key];
                }
            }
            state.saveDialogOpen = false;
            state.loadDialogOpen = false;
            state.saveDialogOpenForWindow = null;
            state.loadDialogOpenForWindow = null;
            render();
            loadClimateDataWindow2();
            // Restore map position for window 2
            if (data._w2MapTransform) applyW2MapTransform(data._w2MapTransform);
        } else {
            for (const key of SAVEABLE_KEYS) {
                if (key in data) {
                    (state as any)[key] = data[key];
                }
            }
            state.saveDialogOpen = false;
            state.loadDialogOpen = false;
            state.saveDialogOpenForWindow = null;
            state.loadDialogOpenForWindow = null;
            render();
            if (state.canvasView === "map") {
                loadClimateData();
            } else {
                loadChartData();
            }
            // Restore map position for window 1
            if (data._mapTransform) applyMapTransform(data._mapTransform);
        }
    };

    const exportStateToFile = () => {
        const saveData = buildSaveData();
        const rawName = state.saveConfigNameDraft.trim();
        const normalizedName = rawName
            ? rawName
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, "-")
                  .replace(/^-+|-+$/g, "")
            : "";
        const safeName =
            normalizedName || `polyoracle-${new Date().toISOString().slice(0, 10)}`;
        const blob = new Blob([JSON.stringify(saveData, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        state.saveDialogOpen = false;
        state.saveDialogOpenForWindow = null;
        render();
    };

    const importStateFromFile = () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json,application/json";
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target?.result as string);
                    applySavedData(data);
                } catch {
                    console.error("Failed to parse state file");
                }
            };
            reader.readAsText(file);
        });
        fileInput.click();
    };

    const openSaveBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="open-save-state"]',
    );
    openSaveBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            const w = (btn.dataset.window || "1") as "1" | "2";
            state.loadTargetWindow = w;
            const willOpen = state.saveDialogOpenForWindow !== w;
            state.saveDialogOpenForWindow = willOpen ? w : null;
            state.saveDialogOpen = willOpen;
            state.loadDialogOpenForWindow = null;
            state.loadDialogOpen = false;
            if (willOpen && !state.saveConfigNameDraft.trim()) {
                state.saveConfigNameDraft = `Config ${new Date()
                    .toISOString()
                    .slice(0, 10)}`;
            }
            render();
        }),
    );

    const openLoadBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="open-load-state"]',
    );
    openLoadBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            const w = (btn.dataset.window || "1") as "1" | "2";
            state.loadTargetWindow = w;
            const willOpen = state.loadDialogOpenForWindow !== w;
            state.loadDialogOpenForWindow = willOpen ? w : null;
            state.loadDialogOpen = willOpen;
            state.saveDialogOpenForWindow = null;
            state.saveDialogOpen = false;
            render();
        }),
    );

    const saveDialogCloseBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="close-save-dialog"]',
    );
    saveDialogCloseBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.saveDialogOpen = false;
            state.saveDialogOpenForWindow = null;
            state.loadDialogOpenForWindow = null;
            render();
        }),
    );

    const loadDialogCloseBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="close-load-dialog"]',
    );
    loadDialogCloseBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.loadDialogOpen = false;
            state.loadDialogOpenForWindow = null;
            state.saveDialogOpenForWindow = null;
            render();
        }),
    );

    const saveNameInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="save-config-name-input"]',
    );
    saveNameInputs.forEach((input) => {
        input.addEventListener("input", () => {
            state.saveConfigNameDraft = input.value;
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const trigger = root.querySelector<HTMLButtonElement>(
                    '[data-action="save-config-locally"]',
                );
                trigger?.click();
            }
        });
    });

    const saveConfigLocalBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="save-config-locally"]',
    );
    saveConfigLocalBtns.forEach((btn) =>
        btn.addEventListener("click", async () => {
            commitConfigDescriptionDraft();
            const name = state.saveConfigNameDraft.trim();
            state.saveConfigNameDraft = name;
            if (!name) {
                window.alert("Please enter a scenario name.");
                return;
            }
            // Capture a thumbnail of the current view before closing the dialog
            const thumbnail = captureThumbnailDataUrl();
            const saveData = buildSaveData();
            if (thumbnail) saveData._thumbnail = thumbnail;
            const nextEntry: SavedConfigEntry = {
                name,
                savedAt: new Date().toISOString(),
                data: saveData,
            };
            const existing = getSavedConfigs().filter(
                (entry) => entry.name.toLowerCase() !== name.toLowerCase(),
            );
        setSavedConfigs([nextEntry, ...existing]);
        state.saveDialogOpen = false;
        state.saveDialogOpenForWindow = null;
        render();
        }),
    );

    const exportBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="export-state"]',
    );
    exportBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            commitConfigDescriptionDraft();
            exportStateToFile();
        }),
    );

    const importBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="import-state"]',
    );
    importBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            importStateFromFile();
        }),
    );

    const loadCachedBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="load-cached-config"]',
    );
    loadCachedBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            const encodedName = btn.dataset.configName;
            if (!encodedName) return;
            const name = decodeURIComponent(encodedName);
            const entry = getSavedConfigs().find(
                (saved) => saved.name.toLowerCase() === name.toLowerCase(),
            );
            if (!entry) return;
            applySavedData(entry.data);
        }),
    );

    const openConfigDescriptionEditorBtns =
        root.querySelectorAll<HTMLButtonElement>(
            '[data-action="open-config-description-editor"]',
        );
    openConfigDescriptionEditorBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            const existing = state.configDescription;
            if (existing) {
                state.configDescriptionDraftTitle = existing.title;
                state.configDescriptionDraftBody = existing.body;
            } else {
                if (!state.configDescriptionDraftTitle) {
                    state.configDescriptionDraftTitle = state.saveConfigNameDraft;
                }
            }
            state.configDescriptionEditorOpen = true;
            render();
        }),
    );

    const closeConfigDescriptionEditorBtns =
        root.querySelectorAll<HTMLButtonElement>(
            '[data-action="close-config-description-editor"]',
        );
    closeConfigDescriptionEditorBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.configDescriptionEditorOpen = false;
            render();
        }),
    );

    const configDescriptionTitleInputs =
        root.querySelectorAll<HTMLInputElement>(
            '[data-role="config-description-title-input"]',
        );
    configDescriptionTitleInputs.forEach((input) => {
        input.addEventListener("input", () => {
            state.configDescriptionDraftTitle = input.value;
        });
    });

    const configDescriptionBodyInputs =
        root.querySelectorAll<HTMLTextAreaElement>(
            '[data-role="config-description-body-input"]',
        );
    configDescriptionBodyInputs.forEach((input) => {
        input.addEventListener("input", () => {
            state.configDescriptionDraftBody = input.value;
        });
    });

    const saveConfigDescriptionBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="save-config-description"]',
    );
    saveConfigDescriptionBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            commitConfigDescriptionDraft();
            state.configDescriptionEditorOpen = false;
            render();
        }),
    );

    const deleteCachedBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="delete-cached-config"]',
    );
    deleteCachedBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            const encodedName = btn.dataset.configName;
            if (!encodedName) return;
            const name = decodeURIComponent(encodedName);
            const remaining = getSavedConfigs().filter(
                (entry) => entry.name.toLowerCase() !== name.toLowerCase(),
            );
            setSavedConfigs(remaining);
            state.loadDialogOpen = true;
            render();
        }),
    );

    const openExportBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="open-export"]',
    );
    openExportBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            openExportDialog(state, {
                setAnimationDate: (date: string) => {
                    state.date = date;
                    if (state.splitView) {
                        state.window2.date = date;
                    }
                    render();
                },
                loadData: async () => {
                    if (state.splitView) {
                        await Promise.all([loadClimateData(), loadClimateDataWindow2()]);
                    } else {
                        await loadClimateData();
                    }
                },
                getState: () => state,
            });
        }),
    );
    // ─────────────────────────────────────────────────────────────

    const modeButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-mode"]',
    );
    modeButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const value = btn.dataset.value as Mode | undefined;
            const w = (btn.dataset.window || "1") as "1" | "2";
            if (!value) return;

            const target = w === "2" ? state.window2 : state;
            if (value === target.mode) return;

                const previousMode = target.mode;
                const previousModeTransform =
                    previousMode === "Explore"
                        ? "translateX(0%)"
                        : previousMode === "Compare"
                          ? "translateX(-33.333%)"
                          : "translateX(-66.666%)";
                const previousIndicatorTransform =
                    previousMode === "Explore"
                        ? "translateX(0%)"
                        : previousMode === "Compare"
                          ? "translateX(100%)"
                          : "translateX(200%)";
                const nextModeTransform =
                    value === "Explore"
                        ? "translateX(0%)"
                        : value === "Compare"
                          ? "translateX(-33.333%)"
                          : "translateX(-66.666%)";
                const nextIndicatorTransform =
                    value === "Explore"
                        ? "translateX(0%)"
                        : value === "Compare"
                          ? "translateX(100%)"
                          : "translateX(200%)";

                target.mode = value;

                // When switching to Compare: use current/adjusted date as first, same date +30y as second
                if (value === "Compare") {
                    const baseDate = target.date;
                    target.compareDateStart = clipDateToScenarioRange(
                        baseDate,
                        target.scenario,
                    );
                    target.compareDateEnd = clipDateToScenarioRange(
                        addYearsToDate(baseDate, 30),
                        target.scenario,
                    );
                }
                // When switching to Ensemble: use current/adjusted date (from Explore or last adjusted)
                if (value === "Ensemble") {
                    target.ensembleDate = target.date;
                }

                const tutorialState = getTutorialState();
                if (
                    tutorialState.active &&
                    tutorialState.currentStep === 9 &&
                    value === "Compare"
                ) {
                    completeCurrentStep();
                }

                render();

                const sidebar = w === "2"
                    ? root.querySelector<HTMLElement>('[data-role="sidebar"][data-window="2"]')
                    : null;
                const modeTrack = sidebar
                    ? sidebar.querySelector<HTMLElement>('[data-role="mode-track"]')
                    : root.querySelector<HTMLElement>('[data-role="mode-track"]');
                const modeIndicator = sidebar
                    ? sidebar.querySelector<HTMLElement>('[data-role="mode-indicator"]')
                    : root.querySelector<HTMLElement>('[data-role="mode-indicator"]');

                if (!modeTrack || !modeIndicator) return;

                // Start from the previous position without transition, then animate to the new one
                modeTrack.style.transition = "none";
                modeIndicator.style.transition = "none";
                modeTrack.style.transform = previousModeTransform;
                modeIndicator.style.transform = previousIndicatorTransform;

                // Force reflow so the browser registers the starting transforms
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                modeTrack.offsetHeight;

                modeTrack.style.transition = "transform 220ms ease";
                modeIndicator.style.transition = "transform 200ms ease";
                modeTrack.style.transform = nextModeTransform;
                modeIndicator.style.transform = nextIndicatorTransform;
                if (w === "2" && state.splitView) {
                    loadClimateDataWindow2();
                } else if (state.canvasView === "map") {
                    loadClimateData();
                }
        }),
    );

    const chartModeButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-chart-mode"]',
    );
    chartModeButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const value = btn.dataset.value as ChartMode | undefined;
            if (!value || value === state.chartMode) return;

            const previousMode = state.chartMode;
            const previousTransform =
                previousMode === "single"
                    ? "translateX(0%)"
                    : "translateX(100%)";
            const nextTransform =
                value === "single" ? "translateX(0%)" : "translateX(100%)";

            state.chartMode = value;
            render();

            const indicator = root.querySelector<HTMLElement>(
                '[data-role="chart-mode-indicator"]',
            );
            if (indicator) {
                indicator.style.removeProperty("transition");
                indicator.style.transform = previousTransform;
                void indicator.offsetHeight;
                requestAnimationFrame(() => {
                    indicator.style.transition = "transform 200ms ease";
                    indicator.style.transform = nextTransform;
                });
            }

            if (state.canvasView === "chart") {
                loadChartData();
            }
        }),
    );

    const tabButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-tab"]',
    );
    tabButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const value = btn.dataset.value as PanelTab | undefined;
            const w = (btn.dataset.window || "1") as "1" | "2";
            if (!value) return;

            const target = w === "2" ? state.window2 : state;
            if (value === target.panelTab) return;

            const previousTab = target.panelTab;
            const previousTabTransform =
                previousTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";
            const nextTabTransform =
                value === "Manual" ? "translateX(0%)" : "translateX(-50%)";

            target.panelTab = value;

            if (w === "1") {
                const tutorialState = getTutorialState();
                if (
                    tutorialState.active &&
                    tutorialState.currentStep === 11 &&
                    value === "Chat"
                ) {
                    completeCurrentStep();
                }
            }
            render();

            const sidebar = w === "2"
                ? root.querySelector<HTMLElement>('[data-role="sidebar"][data-window="2"]')
                : null;
            const tabTrack = sidebar
                ? sidebar.querySelector<HTMLElement>('[data-role="tab-track"]')
                : root.querySelector<HTMLElement>('[data-role="tab-track"]');

            if (!tabTrack) return;

            tabTrack.style.removeProperty("transition");
            tabTrack.style.transform = previousTabTransform;

            void tabTrack.offsetHeight;
            void tabTrack.getBoundingClientRect();

            requestAnimationFrame(() => {
                tabTrack.style.transition = "transform 220ms ease";
                tabTrack.style.transform = nextTabTransform;
            });
        }),
    );

    // Custom dropdown handlers
    const customSelectWrappers = root.querySelectorAll<HTMLElement>(
        ".custom-select-wrapper",
    );

    // Create a single shared info panel for all dropdowns
    let sharedInfoPanel: HTMLElement | null =
        document.querySelector<HTMLElement>(".custom-select-info-panel-shared");
    if (!sharedInfoPanel) {
        sharedInfoPanel = document.createElement("div");
        sharedInfoPanel.className =
            "custom-select-info-panel custom-select-info-panel-shared";
        sharedInfoPanel.setAttribute("role", "tooltip");
        document.body.appendChild(sharedInfoPanel);
    }

    // Close all dropdowns when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".custom-select-wrapper")) {
            customSelectWrappers.forEach((wrapper) => {
                wrapper.classList.remove("open");
            });
            if (sharedInfoPanel) {
                sharedInfoPanel.classList.remove("visible");
            }
        }
    };

    // Close dropdowns on Escape key
    const handleEscapeKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            customSelectWrappers.forEach((wrapper) => {
                wrapper.classList.remove("open");
            });
            if (sharedInfoPanel) {
                sharedInfoPanel.classList.remove("visible");
            }
        }
    };

    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscapeKey);

    customSelectWrappers.forEach((wrapper) => {
        const trigger = wrapper.querySelector<HTMLElement>(
            ".custom-select-trigger",
        );
        const dropdown = wrapper.querySelector<HTMLElement>(
            ".custom-select-dropdown",
        );
        const options = wrapper.querySelectorAll<HTMLElement>(
            ".custom-select-option",
        );
        const dataKey = wrapper.dataset.key;
        const infoType = wrapper.dataset.infoType as
            | "scenario"
            | "variable"
            | undefined;
        const isDisabled = wrapper.dataset.disabled === "true";

        if (!trigger || !dropdown || isDisabled) return;

        // Use the shared info panel
        const infoPanel = sharedInfoPanel;

        // Function to show info
        const showInfo = (value: string, optionElement?: HTMLElement) => {
            if (!infoPanel || !infoType) return;

            let infoText = "";
            let title = value;

            if (infoType === "scenario") {
                infoText = scenarioInfo[value] || "";
            } else if (infoType === "variable") {
                infoText = variableInfo[value] || "";
                title = variableFullNames[value] || value;
            } else if (infoType === "model") {
                infoText = modelInfo[value] || "";
            }

            if (infoText) {
                infoPanel.innerHTML = `
                    <div class="custom-select-info-panel-title">${title}</div>
                    <div class="custom-select-info-panel-content">${infoText}</div>
                `;

                // Position the panel using fixed positioning - no gap between dropdown and panel
                if (optionElement || trigger) {
                    const referenceElement = optionElement || trigger;
                    if (referenceElement) {
                        const rect = referenceElement.getBoundingClientRect();
                        infoPanel.style.left = `${rect.left - 272}px`;
                        infoPanel.style.top = `${rect.top}px`;
                    }
                }

                infoPanel.classList.add("visible");
            }
        };

        // Function to hide info
        const hideInfo = () => {
            if (infoPanel) {
                infoPanel.classList.remove("visible");
            }
        };

        // Toggle dropdown on trigger click
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isDisabled) return;

            const isOpen = wrapper.classList.contains("open");
            // Close all other dropdowns
            customSelectWrappers.forEach((w) => {
                if (w !== wrapper) w.classList.remove("open");
            });
            // Toggle this dropdown
            wrapper.classList.toggle("open", !isOpen);

            // If tutorial is active, re-render after dropdown opens to expand backdrop cutout
            const tutorialState = getTutorialState();
            if (tutorialState.active) {
                setTimeout(() => {
                    render();
                }, 50);
            }
        });

        // Keyboard navigation for trigger
        trigger.addEventListener("keydown", (e) => {
            if (isDisabled) return;

            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                e.preventDefault();
                wrapper.classList.add("open");
                // Focus first option
                const firstOption = options[0] as HTMLElement;
                if (firstOption) firstOption.focus();
            }
        });

        // Handle option clicks
        options.forEach((option) => {
            option.addEventListener("click", (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                if (!value || !dataKey) return;

                // Update selected state
                options.forEach((opt) => {
                    opt.classList.remove("selected");
                    opt.removeAttribute("aria-selected");
                });
                option.classList.add("selected");
                option.setAttribute("aria-selected", "true");

                // Update trigger value
                const valueSpan = trigger.querySelector<HTMLElement>(
                    ".custom-select-value",
                );
                if (valueSpan) valueSpan.textContent = value;

                // Close dropdown
                wrapper.classList.remove("open");
                hideInfo();

                // Get mask index from wrapper if it's a mask statistic selector
                const maskIndex = wrapper.dataset.maskIndex;
                const dataWindow = (wrapper.dataset.window || option.dataset.window || "1") as "1" | "2";

                // Trigger the change handler
                handleSelectChange(dataKey, value, maskIndex, dataWindow);

                // Handle tutorial progression - detect when a selection is made during tutorial
                const tutorialState = getTutorialState();
                if (tutorialState.active) {
                    // Map tutorial steps to their data keys
                    // Step 1: scenario, Step 2: model, Step 4: unit, Step 5: palette
                    const stepToKey: { [key: number]: string } = {
                        1: "scenario",
                        2: "model",
                        4: "variable",
                        5: "unit",
                        6: "mapPalette",
                    };

                    // If this selection matches the current tutorial step's expected data key
                    if (stepToKey[tutorialState.currentStep] === dataKey) {
                        // Small delay to ensure the selection is processed first
                        setTimeout(() => {
                            completeCurrentStep();
                            render();
                        }, 100);
                    }
                }
            });

            // Show info on hover
            if (infoType) {
                option.addEventListener("mouseenter", () => {
                    const value = option.dataset.value;
                    if (value) {
                        showInfo(value, option);
                    }
                });

                option.addEventListener("mouseleave", () => {
                    hideInfo();
                });
            }

            // Keyboard navigation for options
            option.addEventListener("keydown", (e) => {
                const currentIndex = Array.from(options).indexOf(option);

                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    option.click();
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const nextIndex = (currentIndex + 1) % options.length;
                    (options[nextIndex] as HTMLElement)?.focus();
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prevIndex =
                        currentIndex === 0
                            ? options.length - 1
                            : currentIndex - 1;
                    (options[prevIndex] as HTMLElement)?.focus();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    wrapper.classList.remove("open");
                    hideInfo();
                    trigger.focus();
                } else if (e.key === "Home") {
                    e.preventDefault();
                    (options[0] as HTMLElement)?.focus();
                } else if (e.key === "End") {
                    e.preventDefault();
                    (options[options.length - 1] as HTMLElement)?.focus();
                }
            });
        });

        // Hide info when dropdown closes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "class"
                ) {
                    if (!wrapper.classList.contains("open")) {
                        hideInfo();
                    }
                }
            });
        });
        observer.observe(wrapper, { attributes: true });
    });

    // Handle select change (reusable function)
    const handleSelectChange = async (
        key: string,
        val: string,
        maskIndex?: string,
        dataWindow?: "1" | "2",
    ) => {
        if (!key) return;
        const w = dataWindow || "1";
        const target = w === "2" ? state.window2 : state;
        let triggerMapReload = false;
        let triggerChartReload = false;
        switch (key) {
            case "scenario":
                target.scenario = val;
                target.date = getDateForScenario(val);
                target.timeRange = getTimeRangeForScenario(val);
                if (w === "1") state.ensembleDate = state.date;
                else state.window2.ensembleDate = state.window2.date;
                triggerMapReload = true;
                break;
            case "model":
                target.model = val;
                triggerMapReload = true;
                break;
            case "variable":
                target.variable = val;
                target.selectedUnit = getDefaultUnitOption(val).label;
                target.legendPinned = false;
                target.legendPinnedMin = null;
                target.legendPinnedMax = null;
                if (legendPinTooltipOpen === w) legendPinTooltipOpen = null;
                triggerMapReload = true;
                break;
            case "unit":
                target.selectedUnit = val;
                if (w === "2") {
                    render();
                    if (state.splitView) loadClimateDataWindow2();
                    return;
                }
                render();
                // Re-render map with new unit conversion
                if (
                    state.currentData &&
                    appRoot &&
                    state.dataMin !== null &&
                    state.dataMax !== null
                ) {
                    const canvas =
                        appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
                    if (canvas) {
                        try {
                            mapCanvas = canvas;
                            applyMapInteractions(canvas);
                            renderMapData(
                                state.currentData,
                                mapCanvas,
                                paletteOptions,
                                state.mapPalette,
                                state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
                                state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
                                state.variable,
                                state.selectedUnit,
                                getModeMasks(state),
                                null,
                                false,
                                (state.mode === "Explore" || state.mode === "Compare")
                                    ? state.maskVariableData
                                    : undefined,
                            );
                            const palette =
                                paletteOptions.find(
                                    (p) => p.name === state.mapPalette,
                                ) || paletteOptions[0];
                            drawLegendGradient(
                                "legend-gradient-canvas",
                                palette.colors,
                            );
                        } catch (e) {
                            console.error(
                                "Map redraw (unit change) failed:",
                                e,
                            );
                        }
                    }
                }
                if (state.mapMarker) {
                    if (state.mapInfoOpen) {
                        if (state.mapInfoSamples.length) {
                            const { variable, unit } = getActiveMapVariable();
                            state.mapInfoBoxes = buildChartBoxes(
                                state.mapInfoSamples,
                                variable,
                                unit,
                            );
                            render();
                        } else if (!state.mapInfoLoading) {
                            void loadMapInfoData();
                        }
                    }
                    if (state.mapRangeOpen) {
                        if (state.mapRangeSamples.length) {
                            const { variable, unit } = getMapRangeVariable();
                            state.mapRangeSeries = buildChartRangeSeries(
                                state.mapRangeSamples,
                                variable,
                                unit,
                            );
                            render();
                        } else if (!state.mapRangeLoading) {
                            void loadMapRangeData();
                        }
                    }
                }
                return;
            case "mapPalette":
                state.mapPalette = val;
                render();
                if (
                    state.canvasView === "map" &&
                    state.currentData &&
                    appRoot &&
                    state.dataMin !== null &&
                    state.dataMax !== null
                ) {
                    const canvas =
                        appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
                    if (canvas) {
                        mapCanvas = canvas;
                        renderMapData(
                            state.currentData,
                            mapCanvas,
                            paletteOptions,
                            state.mapPalette,
                            state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
                            state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
                            state.mode === "Ensemble" ? state.ensembleVariable : state.variable,
                            state.mode === "Ensemble" ? state.ensembleUnit : state.selectedUnit,
                            getModeMasks(state),
                            state.mode === "Ensemble" ? state.ensembleStatistics : null,
                            state.mode === "Ensemble",
                            (state.mode === "Explore" || state.mode === "Compare")
                                ? state.maskVariableData
                                : undefined,
                            state.mode === "Ensemble" ? state.ensembleStatisticsByVariable : null,
                            state.mode === "Ensemble" ? state.ensembleRawSamplesByVariable : null,
                        );

                        // Redraw gradient with new palette
                        const palette =
                            paletteOptions.find(
                                (p) => p.name === state.mapPalette,
                            ) || paletteOptions[0];
                        drawLegendGradient(
                            "legend-gradient-canvas",
                            palette.colors,
                        );
                    }
                }
                return;
            case "mapInfoPalette":
                state.mapInfoPalette = val;
                render();
                return;
            case "mapRangePalette":
                state.mapRangePalette = val;
                render();
                return;
            case "chartPalette":
                state.chartPalette = val;
                render();
                return;
            case "w2mapPalette":
                state.window2.mapPalette = val;
                render();
                if (
                    state.window2.canvasView === "map" &&
                    state.window2.currentData &&
                    persistentCanvas2 &&
                    state.window2.dataMin !== null &&
                    state.window2.dataMax !== null
                ) {
                    const w2IsEnsemble = state.window2.mode === "Ensemble";
                    const w2DisplayVar = w2IsEnsemble ? state.window2.ensembleVariable : state.window2.variable;
                    const w2DisplayUnit = w2IsEnsemble ? state.window2.ensembleUnit : state.window2.selectedUnit;
                    renderMapDataWindow2(
                        state.window2.currentData,
                        persistentCanvas2,
                        paletteOptions,
                        state.window2.mapPalette,
                        state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                        state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                        w2DisplayVar,
                        w2DisplayUnit,
                        getModeMasks(state.window2) && getModeMasks(state.window2).length > 0
                            ? getModeMasks(state.window2)
                            : undefined,
                        w2IsEnsemble ? state.window2.ensembleStatistics ?? undefined : undefined,
                        w2IsEnsemble,
                        state.window2.maskVariableData.size > 0
                            ? state.window2.maskVariableData
                            : undefined,
                        w2IsEnsemble ? state.window2.ensembleStatisticsByVariable : undefined,
                        w2IsEnsemble ? state.window2.ensembleRawSamplesByVariable : undefined,
                    );
                    const w2Pal =
                        paletteOptions.find((p) => p.name === state.window2.mapPalette) ||
                        paletteOptions[0];
                    drawLegendGradient("legend-gradient-canvas-w2", w2Pal.colors);
                }
                return;
            case "w2unit":
                state.window2.selectedUnit = val;
                render();
                if (
                    state.window2.canvasView === "map" &&
                    state.window2.currentData &&
                    persistentCanvas2 &&
                    state.window2.dataMin !== null &&
                    state.window2.dataMax !== null
                ) {
                    const w2IsEnsemble = state.window2.mode === "Ensemble";
                    const w2DisplayVar = w2IsEnsemble ? state.window2.ensembleVariable : state.window2.variable;
                    const w2DisplayUnit = w2IsEnsemble ? state.window2.ensembleUnit : state.window2.selectedUnit;
                    renderMapDataWindow2(
                        state.window2.currentData,
                        persistentCanvas2,
                        paletteOptions,
                        state.window2.mapPalette,
                        state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                        state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                        w2DisplayVar,
                        w2DisplayUnit,
                        getModeMasks(state.window2) && getModeMasks(state.window2).length > 0
                            ? getModeMasks(state.window2)
                            : undefined,
                        w2IsEnsemble ? state.window2.ensembleStatistics ?? undefined : undefined,
                        w2IsEnsemble,
                        state.window2.maskVariableData.size > 0
                            ? state.window2.maskVariableData
                            : undefined,
                        w2IsEnsemble ? state.window2.ensembleStatisticsByVariable : undefined,
                        w2IsEnsemble ? state.window2.ensembleRawSamplesByVariable : undefined,
                    );
                    setupWindow2Interactions(persistentCanvas2, w2DisplayUnit ?? "", {
                        onMapClick: (coords) => void handleMapClickW2(coords),
                        onTransform: renderMapMarkerPositionW2,
                    });
                }
                if (state.window2.mapMarker) {
                    if (state.window2.mapInfoOpen) {
                        if (state.window2.mapInfoSamples.length) {
                            const { variable, unit } = getActiveMapVariableW2();
                            state.window2.mapInfoBoxes = buildChartBoxes(state.window2.mapInfoSamples, variable, unit);
                            render();
                        } else if (!state.window2.mapInfoLoading) {
                            void loadMapInfoDataW2();
                        }
                    }
                    if (state.window2.mapRangeOpen) {
                        if (state.window2.mapRangeSamples.length) {
                            const { variable, unit } = getActiveMapVariableW2();
                            state.window2.mapRangeSeries = buildChartRangeSeries(state.window2.mapRangeSamples, variable, unit);
                            render();
                        } else if (!state.window2.mapRangeLoading) {
                            void loadMapRangeDataW2();
                        }
                    }
                }
                return;
            case "w2ensembleUnit":
                state.window2.ensembleUnit = val;
                render();
                if (
                    state.window2.canvasView === "map" &&
                    state.window2.currentData &&
                    persistentCanvas2 &&
                    state.window2.dataMin !== null &&
                    state.window2.dataMax !== null &&
                    state.window2.mode === "Ensemble"
                ) {
                    renderMapDataWindow2(
                        state.window2.currentData,
                        persistentCanvas2,
                        paletteOptions,
                        state.window2.mapPalette,
                        state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                        state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                        state.window2.ensembleVariable,
                        state.window2.ensembleUnit,
                        getModeMasks(state.window2) && getModeMasks(state.window2).length > 0
                            ? getModeMasks(state.window2)
                            : undefined,
                        state.window2.ensembleStatistics ?? undefined,
                        true,
                        state.window2.maskVariableData.size > 0
                            ? state.window2.maskVariableData
                            : undefined,
                        state.window2.ensembleStatisticsByVariable,
                        state.window2.ensembleRawSamplesByVariable,
                    );
                    const w2Pal =
                        paletteOptions.find((p) => p.name === state.window2.mapPalette) ||
                        paletteOptions[0];
                    drawLegendGradient("legend-gradient-canvas-w2", w2Pal.colors);
                    setupWindow2Interactions(persistentCanvas2, val ?? "", {
                        onMapClick: (coords) => void handleMapClickW2(coords),
                        onTransform: renderMapMarkerPositionW2,
                    });
                }
                if (state.window2.mapMarker) {
                    if (state.window2.mapInfoOpen) {
                        if (state.window2.mapInfoSamples.length) {
                            const { variable, unit } = getActiveMapVariableW2();
                            state.window2.mapInfoBoxes = buildChartBoxes(state.window2.mapInfoSamples, variable, unit);
                            render();
                        } else if (!state.window2.mapInfoLoading) {
                            void loadMapInfoDataW2();
                        }
                    }
                    if (state.window2.mapRangeOpen) {
                        if (state.window2.mapRangeSamples.length) {
                            const { variable, unit } = getActiveMapVariableW2();
                            state.window2.mapRangeSeries = buildChartRangeSeries(state.window2.mapRangeSamples, variable, unit);
                            render();
                        } else if (!state.window2.mapRangeLoading) {
                            void loadMapRangeDataW2();
                        }
                    }
                }
                return;
            case "compareMode":
                target.compareMode = val as CompareMode;
                triggerMapReload = true;
                break;
            case "compareScenarioA":
                if (val === target.compareScenarioB) {
                    target.compareScenarioB = target.compareScenarioA;
                }
                target.compareScenarioA = val;
                triggerMapReload = true;
                break;
            case "compareScenarioB":
                if (val === target.compareScenarioA) {
                    target.compareScenarioA = target.compareScenarioB;
                }
                target.compareScenarioB = val;
                triggerMapReload = true;
                break;
            case "compareModelA":
                if (val === target.compareModelB) {
                    target.compareModelB = target.compareModelA;
                }
                target.compareModelA = val;
                triggerMapReload = true;
                break;
            case "compareModelB":
                if (val === target.compareModelA) {
                    target.compareModelA = target.compareModelB;
                }
                target.compareModelB = val;
                triggerMapReload = true;
                break;
            case "chartVariable":
                state.chartVariable = val;
                state.chartUnit = getDefaultUnitOption(val).label;
                triggerChartReload = true;
                break;
            case "chartUnit":
                state.chartUnit = val;
                if (state.chartSamples.length) {
                    if (state.chartMode === "range") {
                        state.chartRangeSeries = buildChartRangeSeries(
                            state.chartSamples,
                            state.chartVariable,
                            state.chartUnit,
                        );
                        state.chartBoxes = null;
                    } else {
                        state.chartBoxes = buildChartBoxes(
                            state.chartSamples,
                            state.chartVariable,
                            state.chartUnit,
                        );
                    }
                }
                render();
                return;
            case "ensembleVariable":
                if (
                    target.mode === "Ensemble" &&
                    getModeMasks(target).some((mask) => mask.kind === "probability")
                ) {
                    return;
                }
                target.ensembleVariable = val;
                target.ensembleUnit = getDefaultUnitOption(val).label;
                target.legendPinned = false;
                target.legendPinnedMin = null;
                target.legendPinnedMax = null;
                if (legendPinTooltipOpen === w) legendPinTooltipOpen = null;
                triggerMapReload = true;
                break;
            case "ensembleUnit":
                target.ensembleUnit = val;
                render();
                if (w === "2") {
                    if (
                        state.splitView &&
                        state.window2.currentData &&
                        persistentCanvas2 &&
                        state.window2.dataMin !== null &&
                        state.window2.dataMax !== null &&
                        state.window2.mode === "Ensemble"
                    ) {
                        renderMapDataWindow2(
                            state.window2.currentData,
                            persistentCanvas2,
                            paletteOptions,
                            state.window2.mapPalette,
                            state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                            state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                            state.window2.ensembleVariable,
                            state.window2.ensembleUnit,
                            getModeMasks(state.window2),
                            state.window2.ensembleStatistics ?? undefined,
                            true,
                            state.window2.maskVariableData.size > 0
                                ? state.window2.maskVariableData
                                : undefined,
                            state.window2.ensembleStatisticsByVariable,
                            state.window2.ensembleRawSamplesByVariable,
                        );
                        const w2Pal =
                            paletteOptions.find(
                                (p) => p.name === state.window2.mapPalette,
                            ) || paletteOptions[0];
                        drawLegendGradient(
                            "legend-gradient-canvas-w2",
                            w2Pal.colors,
                        );
                    }
                    return;
                }
                if (
                    state.currentData &&
                    appRoot &&
                    state.dataMin !== null &&
                    state.dataMax !== null &&
                    state.mode === "Ensemble"
                ) {
                    const canvas =
                        appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
                    if (canvas) {
                        mapCanvas = canvas;
                        applyMapInteractions(canvas);
                        renderMapData(
                            state.currentData,
                            mapCanvas,
                            paletteOptions,
                            state.mapPalette,
                            state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
                            state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
                            state.ensembleVariable,
                            state.ensembleUnit,
                            getModeMasks(state),
                            state.ensembleStatistics,
                            true,
                            undefined,
                            state.ensembleStatisticsByVariable,
                            state.ensembleRawSamplesByVariable,
                        );

                        const palette =
                            paletteOptions.find(
                                (p) => p.name === state.mapPalette,
                            ) || paletteOptions[0];
                        drawLegendGradient(
                            "legend-gradient-canvas",
                            palette.colors,
                        );
                    }
                }
                if (state.mapMarker && state.mapInfoOpen) {
                    if (state.mapInfoSamples.length) {
                        const { variable, unit } = getActiveMapVariable();
                        state.mapInfoBoxes = buildChartBoxes(
                            state.mapInfoSamples,
                            variable,
                            unit,
                        );
                        render();
                    } else if (!state.mapInfoLoading) {
                        void loadMapInfoData();
                    }
                }
                if (state.mapRangeOpen) {
                    if (state.mapRangeSamples.length) {
                        const { variable, unit } = getMapRangeVariable();
                        state.mapRangeSeries = buildChartRangeSeries(
                            state.mapRangeSamples,
                            variable,
                            unit,
                        );
                        render();
                    } else if (!state.mapRangeLoading) {
                        void loadMapRangeData();
                    }
                }
                return;
            case "ensembleStatistic":
                target.ensembleStatistic = val as EnsembleStatistic;
                target.legendPinned = false;
                target.legendPinnedMin = null;
                target.legendPinnedMax = null;
                if (legendPinTooltipOpen === w) legendPinTooltipOpen = null;
                triggerMapReload = true;
                break;
            case "maskStatistic": {
                if (maskIndex !== undefined) {
                    const index = Number.parseInt(maskIndex, 10);
                    const masks = getModeMasks(target);
                    if (
                        !Number.isNaN(index) &&
                        index >= 0 &&
                        masks &&
                        index < masks.length
                    ) {
                        const stat = val as EnsembleStatistic;
                        const mask = masks[index];
                        mask.statistic = stat;
                        if (target.mode === "Ensemble") {
                            const maskVariable =
                                mask.variable ||
                                (target === state.window2
                                    ? state.window2.ensembleVariable
                                    : state.ensembleVariable);
                            const maskUnit =
                                mask.unit ||
                                (target === state.window2
                                    ? state.window2.ensembleUnit
                                    : state.ensembleUnit);
                            const range =
                                mask.kind === "probability"
                                    ? target === state.window2
                                        ? getEnsembleProbabilityMaskRangeForWindow2(
                                              state.window2,
                                              maskVariable,
                                              maskUnit,
                                          )
                                        : getEnsembleProbabilityMaskRange(
                                              maskVariable,
                                              maskUnit,
                                          )
                                    : target === state.window2
                                      ? getEnsembleMaskRangeForWindow2(
                                            stat,
                                            state.window2,
                                            maskVariable,
                                            maskUnit,
                                        )
                                      : getEnsembleMaskRange(
                                            stat,
                                            maskVariable,
                                            maskUnit,
                                        );
                            mask.lowerBound = range.min;
                            mask.upperBound = range.max;
                            mask.lowerEdited = false;
                            mask.upperEdited = false;
                        }
                        render();
                        if (
                            target.mode === "Ensemble" &&
                            (w === "2"
                                ? state.splitView && state.window2.canvasView === "map"
                                : state.canvasView === "map")
                        ) {
                            if (w === "2") void loadClimateDataWindow2();
                            else void loadClimateData();
                        }
                    }
                }
                return;
            }
            case "maskVariable": {
                if (maskIndex !== undefined) {
                    const index = Number.parseInt(maskIndex, 10);
                    const masks = getModeMasks(target);
                    if (
                        !Number.isNaN(index) &&
                        index >= 0 &&
                        masks &&
                        index < masks.length
                    ) {
                        const m = masks[index];
                        // No-op: same variable reselected – preserve user-edited bounds
                        if (val === m.variable) return;
                        m.variable = val;
                        m.unit = getDefaultUnitOption(val).label;
                        if (target.mode === "Ensemble") {
                            const stat = m.statistic || "mean";
                            const range =
                                m.kind === "probability"
                                    ? target === state.window2
                                        ? getEnsembleProbabilityMaskRangeForWindow2(
                                              state.window2,
                                              m.variable,
                                              m.unit,
                                          )
                                        : getEnsembleProbabilityMaskRange(
                                              m.variable,
                                              m.unit,
                                          )
                                    : target === state.window2
                                      ? getEnsembleMaskRangeForWindow2(
                                            stat,
                                            state.window2,
                                            m.variable,
                                            m.unit,
                                        )
                                      : getEnsembleMaskRange(
                                            stat,
                                            m.variable,
                                            m.unit,
                                        );
                            m.lowerBound = range.min;
                            m.upperBound = range.max;
                            m.lowerEdited = false;
                            m.upperEdited = false;
                        } else {
                            m.lowerBound = null;
                            m.upperBound = null;
                            m.lowerEdited = false;
                            m.upperEdited = false;
                        }
                        render();
                        if (
                            (target.mode === "Explore" ||
                                target.mode === "Ensemble") &&
                            (w === "2"
                                ? state.splitView && state.window2.canvasView === "map"
                                : state.canvasView === "map")
                        ) {
                            if (w === "2") void loadClimateDataWindow2();
                            else void loadClimateData();
                            render();
                        }
                    }
                }
                return;
            }
            case "maskUnit": {
                if (maskIndex !== undefined) {
                    const index = Number.parseInt(maskIndex, 10);
                    const masks = getModeMasks(target);
                    if (
                        !Number.isNaN(index) &&
                        index >= 0 &&
                        masks &&
                        index < masks.length
                    ) {
                        const mask = masks[index];
                        // No-op: same unit reselected – preserve user-edited bounds
                        if (val === mask.unit) return;
                        mask.unit = val;
                        if (target.mode === "Ensemble") {
                            const range =
                                mask.kind === "probability"
                                    ? target === state.window2
                                        ? getEnsembleProbabilityMaskRangeForWindow2(
                                              state.window2,
                                              mask.variable || state.window2.ensembleVariable,
                                              mask.unit,
                                          )
                                        : getEnsembleProbabilityMaskRange(
                                              mask.variable || state.ensembleVariable,
                                              mask.unit,
                                          )
                                    : target === state.window2
                                      ? getEnsembleMaskRangeForWindow2(
                                            mask.statistic || "mean",
                                            state.window2,
                                            mask.variable || state.window2.ensembleVariable,
                                            mask.unit,
                                        )
                                      : getEnsembleMaskRange(
                                            mask.statistic || "mean",
                                            mask.variable || state.ensembleVariable,
                                            mask.unit,
                                        );
                            mask.lowerBound = range.min;
                            mask.upperBound = range.max;
                            mask.lowerEdited = false;
                            mask.upperEdited = false;
                        }
                        render();
                        if (target.mode === "Ensemble") {
                            if (w === "2") {
                                if (
                                    state.splitView &&
                                    state.window2.currentData &&
                                    persistentCanvas2 &&
                                    state.window2.dataMin !== null &&
                                    state.window2.dataMax !== null
                                ) {
                                    const w2IsEnsemble = true;
                                    const w2DisplayVar = state.window2.ensembleVariable;
                                    const w2DisplayUnit = state.window2.ensembleUnit;
                                    renderMapDataWindow2(
                                        state.window2.currentData,
                                        persistentCanvas2,
                                        paletteOptions,
                                        state.window2.mapPalette,
                                        state.window2.legendPinned && state.window2.legendPinnedMin !== null ? state.window2.legendPinnedMin : state.window2.dataMin,
                                        state.window2.legendPinned && state.window2.legendPinnedMax !== null ? state.window2.legendPinnedMax : state.window2.dataMax,
                                        w2DisplayVar,
                                        w2DisplayUnit,
                                        getModeMasks(state.window2),
                                        state.window2.ensembleStatistics ?? undefined,
                                        w2IsEnsemble,
                                        state.window2.maskVariableData.size > 0
                                            ? state.window2.maskVariableData
                                            : undefined,
                                        state.window2.ensembleStatisticsByVariable,
                                        state.window2.ensembleRawSamplesByVariable,
                                    );
                                    const w2Pal =
                                        paletteOptions.find(
                                            (p) => p.name === state.window2.mapPalette,
                                        ) || paletteOptions[0];
                                    drawLegendGradient(
                                        "legend-gradient-canvas-w2",
                                        w2Pal.colors,
                                    );
                                }
                            } else if (
                                state.currentData &&
                                appRoot &&
                                state.dataMin !== null &&
                                state.dataMax !== null
                            ) {
                                const canvas =
                                    appRoot.querySelector<HTMLCanvasElement>(
                                        "#map-canvas",
                                    );
                                if (canvas) {
                                    mapCanvas = canvas;
                                    applyMapInteractions(canvas);
                                    renderMapData(
                                        state.currentData,
                                        mapCanvas,
                                        paletteOptions,
                                        state.mapPalette,
                                        state.legendPinned && state.legendPinnedMin !== null ? state.legendPinnedMin : state.dataMin,
                                        state.legendPinned && state.legendPinnedMax !== null ? state.legendPinnedMax : state.dataMax,
                                        state.ensembleVariable,
                                        state.ensembleUnit,
                                        getModeMasks(state),
                                        state.ensembleStatistics,
                                        true,
                                        undefined,
                                        state.ensembleStatisticsByVariable,
                                        state.ensembleRawSamplesByVariable,
                                    );
                                    const palette =
                                        paletteOptions.find(
                                            (p) => p.name === state.mapPalette,
                                        ) || paletteOptions[0];
                                    drawLegendGradient(
                                        "legend-gradient-canvas",
                                        palette.colors,
                                    );
                                }
                            }
                        }
                    }
                }
                return;
            }
            case "chartLocation":
                if (val === "Draw") {
                    startRegionDrawing();
                    return;
                }
                if (val === "Point") {
                    startPointSelection();
                    return;
                }
                if (val === "Search") {
                    state.chartLocation = "Search";
                    state.chartPolygon = null;
                    state.pointSelectActive = false;
                    state.drawState = resetDrawState();
                    state.chartError = null;
                    state.chartLocationName = null;
                    state.chartLocationSearchError = null;
                    state.chartLocationSearchResults = [];
                    state.chartLocationSearchQuery = "";
                    state.chartLocationSearchLoading = false;
                    state.canvasView = "chart";
                    stopRegionDrawing();
                    stopPointSelection();
                    render();
                    return;
                }
                state.chartLocation = "World";
                state.chartPolygon = null;
                state.chartPoint = null;
                state.chartLocationName = null;
                state.chartLocationSearchError = null;
                state.chartLocationSearchResults = [];
                state.chartLocationSearchQuery = "";
                state.chartLocationSearchLoading = false;
                stopRegionDrawing();
                stopPointSelection();
                triggerChartReload = true;
                break;
        }
        // Defer render + reload to next tick. Otherwise we replace the entire DOM
        // (including the dropdown we just clicked) during the click handler,
        // which can crash the page (e.g. when changing variable with masks).
        const doRenderAndReload = () => {
            render();
            if (w === "2" && triggerMapReload && state.splitView) {
                loadClimateDataWindow2();
            } else if (state.canvasView === "map" && triggerMapReload) {
                loadClimateData();
                const hasPoint = state.mapMarker !== null;
                const hasPolygon =
                    state.mapPolygon !== null && state.mapPolygon.length >= 3;
                if ((hasPoint || hasPolygon) && state.mapInfoOpen) {
                    void loadMapInfoData();
                }
                if (hasPoint && state.mapRangeOpen) {
                    void loadMapRangeData();
                }
            }
            if (
                w === "1" &&
                state.canvasView === "chart" &&
                (triggerChartReload || triggerMapReload)
            ) {
                loadChartData();
            }
        };
        if (triggerMapReload || triggerChartReload) {
            setTimeout(doRenderAndReload, 0);
        } else {
            doRenderAndReload();
        }
    };

    // Handle special case for chartLocation dropdown
    const chartLocationWrapper = root.querySelector<HTMLElement>(
        '.custom-select-wrapper[data-key="chartLocation"]',
    );
    if (chartLocationWrapper) {
        const chartLocationOptions =
            chartLocationWrapper.querySelectorAll<HTMLElement>(
                ".custom-select-option",
            );
        chartLocationOptions.forEach((option) => {
            option.addEventListener("click", () => {
                const value = option.dataset.value;
                if (value === "Draw" && state.chartLocation === "Draw") {
                    startRegionDrawing();
                } else if (
                    value === "Point" &&
                    state.chartLocation === "Point"
                ) {
                    startPointSelection();
                }
            });
        });

        const locationSearchInputs =
            chartLocationWrapper.querySelectorAll<HTMLInputElement>(
                '[data-role="location-search-input"]',
            );
        const locationSearchResults =
            chartLocationWrapper.querySelectorAll<HTMLElement>(
                '[data-role="location-search-result"]',
            );

        const clearLocationSearchDebounce = () => {
            if (locationSearchDebounce !== null) {
                window.clearTimeout(locationSearchDebounce);
                locationSearchDebounce = null;
            }
        };

        const triggerSearch = (query: string) => {
            clearLocationSearchDebounce();
            void handleLocationSearch(query);
        };

        // Only rerender the location search UI, not the whole view
        locationSearchInputs.forEach((input) => {
            input.addEventListener("input", () => {
                const hadResults = state.chartLocationSearchResults.length > 0;
                const wasLoading = state.chartLocationSearchLoading;
                const hadError = Boolean(state.chartLocationSearchError);

                state.chartLocationSearchQuery = input.value;
                state.chartLocationSearchError = null;

                clearLocationSearchDebounce();
                const trimmed = input.value.trim();

                if (!trimmed) {
                    state.chartLocationSearchResults = [];
                    state.chartLocationSearchLoading = false;
                    renderLocationSearch();
                    return;
                }

                if (hadResults || wasLoading || hadError) {
                    state.chartLocationSearchResults = [];
                    state.chartLocationSearchLoading = false;
                    renderLocationSearch();
                }

                locationSearchDebounce = window.setTimeout(() => {
                    triggerSearch(input.value);
                }, LOCATION_SEARCH_DEBOUNCE_MS);
            });
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    clearLocationSearchDebounce();
                    triggerSearch(input.value);
                }
            });
        });

        locationSearchResults.forEach((resultEl) => {
            resultEl.addEventListener("click", () => {
                const lat = Number(resultEl.dataset.lat);
                const lon = Number(resultEl.dataset.lon);
                const name = resultEl.dataset.name ?? "Selected place";
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                chartLocationWrapper.classList.remove("open");
                applySearchedLocation({ displayName: name, lat, lon });
            });
        });
        // Only rerenders the location search UI, not the entire view
        function renderLocationSearch() {
            const chartLocationWrapper = appRoot?.querySelector<HTMLElement>(
                '.custom-select-wrapper[data-key="chartLocation"]',
            );
            if (!chartLocationWrapper) return;

            // Update input value and loading state
            const input = chartLocationWrapper.querySelector<HTMLInputElement>(
                '[data-role="location-search-input"]',
            );
            if (input) {
                input.value = state.chartLocationSearchQuery;
            }

            // Update results list
            const resultsContainer =
                chartLocationWrapper.querySelector<HTMLElement>(
                    '[data-role="location-search-results-container"]',
                );
            if (resultsContainer) {
                // Clear previous results
                resultsContainer.innerHTML = "";
                if (state.chartLocationSearchLoading) {
                    resultsContainer.innerHTML =
                        '<div class="search-loading">Loading...</div>';
                } else if (state.chartLocationSearchError) {
                    resultsContainer.innerHTML = `<div class="search-error">${state.chartLocationSearchError}</div>`;
                } else if (state.chartLocationSearchResults.length > 0) {
                    for (const result of state.chartLocationSearchResults) {
                        const el = document.createElement("div");
                        el.className = "custom-select-option search-result";
                        el.setAttribute("data-role", "location-search-result");
                        el.setAttribute("data-lat", String(result.lat));
                        el.setAttribute("data-lon", String(result.lon));
                        el.setAttribute(
                            "data-name",
                            result.displayName || "Selected place",
                        );
                        el.textContent =
                            result.displayName ||
                            `${result.lat}, ${result.lon}`;
                        el.addEventListener("click", () => {
                            chartLocationWrapper.classList.remove("open");
                            applySearchedLocation({
                                displayName:
                                    result.displayName || "Selected place",
                                lat: result.lat,
                                lon: result.lon,
                            });
                        });
                        resultsContainer.appendChild(el);
                    }
                }
            }
        }

        if (state.chartLocation === "Search") {
            const input = chartLocationWrapper.querySelector<HTMLInputElement>(
                '[data-role="location-search-input"]',
            );
            if (input) {
                setTimeout(() => input.focus(), 0);
            }
        }
    }

    const mapSearchInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-role="map-location-search-input"]',
    );
    const mapSearchResults = root.querySelectorAll<HTMLElement>(
        '[data-role="map-location-search-result"]',
    );

    const clearMapSearchDebounce = () => {
        if (mapLocationSearchDebounce !== null) {
            window.clearTimeout(mapLocationSearchDebounce);
            mapLocationSearchDebounce = null;
        }
    };

    const triggerMapSearch = (query: string) => {
        clearMapSearchDebounce();
        void handleMapLocationSearch(query);
    };

    mapSearchInputs.forEach((input) => {
        const isW2 = input.dataset.window === "2";
        input.addEventListener("focus", () => {
            if (isW2) state.window2.mapLocationSearchFocused = true;
            else state.mapLocationSearchFocused = true;
        });
        const syncCursor = () => {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            if (isW2) {
                state.window2.mapLocationSearchCursor = { start, end };
            } else {
                state.mapLocationSearchCursor = { start, end };
            }
        };
        input.addEventListener("input", () => {
            if (isW2) {
                const w2 = state.window2;
                w2.mapLocationSearchQuery = input.value;
                w2.mapLocationSearchError = null;
                w2.mapLocationSearchSelection = null;
                w2.mapLocationSearchFocused = true;
                const wStart = input.selectionStart ?? input.value.length;
                const wEnd = input.selectionEnd ?? input.value.length;
                w2.mapLocationSearchCursor = { start: wStart, end: wEnd };
                if (mapLocationSearchDebounceW2 !== null) { window.clearTimeout(mapLocationSearchDebounceW2); mapLocationSearchDebounceW2 = null; }
                const hadW2Results = w2.mapLocationSearchResults.length > 0;
                const wasW2Loading = w2.mapLocationSearchLoading;
                const hadW2Error = Boolean(w2.mapLocationSearchError);
                const trimmed = input.value.trim();
                if (!trimmed) { w2.mapLocationSearchResults = []; w2.mapLocationSearchLoading = false; render(); return; }
                if (hadW2Results || wasW2Loading || hadW2Error) { w2.mapLocationSearchResults = []; w2.mapLocationSearchLoading = false; render(); }
                mapLocationSearchDebounceW2 = window.setTimeout(() => { void handleMapLocationSearchW2(input.value); }, LOCATION_SEARCH_DEBOUNCE_MS);
            } else {
                const hadResults = state.mapLocationSearchResults.length > 0;
                const wasLoading = state.mapLocationSearchLoading;
                const hadError = Boolean(state.mapLocationSearchError);
                state.mapLocationSearchQuery = input.value;
                state.mapLocationSearchError = null;
                state.mapLocationSearchSelection = null;
                state.mapLocationSearchFocused = true;
                syncCursor();
                clearMapSearchDebounce();
                const trimmed = input.value.trim();
                if (!trimmed) { state.mapLocationSearchResults = []; state.mapLocationSearchLoading = false; render(); return; }
                if (hadResults || wasLoading || hadError) { state.mapLocationSearchResults = []; state.mapLocationSearchLoading = false; render(); }
                mapLocationSearchDebounce = window.setTimeout(() => { triggerMapSearch(input.value); }, LOCATION_SEARCH_DEBOUNCE_MS);
            }
        });
        input.addEventListener("keyup", syncCursor);
        input.addEventListener("click", syncCursor);
        input.addEventListener("select", syncCursor);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (isW2) {
                    if (mapLocationSearchDebounceW2 !== null) { window.clearTimeout(mapLocationSearchDebounceW2); mapLocationSearchDebounceW2 = null; }
                    void handleMapLocationSearchW2(input.value);
                } else {
                    clearMapSearchDebounce();
                    triggerMapSearch(input.value);
                }
            }
        });
    });

    mapSearchResults.forEach((resultEl) => {
        resultEl.addEventListener("click", () => {
            const lat = Number(resultEl.dataset.lat);
            const lon = Number(resultEl.dataset.lon);
            const name = resultEl.dataset.name ?? "Selected place";
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            if (resultEl.dataset.window === "2") {
                applyMapSearchedLocationW2({ displayName: name, lat, lon });
            } else {
                applyMapSearchedLocation({ displayName: name, lat, lon });
            }
        });
    });

    if (state.mapLocationSearchFocused) {
        const input = root.querySelector<HTMLInputElement>(
            '[data-role="map-location-search-input"]:not([data-window="2"])',
        );
        if (input) {
            setTimeout(() => input.focus(), 0);
            const { start, end } = state.mapLocationSearchCursor;
            const safeStart = Math.min(start, input.value.length);
            const safeEnd = Math.min(end, input.value.length);
            setTimeout(() => input.setSelectionRange(safeStart, safeEnd), 0);
        }
    }

    if (state.window2.mapLocationSearchFocused) {
        const input = root.querySelector<HTMLInputElement>(
            '[data-role="map-location-search-input"][data-window="2"]',
        );
        if (input) {
            setTimeout(() => input.focus(), 0);
            const { start, end } = state.window2.mapLocationSearchCursor;
            const safeStart = Math.min(start, input.value.length);
            const safeEnd = Math.min(end, input.value.length);
            setTimeout(() => input.setSelectionRange(safeStart, safeEnd), 0);
        }
    }

    // Keep old select handlers for backwards compatibility (if any native selects remain)
    const selectInputs = root.querySelectorAll<HTMLSelectElement>(
        'select[data-action="update-select"]',
    );
    selectInputs.forEach((select) =>
        select.addEventListener("change", async () => {
            const key = select.dataset.key;
            const val = select.value;
            if (!key) return;
            await handleSelectChange(key, val);
        }),
    );

    const multiToggleButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="toggle-multi"]',
    );
    multiToggleButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const key = btn.dataset.key;
            const value = btn.dataset.value;
            if (!key || !value) return;

            if (key === "chartScenarios") {
                const available =
                    state.metaData?.scenarios?.length &&
                    state.metaData.scenarios
                        ? Array.from(
                              new Set(
                                  state.metaData.scenarios.map(
                                      normalizeScenarioLabel,
                                  ),
                              ),
                          )
                        : scenarios;
                const isHistorical = value === "Historical";
                const set = new Set(state.chartScenarios);

                if (set.has(value)) {
                    set.delete(value);
                } else {
                    // Add new value
                    if (isHistorical) {
                        // Selecting Historical deselects SSPs
                        set.clear();
                        set.add("Historical");
                    } else {
                        // Selecting SSP deselects Historical
                        set.delete("Historical");
                        set.add(value);
                    }
                }

                // Prevent empty selection: fallback to Historical if cleared
                if (set.size === 0) {
                    set.add(isHistorical ? "Historical" : value);
                }

                state.chartScenarios = Array.from(set).filter((s) =>
                    available.includes(s),
                );

                // Clip date to new common range
                const commonRange = intersectScenarioRange(
                    state.chartScenarios,
                );
                state.chartDate = clipDateToRange(state.chartDate, commonRange);
                state.chartRangeStart = clipDateToRange(
                    state.chartRangeStart,
                    commonRange,
                );
                state.chartRangeEnd = clipDateToRange(
                    state.chartRangeEnd,
                    commonRange,
                );
            }

            if (key === "chartModels") {
                const available =
                    state.metaData?.models?.length && state.metaData.models
                        ? state.metaData.models
                        : models;
                const set = new Set(state.chartModels);
                if (set.has(value)) {
                    set.delete(value);
                } else {
                    set.add(value);
                }
                state.chartModels = set.size ? Array.from(set) : [...available];
            }

            if (key === "ensembleScenarios") {
                const w = (btn.dataset.window || "1") as "1" | "2";
                const t = w === "2" ? state.window2 : state;
                const available =
                    state.metaData?.scenarios?.length &&
                    state.metaData.scenarios
                        ? Array.from(
                              new Set(
                                  state.metaData.scenarios.map(
                                      normalizeScenarioLabel,
                                  ),
                              ),
                          )
                        : scenarios;
                const isHistorical = value === "Historical";
                const set = new Set(t.ensembleScenarios);

                if (set.has(value)) {
                    set.delete(value);
                } else {
                    // Add new value
                    if (isHistorical) {
                        // Selecting Historical deselects SSPs
                        set.clear();
                        set.add("Historical");
                    } else {
                        // Selecting SSP deselects Historical
                        set.delete("Historical");
                        set.add(value);
                    }
                }

                // Prevent empty selection: fallback to Historical if cleared
                if (set.size === 0) {
                    set.add(isHistorical ? "Historical" : value);
                }

                t.ensembleScenarios = Array.from(set).filter((s) =>
                    available.includes(s),
                );

                // Clip date to new common range
                const commonRange = intersectScenarioRange(
                    t.ensembleScenarios,
                );
                t.ensembleDate = clipDateToRange(
                    t.ensembleDate,
                    commonRange,
                );
            }

            if (key === "ensembleModels") {
                const w = (btn.dataset.window || "1") as "1" | "2";
                const t = w === "2" ? state.window2 : state;
                const available = state.metaData?.models?.length
                    ? state.metaData.models
                    : models;
                const set = new Set(t.ensembleModels);

                if (set.has(value)) {
                    set.delete(value);
                } else {
                    set.add(value);
                }

                t.ensembleModels = set.size
                    ? Array.from(set)
                    : [...available];
            }

            render();
            if (state.canvasView === "chart") {
                loadChartData();
            } else {
                const w = (btn.dataset.window || "1") as "1" | "2";
                if (w === "2") {
                    if (state.window2.canvasView === "map" && state.window2.mode === "Ensemble") {
                        loadClimateDataWindow2();
                    }
                } else if (state.canvasView === "map" && state.mode === "Ensemble") {
                    loadClimateData();
                }
            }
        }),
    );

    const collapseButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="toggle-collapse"]',
    );
    collapseButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const key = btn.dataset.key;
            if (!key) return;
            if (key === "chartScenarios") {
                state.chartDropdown.scenariosOpen =
                    !state.chartDropdown.scenariosOpen;
            }
            if (key === "chartModels") {
                state.chartDropdown.modelsOpen =
                    !state.chartDropdown.modelsOpen;
            }
            if (key === "ensembleScenarios") {
                const w = (btn.dataset.window || "1") as "1" | "2";
                const t = w === "2" ? state.window2 : state;
                t.ensembleDropdown.scenariosOpen =
                    !t.ensembleDropdown.scenariosOpen;
            }
            if (key === "ensembleModels") {
                const w = (btn.dataset.window || "1") as "1" | "2";
                const t = w === "2" ? state.window2 : state;
                t.ensembleDropdown.modelsOpen =
                    !t.ensembleDropdown.modelsOpen;
            }
            render();
        }),
    );

    const textInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="update-input"]',
    );
    textInputs.forEach((input) => {
        // Track if user is actively typing (input is focused)
        let isTyping = false;
        let typingTimeout: number | null = null;

        // Validation feedback only (doesn't commit changes)
        const validateInput = () => {
            const value = input.value;
            // Validate date format (YYYY-MM-DD) and that it's a valid date
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const isValidFormat = dateRegex.test(value);
            const isValidDate =
                isValidFormat && !isNaN(new Date(value).getTime());

            if (!isValidDate && value.length > 0) {
                input.style.borderColor = "rgba(239, 68, 68, 0.6)";
            } else {
                input.style.borderColor = "";
            }
        };

        // Commit the date change (updates state and reloads data)
        const commitDateChange = () => {
            const key = input.dataset.key;
            const w = (input.dataset.window || "1") as "1" | "2";
            if (!key) return;
            const value = input.value;
            const target = w === "2" ? state.window2 : state;

            // Validate date format (YYYY-MM-DD) and that it's a valid date
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const isValidFormat = dateRegex.test(value);
            const isValidDate =
                isValidFormat && !isNaN(new Date(value).getTime());

            if (!isValidDate) {
                // Invalid date - restore previous value
                const currentValue =
                    key === "date"
                        ? target.date
                        : key === "compareDateStart"
                          ? target.compareDateStart
                          : key === "compareDateEnd"
                            ? target.compareDateEnd
                            : key === "chartRangeStart"
                              ? state.chartRangeStart
                              : key === "chartRangeEnd"
                                ? state.chartRangeEnd
                                : state.chartDate;
                input.value = currentValue;
                input.style.borderColor = "";
                return;
            }

            // Valid date - reset border
            input.style.borderColor = "";

            // Clip date to valid range for scenario (only for main date input)
            let clippedValue = value;
            if (key === "date") {
                clippedValue = clipDateToScenarioRange(value, target.scenario);
                // Update input field if date was clipped
                if (clippedValue !== value) {
                    input.value = clippedValue;
                }
            }

            // Get current value to check if it changed
            const currentValue =
                key === "date"
                    ? target.date
                    : key === "compareDateStart"
                      ? target.compareDateStart
                      : key === "compareDateEnd"
                        ? target.compareDateEnd
                        : key === "ensembleDate"
                          ? target.ensembleDate
                          : key === "chartRangeStart"
                            ? state.chartRangeStart
                            : key === "chartRangeEnd"
                              ? state.chartRangeEnd
                              : state.chartDate;

            if (currentValue === clippedValue) return; // No change, skip update

            switch (key) {
                case "date":
                    target.date = clippedValue;
                    if (w === "1") state.ensembleDate = clippedValue;
                    else state.window2.ensembleDate = clippedValue;
                    break;
                case "compareDateStart":
                    target.compareDateStart = value;
                    break;
                case "compareDateEnd":
                    target.compareDateEnd = value;
                    break;
                case "chartDate":
                    state.chartDate = value;
                    break;
                case "chartRangeStart":
                    state.chartRangeStart = value;
                    break;
                case "chartRangeEnd":
                    state.chartRangeEnd = value;
                    break;
                case "ensembleDate":
                    target.ensembleDate = value;
                    break;
            }

            // Advance tutorial only after a valid date change
            const tutorialState = getTutorialState();
            if (
                key === "date" &&
                tutorialState.active &&
                tutorialState.currentStep === 3
            ) {
                setTimeout(() => {
                    completeCurrentStep();
                    render();
                }, 100);
            }

            // Only re-render and reload if the date actually changed

            render();
            if (w === "2" && state.splitView) {
                if (
                    key === "date" ||
                    (target.mode === "Compare" &&
                        (key === "compareDateStart" || key === "compareDateEnd")) ||
                    (target.mode === "Ensemble" && key === "ensembleDate")
                ) {
                    loadClimateDataWindow2();
                }
            } else if (
                key === "date" ||
                (state.mode === "Compare" &&
                    (key === "compareDateStart" || key === "compareDateEnd")) ||
                (state.mode === "Ensemble" && key === "ensembleDate")
            ) {
                loadClimateData();
                const hasPoint = state.mapMarker !== null;
                const hasPolygon =
                    state.mapPolygon !== null && state.mapPolygon.length >= 3;
                if ((hasPoint || hasPolygon) && state.mapInfoOpen) {
                    void loadMapInfoData();
                }
            }
            if (
                w === "1" &&
                state.canvasView === "chart" &&
                (key === "chartDate" ||
                    key === "chartRangeStart" ||
                    key === "chartRangeEnd")
            ) {
                loadChartData();
            }
        };

        // Real-time validation feedback while typing
        input.addEventListener("input", () => {
            isTyping = true;
            validateInput();
            // Clear any pending timeout
            if (typingTimeout !== null) {
                window.clearTimeout(typingTimeout);
            }
            // Reset typing flag after a short delay
            typingTimeout = window.setTimeout(() => {
                isTyping = false;
            }, 300);
        });

        // Commit on blur (user finished typing or clicked away)
        // Skip if this is a mask input (handled separately)
        input.addEventListener("blur", (e) => {
            // Skip if this is a mask input
            if ((e.target as any).__isMaskInput) {
                return;
            }
            isTyping = false;
            if (typingTimeout !== null) {
                window.clearTimeout(typingTimeout);
                typingTimeout = null;
            }
            commitDateChange();
        });

        // Commit on Enter key press
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                isTyping = false;
                if (typingTimeout !== null) {
                    window.clearTimeout(typingTimeout);
                    typingTimeout = null;
                }
                commitDateChange();
                input.blur(); // Remove focus from input
            }
        });

        // Commit on change only if user is NOT actively typing (i.e., used date picker UI)
        input.addEventListener("change", () => {
            // Only commit if user is not actively typing (used date picker, not keyboard)
            if (!isTyping) {
                commitDateChange();
            }
        });
    });

    const resolutionInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-resolution"]',
    );
    const resolutionValues = root.querySelectorAll<HTMLElement>(
        '[data-role="resolution-value"]',
    );
    const updateResolutionUI = (value: number, windowFilter?: "1" | "2") => {
        const fill = ((value - 1) / (3 - 1)) * 100;
        const label = value === 1 ? "Low" : value === 2 ? "Medium" : "High";
        resolutionInputs.forEach((el) => {
            if (windowFilter && (el.dataset.window || "1") !== windowFilter) return;
            el.value = String(value);
            el.style.setProperty("--slider-fill", `${fill}%`);
        });
        resolutionValues.forEach((el) => {
            el.textContent = label;
        });
    };
    resolutionInputs.forEach((input) =>
        input.addEventListener("input", () => {
            const value = Number.parseInt(input.value, 10);
            const w = (input.dataset.window || "1") as "1" | "2";
            if (!Number.isNaN(value)) {
                const target = w === "2" ? state.window2 : state;
                target.resolution = value;
                updateResolutionUI(value, w);
                if (w === "2" && state.splitView) {
                    loadClimateDataWindow2();
                } else if (state.canvasView === "map") {
                    loadClimateData();
                }
            }
        }),
    );

    // Mask handlers
    const createMask = (kind: "binary" | "probability", isW2: boolean = false) => {
        const ms = isW2 ? state.window2 : state;
        if (kind === "probability" && ms.mode !== "Ensemble") {
            return;
        }
        // Initialize new mask with mode-appropriate defaults
        let lowerBound = ms.dataMin;
        let upperBound = ms.dataMax;
        if (ms.mode === "Explore") {
            const range = getMaskRangeFor(
                ms.variable,
                ms.selectedUnit,
            );
            if (range) {
                lowerBound = range.min;
                upperBound = range.max;
            }
        } else if (ms.mode === "Ensemble") {
            const range =
                kind === "probability"
                    ? getEnsembleProbabilityMaskRange(
                          ms.ensembleVariable,
                          ms.ensembleUnit,
                      )
                    : getEnsembleMaskRange(
                          "mean",
                          ms.ensembleVariable,
                          ms.ensembleUnit,
                      );
            lowerBound = range.min;
            upperBound = range.max;
        }
        const newMask: {
            id: number;
            lowerBound: number | null;
            upperBound: number | null;
            lowerEdited: boolean;
            upperEdited: boolean;
            kind?: "binary" | "probability";
            probabilityThreshold?: number;
            statistic?: EnsembleStatistic;
            variable?: string;
            unit?: string;
        } = {
            id: nextMaskId++,
            lowerBound,
            upperBound,
            lowerEdited: false,
            upperEdited: false,
            kind,
            ...(kind === "probability" ? { probabilityThreshold: 0.5 } : {}),
        };
        // In ensemble mode, default to "mean" statistic and current variable/unit
        if (ms.mode === "Ensemble") {
            newMask.statistic = "mean";
            newMask.variable = ms.ensembleVariable;
            newMask.unit = ms.ensembleUnit;
        }
        // In explore mode, default to current variable and unit
        if (ms.mode === "Explore") {
            newMask.variable = ms.variable;
            newMask.unit = ms.selectedUnit;
        }
        // In compare mode, set variable but NOT unit — data is raw differences,
        // so no unit offset (e.g. −273.15 for °C) should be applied during comparison.
        if (ms.mode === "Compare") {
            newMask.variable = ms.variable;
        }
        getModeMasks(ms).push(newMask);
        render();
    };

    const addMaskBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="add-mask"]',
    );
    addMaskBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const isW2 = btn.closest('[data-window="2"]') !== null;
            createMask("binary", isW2);
        });
    });

    const addProbabilityMaskBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="add-probability-mask"]',
    );
    addProbabilityMaskBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const isW2 = btn.closest('[data-window="2"]') !== null;
            createMask("probability", isW2);
        });
    });

    const removeMaskBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="remove-mask"]',
    );
    removeMaskBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const indexStr = btn.dataset.maskIndex;
            if (indexStr === undefined) return;
            const index = Number.parseInt(indexStr, 10);
            const isW2 = btn.closest('[data-window="2"]') !== null;
            const targetMasks = isW2 ? getModeMasks(state.window2) : getModeMasks(state);
            if (
                !Number.isNaN(index) &&
                index >= 0 &&
                index < targetMasks.length
            ) {
                targetMasks.splice(index, 1);
                render();
                // Don't reload map automatically - user will click Apply button if needed
            }
        });
    });

    const applyMaskBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="apply-masks"]',
    );
    applyMaskBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const isW2 = btn.closest('[data-window="2"]') !== null;
            if (isW2) {
                if (state.window2.canvasView === "map") void loadClimateDataWindow2();
            } else {
                if (state.canvasView === "map") loadClimateData();
            }
        });
    });

    const infoOpenBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-compare-info"]',
    );
    infoOpenBtn?.addEventListener("click", () => {
        state.compareInfoOpen = true;
        render();
    });

    const infoCloseBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="close-compare-info"]',
    );
    infoCloseBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.compareInfoOpen = false;
            render();
        }),
    );

    const notesOpenBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-config-description-info"]',
    );
    notesOpenBtn?.addEventListener("click", () => {
        if (!state.configDescription) return;
        state.configDescriptionInfoOpen = true;
        render();
    });

    const notesCloseBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="close-config-description-info"]',
    );
    notesCloseBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.configDescriptionInfoOpen = false;
            render();
        }),
    );

    const mapInfoCloseBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="close-map-info"]',
    );
    mapInfoCloseBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        closeMapInfoWindow();
    });

    const mapInfoToggleBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="toggle-map-info"]',
    );
    mapInfoToggleBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        if (state.mapInfoOpen) {
            closeMapInfoWindow();
        } else {
            state.mapInfoOpen = true;
            // Populate from range samples if available, otherwise fetch
            if (!applyRangeSamplesAsMapInfo(getCurrentDateForMode(state))) {
                void loadMapInfoData();
            }
            render();
            setTimeout(() => { attachMapInfoBoxplotHoverListeners(); }, 0);
        }
    });

    const mapRangeCloseBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="close-map-range"]',
    );
    mapRangeCloseBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        closeMapRangeOverlay();
    });

    const mapRangePresetSelect = root.querySelector<HTMLSelectElement>(
        '[data-action="map-range-preset"]',
    );
    mapRangePresetSelect?.addEventListener("change", () => {
        const preset = mapRangePresetSelect.value as AppState["mapRangePreset"];
        state.mapRangePreset = preset;
        if (preset !== "custom") {
            const range = buildMapRangeForPreset(preset, getCurrentDateForMode(state));
            if (range) {
                state.mapRangeStart = range.start;
                state.mapRangeEnd = range.end;
                void loadMapRangeData();
            }
        } else {
            // Just re-render to reveal the custom date inputs, don't reload yet
            render();
        }
    });

    const mapRangeApplyBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="map-range-apply"]',
    );
    mapRangeApplyBtn?.addEventListener("click", () => {
        const samplesInput = root.querySelector<HTMLInputElement>(
            '[data-action="map-range-num-samples"]',
        );
        if (samplesInput) {
            const n = parseInt(samplesInput.value, 10);
            if (!isNaN(n) && n >= 2) state.mapRangeNumSamples = n;
        }
        if (state.mapRangePreset === "custom") {
            const startInput = root.querySelector<HTMLInputElement>(
                '[data-action="map-range-date-start"]',
            );
            const endInput = root.querySelector<HTMLInputElement>(
                '[data-action="map-range-date-end"]',
            );
            if (!startInput || !endInput) return;
            const startVal = startInput.value;
            const endVal = endInput.value;
            if (!startVal || !endVal || startVal >= endVal) return;
            state.mapRangeStart = startVal;
            state.mapRangeEnd = endVal;
        } else {
            const range = buildMapRangeForPreset(state.mapRangePreset, getCurrentDateForMode(state));
            if (range) {
                state.mapRangeStart = range.start;
                state.mapRangeEnd = range.end;
            }
        }
        void loadMapRangeData();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-action="map-range-toggle-scenario"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const scenario = btn.getAttribute('data-scenario');
            if (!scenario) return;
            const hiddenIdx = state.mapRangeHiddenScenarios.indexOf(scenario);
            if (hiddenIdx === -1) state.mapRangeHiddenScenarios.push(scenario);
            else state.mapRangeHiddenScenarios.splice(hiddenIdx, 1);
            render();
        });
    });

    const mapInfoExpandBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-map-info-chart"]',
    );
    mapInfoExpandBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        if (!state.mapMarker && !state.mapPolygon) return;
        state.canvasView = "chart";
        state.chartMode = "single";
        // Keep expanded boxplot colors consistent with the map info palette selection
        state.chartPalette = state.mapInfoPalette;
        if (state.mapPolygon && state.mapPolygon.length >= 3) {
            state.chartLocation = "Draw";
            state.chartPolygon = state.mapPolygon;
            state.chartPoint = null;
            state.chartLocationName = null;
        } else if (state.mapMarker) {
            state.chartLocation = "Point";
            state.chartPoint = {
                lat: state.mapMarker.lat,
                lon: state.mapMarker.lon,
            };
            state.chartLocationName = state.mapMarker.name ?? null;
            state.chartPolygon = null;
        }
        // Use the active variable/unit based on current mode (ensemble vs explore)
        const { variable, unit } = getActiveMapVariable();
        state.chartVariable = variable;
        state.chartUnit = unit;
        // Use the appropriate date based on mode
        state.chartDate =
            state.mode === "Ensemble" ? state.ensembleDate : state.date;
        state.chartError = null;
        render();
        loadChartData();
    });

    const mapInfoPanel = root.querySelector<HTMLDivElement>("#map-info-panel");
    const mapInfoHeader = mapInfoPanel?.querySelector<HTMLElement>(
        ".map-info-header",
    );
    if (mapInfoPanel && mapInfoHeader) {
        mapInfoPanel.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
        });

        const onDragMove = (e: PointerEvent) => {
            if (!mapInfoDragState.active) return;
            if (
                mapInfoDragState.pointerId !== null &&
                e.pointerId !== mapInfoDragState.pointerId
            ) {
                return;
            }
            e.preventDefault();

            const parent = mapInfoPanel.offsetParent as HTMLElement | null;
            const parentRect = parent?.getBoundingClientRect();
            const parentLeft = parentRect?.left ?? 0;
            const parentTop = parentRect?.top ?? 0;
            const canvasRect =
                mapCanvas?.getBoundingClientRect() ??
                parentRect ??
                mapInfoPanel.getBoundingClientRect();
            const originLeft = parentRect
                ? canvasRect.left - parentRect.left
                : 0;
            const originTop = parentRect ? canvasRect.top - parentRect.top : 0;
            const panelRect = mapInfoPanel.getBoundingClientRect();
            const panelWidth = panelRect.width || mapInfoPanel.offsetWidth || 360;
            const panelHeight =
                panelRect.height || mapInfoPanel.offsetHeight || 240;
            const padding = 12;
            const sidebarOffset = state.sidebarOpen ? SIDEBAR_WIDTH : 0;

            let left =
                e.clientX - parentLeft - mapInfoDragState.offsetX;
            let top = e.clientY - parentTop - mapInfoDragState.offsetY;

            const minLeft = originLeft + padding;
            const maxLeft =
                originLeft +
                canvasRect.width -
                panelWidth -
                padding -
                sidebarOffset;
            const minTop = originTop + padding;
            const maxTop = originTop + canvasRect.height - panelHeight - padding;

            if (maxLeft < minLeft) {
                left = minLeft;
            } else {
                left = Math.max(minLeft, Math.min(left, maxLeft));
            }

            if (maxTop < minTop) {
                top = minTop;
            } else {
                top = Math.max(minTop, Math.min(top, maxTop));
            }

            mapInfoPanel.style.left = `${left}px`;
            mapInfoPanel.style.top = `${top}px`;
            mapInfoDragPosition = { left, top };
        };

        const onDragEnd = (e: PointerEvent) => {
            if (!mapInfoDragState.active) return;
            if (
                mapInfoDragState.pointerId !== null &&
                e.pointerId !== mapInfoDragState.pointerId
            ) {
                return;
            }
            mapInfoDragState.active = false;
            mapInfoDragState.pointerId = null;
            mapInfoHeader.style.cursor = "grab";
            mapInfoPanel.classList.remove("is-dragging");
            mapInfoPanel.releasePointerCapture?.(e.pointerId);
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", onDragMove);
            window.removeEventListener("pointerup", onDragEnd);
        };

        mapInfoHeader.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            if (
                target?.closest(
                    "button, .custom-select-wrapper, .custom-select-dropdown, .custom-select-option",
                )
            ) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const panelRect = mapInfoPanel.getBoundingClientRect();
            mapInfoDragState.active = true;
            mapInfoDragState.pointerId = e.pointerId;
            mapInfoDragState.offsetX = e.clientX - panelRect.left;
            mapInfoDragState.offsetY = e.clientY - panelRect.top;
            mapInfoHeader.style.cursor = "grabbing";
            mapInfoPanel.classList.add("is-dragging");
            mapInfoPanel.setPointerCapture?.(e.pointerId);
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onDragMove);
            window.addEventListener("pointerup", onDragEnd);
        });
    }

    // Resize handle
    const mapInfoResizeHandle = root.querySelector<HTMLElement>(
        "#map-info-panel .map-info-resize-handle",
    );
    if (mapInfoPanel && mapInfoResizeHandle) {
        const onResizeMove = (e: PointerEvent) => {
            if (!mapInfoResizeState.active) return;
            if (
                mapInfoResizeState.pointerId !== null &&
                e.pointerId !== mapInfoResizeState.pointerId
            ) return;
            e.preventDefault();
            const dx = e.clientX - mapInfoResizeState.startX;
            const dy = e.clientY - mapInfoResizeState.startY;
            const legendH = (document.querySelector('.map-legend') as HTMLElement | null)?.offsetHeight ?? 300;
            const minW = mapInfoNaturalSize?.width ?? mapInfoResizeState.startWidth;
            const minH = Math.max(mapInfoNaturalSize?.height ?? mapInfoResizeState.startHeight, legendH);
            const maxW = Math.round(window.innerWidth * 0.85);
            const maxH = Math.round(window.innerHeight * 0.85);
            const newW = Math.max(minW, Math.min(maxW, mapInfoResizeState.startWidth + dx));
            const newH = Math.max(minH, Math.min(maxH, mapInfoResizeState.startHeight + dy));
            mapInfoSize = { width: newW, height: newH };
            mapInfoPanel.style.width = `${newW}px`;
            mapInfoPanel.style.maxWidth = "none";
            mapInfoPanel.style.height = `${newH}px`;
        };

        const onResizeEnd = (e: PointerEvent) => {
            if (!mapInfoResizeState.active) return;
            if (
                mapInfoResizeState.pointerId !== null &&
                e.pointerId !== mapInfoResizeState.pointerId
            ) return;
            mapInfoResizeState.active = false;
            mapInfoResizeState.pointerId = null;
            mapInfoResizeHandle.style.opacity = "0.4";
            mapInfoPanel.releasePointerCapture?.(e.pointerId);
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", onResizeMove);
            window.removeEventListener("pointerup", onResizeEnd);
        };

        mapInfoResizeHandle.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const panelRect = mapInfoPanel.getBoundingClientRect();
            const sw = panelRect.width || mapInfoSize?.width || 360;
            const sh = panelRect.height || mapInfoSize?.height || 300;
            // Capture the natural (pre-resize) size as the minimum on first resize
            if (!mapInfoNaturalSize && !mapInfoSize) {
                mapInfoNaturalSize = { width: sw, height: sh };
            }
            mapInfoResizeState.active = true;
            mapInfoResizeState.pointerId = e.pointerId;
            mapInfoResizeState.startX = e.clientX;
            mapInfoResizeState.startY = e.clientY;
            mapInfoResizeState.startWidth = sw;
            mapInfoResizeState.startHeight = sh;
            mapInfoResizeHandle.style.opacity = "0.9";
            mapInfoPanel.setPointerCapture?.(e.pointerId);
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onResizeMove);
            window.addEventListener("pointerup", onResizeEnd);
        });

        mapInfoResizeHandle.addEventListener("mouseover", () => {
            if (!mapInfoResizeState.active) mapInfoResizeHandle.style.opacity = "0.8";
        });
        mapInfoResizeHandle.addEventListener("mouseout", () => {
            if (!mapInfoResizeState.active) mapInfoResizeHandle.style.opacity = "0.4";
        });
    }

    // ── Window-2 map info / range overlay event handlers ──────────────────────
    if (state.splitView) {
        attachW2MapInfoAndRangeHandlers(root);
        // Position the w2 marker after DOM is ready
        setTimeout(() => renderMapMarkerPositionW2(), 0);
    }

    // Route draw toggle to correct window
    root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-map-draw"]')
        .forEach(btn => btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (btn.dataset.window === "2") {
                if (state.window2.drawState.active) stopMapDrawingW2(); else startMapDrawingW2();
            } else {
                if (state.drawState.active) stopMapDrawing(); else startMapDrawing();
            }
        }));

    root.querySelectorAll<HTMLButtonElement>('[data-action="clear-map-draw"]')
        .forEach(btn => btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (btn.dataset.window === "2") {
                stopMapDrawingW2();
                state.window2.mapPolygon = null;
                state.window2.mapInfoOpen = false;
                closeMapRangeOverlayW2();
                render();
            } else {
                stopMapDrawing();
                state.mapPolygon = null;
                state.mapInfoOpen = false;
                closeMapRangeOverlay();
                render();
                renderDrawOverlayPaths();
            }
        }));

    attachTimeSliderHandlers({
        root,
        getTimeRange: () => state.timeRange,
        onDateChange: (date) => {
            state.date = date;
            // Sync date to ensemble mode
            state.ensembleDate = date;
            loadClimateData();
            const hasPoint = state.mapMarker !== null;
            const hasPolygon =
                state.mapPolygon !== null && state.mapPolygon.length >= 3;
            if ((hasPoint || hasPolygon) && state.mapInfoOpen) {
                void loadMapInfoData();
            }
            if (hasPoint && state.mapRangeOpen) {
                void loadMapRangeData();
            }
        },
        getMode: () => state.mode,
        getCompareMode: () => state.compareMode,
        getCompareDates: () => ({
            start: state.compareDateStart,
            end: state.compareDateEnd,
        }),
        onDateRangeChange: (start, end) => {
            state.compareDateStart = start;
            state.compareDateEnd = end;
            loadClimateData();
        },
    });

    attachChatHandlers(root, state);

    // ── Window 2 select/input handlers ─────────────────────────────────────
    const w2Selects = root.querySelectorAll<HTMLSelectElement>('[data-action="w2-update-select"]');
    w2Selects.forEach((sel) => {
        sel.addEventListener("change", () => {
            const key = sel.dataset.key;
            const val = sel.value;
            if (!key) return;
            const w2 = state.window2;
            if (key === "w2scenario") {
                w2.scenario = val;
                w2.date = getDateForScenario(val);
                w2.timeRange = getTimeRangeForScenario(val);
            } else if (key === "w2model") {
                w2.model = val;
            } else if (key === "w2variable") {
                w2.variable = val;
                w2.selectedUnit = getDefaultUnitOption(val).label;
            }
            loadClimateDataWindow2();
        });
    });

    const w2Inputs = root.querySelectorAll<HTMLInputElement>('[data-action="w2-update-input"]');
    w2Inputs.forEach((input) => {
        const commit = () => {
            const key = input.dataset.key;
            const val = input.value;
            if (!key) return;
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(val) || isNaN(new Date(val).getTime())) {
                // Restore valid value
                input.value = state.window2.date;
                return;
            }
            if (key === "w2date") {
                state.window2.date = val;
                loadClimateDataWindow2();
            }
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
        });
    });

    // ── Legend pin range inputs ─────────────────────────────────────────────
    const pinInputs = root.querySelectorAll<HTMLInputElement>('[data-action="legend-pin-range"]');
    pinInputs.forEach((input) => {
        const commit = () => {
            const key = input.dataset.key as "legendPinnedMin" | "legendPinnedMax";
            const w = (input.dataset.window || "1") as "1" | "2";
            const s = w === "2" ? state.window2 : state;
            const displayVal = parseFloat(input.value);
            if (Number.isFinite(displayVal) && key) {
                // Input is in display units — convert back to native units before storing
                const isEns = s.mode === "Ensemble";
                const variable = isEns ? s.ensembleVariable : s.variable;
                const unitLabel = isEns ? s.ensembleUnit : s.selectedUnit;
                const isDiff = s.mode === "Compare" || (isEns && isDifferenceEnsembleStatistic(s.ensembleStatistic));
                s[key] = unconvertValue(displayVal, variable, unitLabel, { isDifference: isDiff });
                render();
                redrawMapForPinnedRange(w);
            }
        };
        input.addEventListener("change", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
        });
    });
}

async function init() {
    appRoot = document.querySelector<HTMLDivElement>("#app");
    if (!appRoot) {
        throw new Error("Root element #app not found");
    }

    // Restore saved theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.dataset.theme = 'light';
    }

    // Register callback for state updates from chat/backend
    registerStateUpdateCallback((updates: Record<string, any>) => {
        // Capture the raw window2 delta before merge (to detect which fields the agent actually set)
        const w2Delta = updates.window2 && typeof updates.window2 === "object"
            ? (updates.window2 as Record<string, any>)
            : null;

        // When split view is newly opened and the agent didn't supply an explicit W2 date,
        // inherit V1's final date (updates.date from switch_to_explore_mode, or current state.date).
        // This is done before the deep-merge so it participates in the merge correctly.
        if (updates.splitView === true && !state.splitView) {
            if (!w2Delta?.date) {
                if (!updates.window2 || typeof updates.window2 !== "object") {
                    updates.window2 = {};
                }
                (updates.window2 as Record<string, any>).date = updates.date ?? state.date;
            }
        }

        // Deep-merge window2 to avoid replacing existing fields (e.g. dataMin/dataMax) with undefined
        if (updates.window2 && typeof updates.window2 === "object") {
            updates = { ...updates, window2: { ...state.window2, ...updates.window2 } };
        }
        Object.assign(state, updates);
        render();

        // Reload data if necessary
        if (state.canvasView === "map") {
            const exploreChanged =
                updates.date ||
                updates.model ||
                updates.scenario ||
                updates.variable;
            const ensembleChanged =
                updates.ensembleDate ||
                updates.ensembleModels ||
                updates.ensembleScenarios ||
                updates.ensembleVariable ||
                updates.ensembleUnit ||
                updates.mode === "Ensemble";
            const compareChanged =
                updates.compareMode ||
                updates.compareScenarioA ||
                updates.compareScenarioB ||
                updates.compareModelA ||
                updates.compareModelB ||
                updates.compareDateStart ||
                updates.compareDateEnd ||
                updates.mode === "Compare";
            if (exploreChanged || ensembleChanged || compareChanged) {
                loadClimateData();
            }
            // When agent enables split view, load Window 2 data
            if (updates.splitView === true && state.splitView) {
                loadClimateDataWindow2();
            }
            // When agent changes window2 fields only (not pane 1 params), reload W2
            if (
                updates.window2 &&
                state.splitView &&
                !exploreChanged &&
                !ensembleChanged &&
                !compareChanged
            ) {
                loadClimateDataWindow2();
            }
        } else if (updates.mapPalette && state.currentData) {
            // If only map palette changed and we already have data, just redraw
            render();
        }
        if (
            state.canvasView === "chart" &&
            (updates.chartDate ||
                updates.chartRangeStart ||
                updates.chartRangeEnd)
        ) {
            loadChartData();
        }

        // When the agent sets a map location (via set_map_location tool), zoom and load data
        if (updates.mapMarker && state.mapMarker) {
            const canvas = mapCanvas || appRoot?.querySelector<HTMLCanvasElement>("#map-canvas");
            if (canvas) {
                const targetZoom = Math.max(getCurrentZoomLevel(), 3.2);
                zoomToLocation(canvas, state.mapMarker.lon, state.mapMarker.lat, targetZoom);
                renderMapMarkerPosition();
            }
            // If no explicit range dates were supplied, derive them from the current date + preset
            if (state.mapRangeOpen && !updates.mapRangeStart) {
                const currentDate = getCurrentDateForMode(state);
                const range = buildMapRangeForPreset(state.mapRangePreset, currentDate) ?? buildMapRangeWindow(currentDate);
                state.mapRangeStart = range.start;
                state.mapRangeEnd = range.end;
            }
            if (state.mapInfoOpen) void loadMapInfoData();
            if (state.mapRangeOpen) void loadMapRangeData();
        }

        // Agent set location for Window 2 (w2Delta tracks what the agent actually provided)
        if (w2Delta?.mapMarker && state.window2.mapMarker) {
            if (persistentCanvas2) {
                zoomToLocationW2(persistentCanvas2, state.window2.mapMarker.lon, state.window2.mapMarker.lat, 3.2);
                renderMapMarkerPositionW2();
            }
            // If no explicit range dates were supplied for W2, derive them from W2's current date
            if (state.window2.mapRangeOpen && !w2Delta.mapRangeStart) {
                const w2date = state.window2.date ?? state.date;
                const range = buildMapRangeForPreset(state.window2.mapRangePreset ?? state.mapRangePreset, w2date) ?? buildMapRangeWindow(w2date);
                state.window2.mapRangeStart = range.start;
                state.window2.mapRangeEnd = range.end;
            }
            if (state.window2.mapInfoOpen) void loadMapInfoDataW2();
            if (state.window2.mapRangeOpen) void loadMapRangeDataW2();
        }
    });

    render();

    // Start a short delay timer for showing offline UI – avoids flashing the
    // download window briefly when the API is actually available.
    window.setTimeout(() => {
        apiOfflineDelayReady = true;
        if (state.apiAvailable === false) {
            render();
        }
    }, 500);

    checkApiAvailability().then(() => {
        render();

        if (state.apiAvailable !== false && state.canvasView === "map" && state.mode === "Explore") {
            loadClimateData();
        }
    });

    // Tutorial event handlers - attach once during init, not on every render
    appRoot.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;

        // Map range chart click → jump to that date
        const mapRangeSvgEl = (target as Element).closest<SVGSVGElement>('#map-range-svg');
        if (mapRangeSvgEl) {
            const vb = mapRangeSvgEl.viewBox.baseVal;
            const bbox = mapRangeSvgEl.getBoundingClientRect();
            if (vb.width && bbox.width) {
                const scaleX = vb.width / bbox.width;
                const ml = parseFloat(mapRangeSvgEl.dataset.marginLeft ?? '70');
                const plotW = parseFloat(mapRangeSvgEl.dataset.plotWidth ?? '864');
                const domainStartTs = parseFloat(mapRangeSvgEl.dataset.domainStart ?? '0');
                const domainEndTs = parseFloat(mapRangeSvgEl.dataset.domainEnd ?? '0');
                const plotX = (e.clientX - bbox.left) * scaleX - ml;
                if (plotX >= 0 && plotX <= plotW) {
                    const t = Math.max(0, Math.min(1, plotX / plotW));
                    const isW2 = !!mapRangeSvgEl.closest('#map-range-overlay-w2');
                    if (isW2) {
                        const w2Scenario = state.window2.scenario || state.scenario;
                        const newDate = clipDateToScenarioRange(
                            new Date(domainStartTs + t * (domainEndTs - domainStartTs)).toISOString().slice(0, 10),
                            w2Scenario,
                        );
                        if (newDate !== state.window2.date) {
                            state.window2.date = newDate;
                            render();
                            loadClimateDataWindow2();
                            applyRangeSamplesAsMapInfoW2(newDate);
                        }
                    } else {
                        const newDate = clipDateToScenarioRange(
                            new Date(domainStartTs + t * (domainEndTs - domainStartTs)).toISOString().slice(0, 10),
                            state.scenario,
                        );
                        if (newDate !== state.date) {
                            state.date = newDate;
                            state.ensembleDate = newDate;
                            render();
                            loadClimateData();
                            // Reuse already-loaded range data instead of re-querying
                            applyRangeSamplesAsMapInfo(newDate);
                        }
                    }
                }
            }
            return;
        }

        // Use closest to find the element with data-action, even if a child is clicked
        const actionElement = target.closest(
            "[data-action]",
        ) as HTMLElement | null;
        const action = actionElement?.getAttribute("data-action");
        const isMapOptionsAction =
            action === "toggle-map-options-menu" ||
            action === "toggle-map-borders" ||
            action === "toggle-map-cities";
        const actionWindow = (actionElement?.dataset.window ?? "1") as "1" | "2";

        if (
            (state.mapOptionsOpen || state.window2.mapOptionsOpen) &&
            !isMapOptionsAction &&
            !target.closest('[data-role="map-options-menu"]')
        ) {
            state.mapOptionsOpen = false;
            state.window2.mapOptionsOpen = false;
            render();
        }

        if (action === "toggle-map-options-menu") {
            e.preventDefault();
            e.stopPropagation();
            if (actionWindow === "2") {
                state.window2.mapOptionsOpen = !state.window2.mapOptionsOpen;
            } else {
                state.mapOptionsOpen = !state.mapOptionsOpen;
            }
            render();
            return;
        }

        if (action === "toggle-map-borders") {
            const checkbox = actionElement as HTMLInputElement | null;
            if (!checkbox) return;
            if (actionWindow === "2") {
                state.window2.mapShowBorders = checkbox.checked;
                setMapOverlayVisibilityW2({ showBorders: state.window2.mapShowBorders, showLabels: state.window2.mapShowCities });
            } else {
                state.mapShowBorders = checkbox.checked;
                setMapOverlayVisibility({ showBorders: state.mapShowBorders, showLabels: state.mapShowCities });
            }
            render();
            return;
        }

        if (action === "toggle-map-cities") {
            const checkbox = actionElement as HTMLInputElement | null;
            if (!checkbox) return;
            if (actionWindow === "2") {
                state.window2.mapShowCities = checkbox.checked;
                setMapOverlayVisibilityW2({ showBorders: state.window2.mapShowBorders, showLabels: state.window2.mapShowCities });
            } else {
                state.mapShowCities = checkbox.checked;
                setMapOverlayVisibility({ showBorders: state.mapShowBorders, showLabels: state.mapShowCities });
            }
            render();
            return;
        }

        if (action === "toggle-split-view") {
            e.preventDefault();
            e.stopPropagation();
            state.splitView = true;
            render();
            loadClimateDataWindow2();
            return;
        }

        if (action === "close-split-view") {
            e.preventDefault();
            e.stopPropagation();
            state.splitView = false;
            persistentCanvas2?.remove();
            persistentCanvas2 = null;
            render();
            return;
        }

        if (action === "toggle-legend") {
            e.preventDefault();
            e.stopPropagation();
            const w = (actionElement?.getAttribute("data-window") ||
                "1") as "1" | "2";
            if (w === "2") {
                state.window2.legendCollapsed = !state.window2.legendCollapsed;
            } else {
                state.legendCollapsed = !state.legendCollapsed;
            }
            render();
            return;
        }

        if (action === "legend-pin-toggle") {
            e.preventDefault();
            e.stopPropagation();
            const w = (actionElement?.getAttribute("data-window") || "1") as "1" | "2";
            const s = w === "2" ? state.window2 : state;
            if (!s.legendPinned) {
                // Pin and open tooltip
                s.legendPinned = true;
                s.legendPinnedMin = s.dataMin;
                s.legendPinnedMax = s.dataMax;
                legendPinTooltipOpen = w;
            } else {
                // Already pinned — toggle tooltip
                legendPinTooltipOpen = legendPinTooltipOpen === w ? null : w;
            }
            render();
            return;
        }

        if (action === "legend-pin-unpin") {
            e.preventDefault();
            e.stopPropagation();
            const w = (actionElement?.getAttribute("data-window") || "1") as "1" | "2";
            const s = w === "2" ? state.window2 : state;
            s.legendPinned = false;
            s.legendPinnedMin = null;
            s.legendPinnedMax = null;
            legendPinTooltipOpen = null;
            render();
            redrawMapForPinnedRange(w);
            return;
        }

        if (action === "legend-pin-reset") {
            e.preventDefault();
            e.stopPropagation();
            const w = (actionElement?.getAttribute("data-window") || "1") as "1" | "2";
            const s = w === "2" ? state.window2 : state;
            s.legendPinnedMin = s.dataMin;
            s.legendPinnedMax = s.dataMax;
            render();
            redrawMapForPinnedRange(w);
            return;
        }

        if (action === "tutorial-continue") {
            e.preventDefault();
            e.stopPropagation();

            const tutorialState = getTutorialState();
            const currentStepId =
                TUTORIAL_STEPS[tutorialState.currentStep]?.id ?? "";

            if (currentStepId === "compare-switch") {
                const compareBtn = document.querySelector<HTMLElement>(
                    '[data-action="set-mode"][data-value="Compare"]',
                );
                if (compareBtn) {
                    compareBtn.click();
                    return;
                }
            }

            if (currentStepId === "chat-switch") {
                const chatBtn = document.querySelector<HTMLElement>(
                    '[data-action="set-tab"][data-value="Chat"]',
                );
                if (chatBtn) {
                    chatBtn.click();
                    return;
                }
            }

            if (currentStepId === "analysis-switch") {
                const analysisBtn = document.querySelector<HTMLElement>(
                    '[data-action="set-canvas"][data-value="chart"]',
                );
                if (analysisBtn) {
                    analysisBtn.click();
                    return;
                }
            }

            completeCurrentStep();
            render();
            return;
        }

        if (action === "close-tutorial") {
            e.preventDefault();
            e.stopPropagation();
            endTutorial();
            render();
            return;
        }

        if (action === "start-tutorial") {
            e.preventDefault();
            e.stopPropagation();
            state.canvasView = "map";
            state.mode = "Explore";
            state.panelTab = "Manual";
            startTutorial();
            render();
            return;
        }

        // Handle tutorial progression for select options - detect when a selection is made during tutorial
        if (action === "update-select") {
            const tutorialState = getTutorialState();
            if (tutorialState.active) {
                const dataKey = actionElement?.getAttribute("data-key");

                // If clicking on the trigger (not an option), re-render to expand spotlight
                if (
                    target.classList.contains("custom-select-trigger") ||
                    target.closest(".custom-select-trigger")
                ) {
                    // Longer delay to let dropdown fully open and DOM update, then re-render to expand spotlight
                    setTimeout(() => {
                        render();
                    }, 50);
                }

                // Map tutorial steps to their data keys
                // Step 1: scenario, Step 2: model, Step 4: unit, Step 5: palette
                const stepToKey: { [key: number]: string } = {
                    1: "scenario",
                    2: "model",
                    4: "variable",
                    5: "unit",
                    6: "mapPalette",
                };

                // If this selection matches the current tutorial step's expected data key
                // and it's an option being clicked (not the trigger)
                if (
                    stepToKey[tutorialState.currentStep] === dataKey &&
                    (target.classList.contains("custom-select-option") ||
                        target.closest(".custom-select-option"))
                ) {
                    // Small delay to ensure the selection is processed first
                    setTimeout(() => {
                        completeCurrentStep();
                        render();
                    }, 100);
                }
            }
        }

        // Handle date input changes during tutorial
        if (action === "update-input") {
            // No-op: tutorial progression for date happens on valid change (blur/enter)
        }
    });

    let rangeHoverThrottle = 0;
    appRoot.addEventListener("mousemove", (e) => {
        const svgEl = (e.target as Element)?.closest<SVGSVGElement>('#map-range-svg');
        if (!svgEl) return;
        const vb = svgEl.viewBox.baseVal;
        const bbox = svgEl.getBoundingClientRect();
        if (!vb.width || !bbox.width) return;
        const scaleX = vb.width / bbox.width;
        const ml   = parseFloat(svgEl.dataset.marginLeft   ?? '70');
        const mt   = parseFloat(svgEl.dataset.marginTop    ?? '24');
        const plotW = parseFloat(svgEl.dataset.plotWidth   ?? '864');
        const plotH = parseFloat(svgEl.dataset.plotHeight  ?? '132');
        const domainStartTs = parseFloat(svgEl.dataset.domainStart ?? '0');
        const domainEndTs   = parseFloat(svgEl.dataset.domainEnd   ?? '0');
        const plotX = (e.clientX - bbox.left) * scaleX - ml;
        const hoverG = svgEl.querySelector<SVGGElement>('.mrh');
        if (!hoverG) return;
        if (plotX < 0 || plotX > plotW) {
            hoverG.setAttribute('opacity', '0');
            return;
        }
        const t = Math.max(0, Math.min(1, plotX / plotW));
        const dateStr = new Date(domainStartTs + t * (domainEndTs - domainStartTs)).toISOString().slice(0, 10);
        const absX = ml + plotX;
        const bgW = 72;
        const bgX = Math.max(ml, Math.min(absX - bgW / 2, ml + plotW - bgW));
        const line = hoverG.querySelector<SVGLineElement>('.mrh-line')!;
        const bg   = hoverG.querySelector<SVGRectElement>('.mrh-bg')!;
        const txt  = hoverG.querySelector<SVGTextElement>('.mrh-text')!;
        line.setAttribute('x1', String(absX));
        line.setAttribute('x2', String(absX));
        line.setAttribute('y1', String(mt));
        line.setAttribute('y2', String(mt + plotH));
        bg.setAttribute('x', String(bgX));
        bg.setAttribute('y', String(mt - 20));
        txt.setAttribute('x', String(bgX + bgW / 2));
        txt.setAttribute('y', String(mt - 7));
        txt.textContent = dateStr;
        hoverG.setAttribute('opacity', '1');
        // Throttle info-panel updates to ~60fps
        const now = Date.now();
        if (now - rangeHoverThrottle > 16) {
            rangeHoverThrottle = now;
            if (svgEl.closest('#map-range-overlay-w2')) {
                applyRangeSamplesAsMapInfoW2(dateStr);
            } else {
                applyRangeSamplesAsMapInfo(dateStr);
            }
        }
    });

    appRoot.addEventListener("mouseleave", (e) => {
        const target = e.target as Element;
        if (target?.id === 'map-range-svg') {
            (target as SVGSVGElement).querySelector<SVGGElement>('.mrh')?.setAttribute('opacity', '0');
            // Restore info panel to the actual selected date
            if (target.closest('#map-range-overlay-w2')) {
                applyRangeSamplesAsMapInfoW2(getCurrentDateForMode(state.window2));
            } else {
                applyRangeSamplesAsMapInfo(getCurrentDateForMode(state));
            }
        }
    }, true);

    // Re-render range chart on window resize so SVG width matches container
    // Also resize the map canvas pixel buffer to match its new CSS dimensions
    const rangeResizeObserver = new ResizeObserver(() => {
        const overlay = appRoot?.querySelector<HTMLElement>('#map-range-overlay');
        if (overlay) {
            const body = overlay.querySelector<HTMLElement>('.map-range-body');
            if (body) body.innerHTML = renderMapRangeBody();
        }
        const canvas = appRoot?.querySelector<HTMLCanvasElement>('#map-canvas');
        if (canvas) resizeMapCanvas(canvas);
        if (persistentCanvas2) resizeWindow2Canvas(persistentCanvas2);
    });
    rangeResizeObserver.observe(document.documentElement);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
