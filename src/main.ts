import * as d3 from "d3";
import {
    attachChatHandlers,
    type ChatContextData,
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
    renderTutorialButton,
    renderTutorialOverlay,
    startTutorial,
} from "./Components/tutorial";
import { drawLegendGradient, renderMapLegend } from "./MapView/legend";
import {
    getCurrentZoomLevel,
    projectLonLatToCanvas,
    renderMapData,
    setupMapInteractions,
    zoomToLocation,
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
    type Metadata,
    normalizeScenario,
} from "./Utils/dataClient";
import {
    flattenSeriesToSamples,
    generateToyRangeSeries,
} from "./Utils/mockChartData";
import { registerStateUpdateCallback } from "./Utils/stateUpdate";
import {
    convertValue,
    getDefaultUnitOption,
    getUnitOptions,
} from "./Utils/unitConverter";

// Toggle to switch between real API data and toy mock chart data (range mode)
const USE_TOY_RANGE_DATA = false;

type Mode = "Explore" | "Compare";
type PanelTab = "Manual" | "Chat";
type CanvasView = "map" | "chart";
type CompareMode = "Scenarios" | "Models" | "Dates";
type ChartMode = "single" | "range";
type ChartLocation = "World" | "Draw" | "Point" | "Search";
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
    const lower = input.toLowerCase();
    if (lower === "historical") return "Historical";
    if (lower === "ssp245") return "SSP245";
    if (lower === "ssp370") return "SSP370";
    if (lower === "ssp585") return "SSP585";
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
        name: "Magma",
        colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d"],
    },
    {
        name: "Cividis",
        colors: ["#00204c", "#31456a", "#6b6d7f", "#a59c8f", "#fdea9b"],
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
        background: "linear-gradient(135deg, #05070f, #0b1326)",
    },
    bgLayer2: {
        position: "absolute",
        inset: 0,
        background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 32%), radial-gradient(circle at 80% 10%, rgba(139,92,246,0.15), transparent 30%), radial-gradient(circle at 50% 70%, rgba(34,197,94,0.08), transparent 28%)",
    },
    bgOverlay: {
        position: "absolute",
        inset: 0,
        background: "#050505",
        opacity: 0.35,
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
    },
    mapInfoHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
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
        gridTemplateColumns: "1fr 1fr",
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
        width: "calc(50% - 2px)",
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
        gridTemplateColumns: "1fr 1fr",
        width: "200%",
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

export type AppState = {
    mode: Mode;
    panelTab: PanelTab;
    sidebarOpen: boolean;
    canvasView: CanvasView;
    scenario: string;
    model: string;
    variable: string;
    date: string;
    palette: string;
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
    mapMarker: MapMarker | null;
    mapInfoSamples: ChartSample[];
    mapInfoBoxes: ChartBox[] | null;
    mapInfoLoading: boolean;
    mapInfoError: string | null;
    mapInfoLoadingProgress: ChartLoadingProgress;
    mapInfoOpen: boolean;
    mapPolygon: LatLon[] | null;
    chartPolygon: LatLon[] | null;
    chartPoint: LatLon | null;
    drawState: DrawState;
    pointSelectActive: boolean;
    chatInput: string;
    chatMessages: ChatMessage[];
    chatIsLoading: boolean;
    availableModels: string[];
    compareMode: CompareMode;
    compareScenarioA: string;
    compareScenarioB: string;
    compareModelA: string;
    compareModelB: string;
    compareDateStart: string;
    compareDateEnd: string;
    isLoading: boolean;
    loadingProgress: number;
    dataError: string | null;
    currentData: ClimateData | null;
    apiAvailable: boolean | null;
    metaData?: Metadata;
    dataMin: number | null;
    dataMax: number | null;
    dataMean: number | null;
    timeRange: {
        start: string;
        end: string;
    } | null;
    compareInfoOpen: boolean;
};

//TODO set 0 from available models to active model and so on
const state: AppState = {
    mode: "Explore",
    panelTab: "Manual",
    sidebarOpen: true,
    canvasView: "map",
    scenario: scenarios[0],
    model: models[0],
    variable: variables[0],
    date: "2000-01-01",
    palette: paletteOptions[0].name,
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
    mapMarker: null,
    mapInfoSamples: [],
    mapInfoBoxes: null,
    mapInfoLoading: false,
    mapInfoError: null,
    mapInfoLoadingProgress: { total: 0, done: 0 },
    mapInfoOpen: false,
    mapPolygon: null,
    chartPolygon: null,
    chartPoint: null,
    drawState: { active: false, points: [], previewPoint: null },
    pointSelectActive: false,
    chatInput: "",
    chatMessages: [],
    chatIsLoading: false,
    compareMode: "Scenarios",
    availableModels: [],
    compareScenarioA: "SSP245",
    compareScenarioB: "SSP585",
    compareModelA: models[0],
    compareModelB: models[1] ?? models[0],
    compareDateStart: "1962-06-28",
    compareDateEnd: "2007-06-28",
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
};

let mapCanvas: HTMLCanvasElement | null = null;
let drawKeyHandler: ((e: KeyboardEvent) => void) | null = null;

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
let mapInfoRequestId = 0;
let mapInfoDelayTimer: number | null = null;
const LOCATION_SEARCH_DEBOUNCE_MS = 500;

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
    if (scenario === "Historical") {
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
 * Get the time range for a given scenario
 * - Historical: 1950-01-01 to 2014-12-31
 * - SSP245/SSP585: 2015-01-01 to 2100-12-31
 */
function getTimeRangeForScenario(scenario: string): {
    start: string;
    end: string;
} {
    if (scenario === "Historical") {
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
    const defaultUnit =
        state.metaData?.variable_metadata[state.variable]?.unit || "";
    setupMapInteractions(
        canvas,
        state.currentData,
        defaultUnit,
        state.variable,
        state.selectedUnit,
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

    return `
      <canvas
        id="draw-overlay-canvas"
        style="${styleAttr(styles.drawOverlayCanvas)}"
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
                marker.style.transform = `translate(${projected.x}px, ${projected.y}px) translate(-50%, -100%)`;
            }
        }
    }

    // Handle info panel positioning - show for both marker and polygon
    if (infoPanel && state.mapInfoOpen) {
        const rect = canvas.getBoundingClientRect();
        const panelWidth = infoPanel.offsetWidth || 360;
        const panelHeight = infoPanel.offsetHeight || 240;
        const padding = 12;

        let left: number;
        let top: number;

        if (state.mapMarker) {
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
            left = projected.x - panelWidth - 24;
            if (left < padding) {
                left = projected.x + 24;
            }
            top = projected.y - panelHeight / 2;
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
                left = leftmostProjected.x - panelWidth - 24;
                if (left < padding) {
                    left = leftmostProjected.x + 24;
                }
                top = leftmostProjected.y - panelHeight / 2;
            } else {
                // Fallback to center-right if projection fails
                left = rect.width - panelWidth - padding - 24;
                top = rect.height / 2 - panelHeight / 2;
            }
        } else {
            // Hide if neither marker nor polygon
            infoPanel.style.opacity = "0";
            infoPanel.style.transform = "translate(-9999px, -9999px)";
            infoPanel.style.pointerEvents = "none";
            infoPanel.style.visibility = "hidden";
            return;
        }

        left = Math.max(
            padding,
            Math.min(left, rect.width - panelWidth - padding),
        );
        top = Math.max(
            padding,
            Math.min(top, rect.height - panelHeight - padding),
        );

        // Only update position if it hasn't been set yet (to prevent glitching during data updates)
        const currentLeft = infoPanel.style.left;
        const currentTop = infoPanel.style.top;
        if (
            !currentLeft ||
            currentLeft === "0px" ||
            !currentTop ||
            currentTop === "0px"
        ) {
            infoPanel.style.left = `${left}px`;
            infoPanel.style.top = `${top}px`;
        }

        infoPanel.style.opacity = "1";
        infoPanel.style.transform = "translate(0, 0)";
        infoPanel.style.pointerEvents = "none";
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
    const shift = state.sidebarOpen ? -SIDEBAR_WIDTH / 2 : 0;
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

    if (!hasPoint && !hasPolygon) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">Click a location or draw a region to load boxplots.</div>`;
    }

    if (state.mapInfoLoading) {
        const progressText =
            state.mapInfoLoadingProgress.total > 0
                ? `${state.mapInfoLoadingProgress.done}/${state.mapInfoLoadingProgress.total} datasets loaded`
                : "Preparing datasets";
        const preview =
            state.mapInfoBoxes && state.mapInfoBoxes.length
                ? renderMiniChartSvg(state.mapInfoBoxes, state.selectedUnit)
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

    return renderMiniChartSvg(state.mapInfoBoxes, state.selectedUnit);
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
    const variableLabel = getVariableLabel(state.variable, state.metaData);
    const title = `${locationLabel} · ${variableLabel}`;
    const subtitle = `${formatDisplayDate(state.date)} · ${state.selectedUnit}`;
    return `
      <div id="map-info-panel" class="custom-select-info-panel map-info-panel" style="${styleAttr(
          styles.mapInfoPanel,
      )}">
        <div style="${styleAttr(styles.mapInfoHeader)}">
          <div style="${styleAttr(styles.mapInfoTitleGroup)}">
            <div class="custom-select-info-panel-title">${escapeHtml(
                title,
            )}</div>
            <div style="${styleAttr(styles.mapInfoSubtitle)}">${escapeHtml(
                subtitle,
            )}</div>
          </div>
          <div style="${styleAttr(styles.mapInfoActions)}">
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

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        trimmed,
    )}&limit=5&addressdetails=1`;
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": "climate-visualization-app/1.0",
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
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": "climate-visualization-app/1.0",
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
            const variableLabel = getVariableLabel(
                state.variable,
                state.metaData,
            );
            const locationLabel = placeName;
            const title = `${locationLabel} · ${variableLabel}`;
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
    render();
}

function updateMapInfoPreview(samples: ChartSample[]) {
    state.mapInfoSamples = samples;
    try {
        state.mapInfoBoxes = buildChartBoxes(
            samples,
            state.variable,
            state.selectedUnit,
        );
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
            return;
        }
    }

    // Fallback to full render if elements not found
    render();
}

async function loadMapInfoData() {
    if (state.canvasView !== "map") return;
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
        const matchingScenarios = scenarioOptions.filter((scenario) =>
            isDateWithinRange(state.date, getTimeRangeForScenario(scenario)),
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
                state.date,
                getTimeRangeForScenario(scenario),
            );

            if (hasPoint && state.mapMarker) {
                // Point selection - use pixel API
                const [x, y] = latLonToGridIndices(
                    state.mapMarker.lat,
                    state.mapMarker.lon,
                );

                const pixelPromises = modelOptions.map((model) =>
                    fetchPixelData({
                        variable: state.variable,
                        model,
                        x0: x,
                        x1: x,
                        y0: y,
                        y1: y,
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
                        const request = createDataRequest({
                            variable: state.variable,
                            date: dateForScenario,
                            model,
                            scenario,
                            resolution: 1,
                        });
                        return fetchClimateData(request).then((data) => {
                            const arr = dataToArray(data);
                            if (!arr) {
                                throw new Error(
                                    "No data returned for map info request.",
                                );
                            }
                            const avg = valueAtPoint(
                                arr,
                                state.variable,
                                data.shape,
                                {
                                    lat: state.mapMarker!.lat,
                                    lon: state.mapMarker!.lon,
                                },
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
                        });
                    }),
                );

                const pixelResults = await Promise.allSettled(pixelPromises);
                if (requestId !== mapInfoRequestId) return;

                for (const result of pixelResults) {
                    if (result.status === "fulfilled") {
                        const data = result.value;
                        if (
                            typeof data === "object" &&
                            "fallback" in data &&
                            data.fallback
                        ) {
                            samples.push({
                                scenario,
                                model: data.model,
                                rawValue: data.value,
                                dateUsed: dateForScenario,
                            });
                        } else {
                            const pixelData = data as any;
                            const value = pixelData.values[0];
                            if (value !== null && isFinite(value)) {
                                const rawValue =
                                    state.variable === "hurs"
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
                            "Failed to fetch pixel data for map info:",
                            result.reason,
                        );
                    }
                }

                state.mapInfoLoadingProgress = {
                    total: totalRequests,
                    done:
                        state.mapInfoLoadingProgress.done + modelOptions.length,
                };
                updateMapInfoPreview(samples);
            } else if (hasPolygon && state.mapPolygon) {
                // Polygon selection - use aggregate API
                const [x0, x1, y0, y1] = polygonToGridBounds(state.mapPolygon);
                const mask = createPolygonMask(
                    state.mapPolygon,
                    x0,
                    x1,
                    y0,
                    y1,
                );

                try {
                    const aggregateData = await fetchAggregateOnDemand({
                        variable: state.variable,
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
                                    state.variable === "hurs"
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
                            variable: state.variable,
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
                                    state.variable,
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
        render();
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
        render();
        return;
    }
    if (state.chartLocation === "Point" && !state.chartPoint) {
        state.chartError = "Click a point on the map to load chart data.";
        state.chartBoxes = null;
        state.chartRangeSeries = null;
        state.chartSamples = [];
        state.chartLoading = false;
        state.chartLoadingProgress = { total: 0, done: 0 };
        render();
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
        render();
        return;
    }

    state.chartLoading = true;
    state.chartError = null;
    setLoadingProgress(5, true);
    state.chartLoadingProgress = { total: 0, done: 0 };
    state.chartSamples = [];
    state.chartBoxes = null;
    state.chartRangeSeries = null;
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
            state.chartError = "Select at least one scenario and one model.";
            state.chartSamples = [];
            state.chartBoxes = null;
            state.chartRangeSeries = null;
            state.chartLoading = false;
            state.chartLoadingProgress = { total: 0, done: 0 };
            render();
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
            render();

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
                console.log("Using pixel-data API for efficient loading");
                // Use pixel-data API for efficient loading
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
                            const [x, y] = latLonToGridIndices(
                                state.chartPoint.lat,
                                state.chartPoint.lon,
                            );
                            console.log(
                                `Fetching pixel data for point (${x}, ${y}) for ${activeModels.length} models`,
                            );

                            // Parallelize requests for all models
                            const pixelPromises = activeModels.map((model) =>
                                fetchPixelData({
                                    variable: state.chartVariable,
                                    model,
                                    x0: x,
                                    x1: x,
                                    y0: y,
                                    y1: y,
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
                            );

                            const pixelResults =
                                await Promise.allSettled(pixelPromises);

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
                            const [x0, x1, y0, y1] = polygonToGridBounds(
                                state.chartPolygon,
                            );
                            const mask = createPolygonMask(
                                state.chartPolygon,
                                x0,
                                x1,
                                y0,
                                y1,
                            );

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
                    render();

                    const samples: ChartSample[] = [];

                    for (const model of activeModels) {
                        for (const scenario of activeScenarios) {
                            const scenarioRange =
                                getTimeRangeForScenario(scenario);
                            // Clip date range to scenario's valid range
                            const clippedStart = clipDateToRange(
                                rangeStart,
                                scenarioRange,
                            );
                            const clippedEnd = clipDateToRange(
                                rangeEnd,
                                scenarioRange,
                            );

                            if (
                                parseDate(clippedStart) > parseDate(clippedEnd)
                            ) {
                                continue; // Skip if no valid date range for this scenario
                            }

                            const done = state.chartLoadingProgress.done;
                            setLoadingProgress(
                                Math.min(
                                    95,
                                    Math.round(
                                        ((done + 0.1) / totalRequests) * 100,
                                    ),
                                ),
                            );

                            try {
                                if (
                                    (state.chartLocation === "Point" ||
                                        state.chartLocation === "Search") &&
                                    state.chartPoint
                                ) {
                                    // Single point: use pixel-data API with date range
                                    const [x, y] = latLonToGridIndices(
                                        state.chartPoint.lat,
                                        state.chartPoint.lon,
                                    );
                                    const pixelData = await fetchPixelData({
                                        variable: state.chartVariable,
                                        model,
                                        x0: x,
                                        x1: x,
                                        y0: y,
                                        y1: y,
                                        start_date: clippedStart,
                                        end_date: clippedEnd,
                                        scenario: normalizeScenario(scenario),
                                        resolution: "low",
                                        step_days: 1,
                                    });

                                    // Convert time series response to samples
                                    for (
                                        let i = 0;
                                        i < pixelData.timestamps.length;
                                        i++
                                    ) {
                                        const timestamp =
                                            pixelData.timestamps[i];
                                        if (
                                            useFixedAnnualSamples &&
                                            !isSameMonthDay(
                                                timestamp,
                                                fixedReferenceDate,
                                            )
                                        ) {
                                            continue;
                                        }
                                        const value = pixelData.values[i];
                                        if (value !== null && isFinite(value)) {
                                            const rawValue =
                                                state.chartVariable === "hurs"
                                                    ? Math.min(value, 100)
                                                    : value;
                                            samples.push({
                                                scenario,
                                                model,
                                                rawValue,
                                                dateUsed: timestamp,
                                            });
                                        }
                                    }
                                    updateChartPreview(samples);
                                } else if (
                                    state.chartLocation === "Draw" &&
                                    state.chartPolygon &&
                                    state.chartPolygon.length >= 3
                                ) {
                                    // Polygon: use aggregate-on-demand API with date range
                                    const [x0, x1, y0, y1] =
                                        polygonToGridBounds(state.chartPolygon);
                                    const mask = createPolygonMask(
                                        state.chartPolygon,
                                        x0,
                                        x1,
                                        y0,
                                        y1,
                                    );

                                    const aggregateData =
                                        await fetchAggregateOnDemand({
                                            variable: state.chartVariable,
                                            models: [model],
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

                                    const modelData =
                                        aggregateData.models[model];
                                    if (modelData) {
                                        // Convert time series response to samples
                                        for (
                                            let i = 0;
                                            i < modelData.timestamps.length;
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
                                            ) {
                                                continue;
                                            }
                                            const value = modelData.values[i];
                                            if (
                                                value !== null &&
                                                isFinite(value)
                                            ) {
                                                const rawValue =
                                                    state.chartVariable ===
                                                    "hurs"
                                                        ? Math.min(value, 100)
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
                                    updateChartPreview(samples);
                                }
                            } catch (error) {
                                // If pixel API fails, fall back to old method with sampled dates
                                console.warn(
                                    "Pixel API failed, falling back to full map load:",
                                    error,
                                );
                                const sampledDates = useFixedAnnualSamples
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
                                    ) {
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
                                            "Range fallback request failed, skipping date:",
                                            error,
                                        );
                                        continue; // Skip failed dates
                                    }
                                    const arr = dataToArray(data);
                                    if (!arr) {
                                        continue; // Skip failed dates
                                    }
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
                                            : (state.chartLocation ===
                                                    "Point" ||
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
                                }
                                updateChartPreview(samples);
                            }

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
                        }
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
                        render();
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
                    render();

                    const samples: ChartSample[] = [];

                    for (const model of activeModels) {
                        for (const scenario of activeScenarios) {
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
                                    continue;
                                }
                                const done = state.chartLoadingProgress.done;
                                setLoadingProgress(
                                    Math.min(
                                        95,
                                        Math.round(
                                            ((done + 0.1) / totalRequests) *
                                                100,
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
                                let data: ClimateData | null = null;
                                try {
                                    data = await fetchClimateData(request);
                                } catch (error) {
                                    console.warn(
                                        "Range request failed, skipping date:",
                                        error,
                                    );
                                    continue;
                                }
                                const after =
                                    state.chartLoadingProgress.done + 1;
                                state.chartLoadingProgress = {
                                    total: totalRequests,
                                    done: after,
                                };
                                setLoadingProgress(
                                    Math.min(
                                        98,
                                        Math.round(
                                            (after / totalRequests) * 100,
                                        ),
                                    ),
                                );
                                updateChartPreview(samples);
                                const arr = dataToArray(data);
                                if (!arr) {
                                    throw new Error(
                                        "No data returned for chart request.",
                                    );
                                }
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
                            }
                        }
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
        render();
    }
}

async function loadClimateData() {
    console.log("fetching");
    if (state.canvasView !== "map") {
        return;
    }

    state.isLoading = true;
    setLoadingProgress(5, true);

    state.dataError = null;

    try {
        const metaData = await fetchMetadata();
        state.metaData = metaData;
        state.availableModels = metaData.models;
        setLoadingProgress(20);

        const activeScenarioForRange =
            state.mode === "Compare" && state.compareMode === "Scenarios"
                ? state.compareScenarioA
                : state.scenario;
        // Update time range based on the scenario driving the current request
        state.timeRange = getTimeRangeForScenario(activeScenarioForRange);
        setLoadingProgress(30);

        const result =
            state.mode === "Compare"
                ? await loadCompareData(
                      activeScenarioForRange,
                      setLoadingProgress,
                  )
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

        state.currentData = result.data;
        state.dataMin = result.min;
        state.dataMax = result.max;
        state.dataMean = result.mean;

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

function renderBranding() {
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
        state.mode === "Explore" ? "translateX(0%)" : "translateX(-50%)";
    const modeIndicatorTransform =
        state.mode === "Explore" ? "translateX(0%)" : "translateX(100%)";
    const canvasIndicatorTransform =
        state.canvasView === "map" ? "translateX(0%)" : "translateX(100%)";
    const tabTransform =
        state.panelTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";

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
                ? renderMapLegend(
                      state.variable,
                      state.dataMin,
                      state.dataMax,
                      state.metaData,
                      state.selectedUnit,
                      state.mode === "Compare",
                  )
                : ""
        }
      <div style="${styleAttr(styles.mapArea)}">
        ${
            state.canvasView === "map"
                ? `
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
                      ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10;">
                      <div style="text-align: center; max-width: 600px; padding: 20px;">
                        <div style="${styleAttr(
                            styles.mapTitle,
                        )}">Error loading data</div>
                        <div style="${styleAttr(styles.mapSubtitle)}">${
                            state.dataError
                        }</div>
                        ${
                            state.apiAvailable === false
                                ? `<div style="${styleAttr(
                                      mergeStyles(styles.mapSubtitle, {
                                          marginTop: 12,
                                          fontSize: 12,
                                      }),
                                  )}">
                                Make sure the Python API server is running. Check the terminal for connection details.
                              </div>`
                                : ""
                        }
                      </div>
                    </div>`
                      : ""
              }
              ${
                  !state.isLoading && !state.dataError && !state.currentData
                      ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); z-index: 5;">
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
                : renderChartArea()
        }
      </div>

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
      </aside>

      <div data-role="canvas-toggle" style="${styleAttr({
          ...styles.canvasToggle,
          right: state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24,
      })}">
        <div style="${styleAttr(styles.canvasSwitch)}">
          <div data-role="canvas-indicator" style="${styleAttr({
              ...styles.canvasIndicator,
              transform: canvasIndicatorTransform,
          })}"></div>
          <button
            type="button"
            aria-label="Show map canvas"
            data-action="set-canvas"
            data-value="map"
            style="${styleAttr(
                mergeStyles(
                    styles.canvasBtn,
                    state.canvasView === "map"
                        ? styles.canvasBtnActive
                        : undefined,
                ),
            )}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6">
              <path d="M4 6.5 9 4l6 2.5L20 4v14l-5 2.5L9 18 4 20.5V6.5Z" />
              <path d="m9 4v14m6-11.5v14" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Show chart canvas"
            data-action="set-canvas"
            data-value="chart"
            style="${styleAttr(
                mergeStyles(
                    styles.canvasBtn,
                    state.canvasView === "chart"
                        ? styles.canvasBtnActive
                        : undefined,
                ),
            )}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8">
              <path d="M4 18h16" />
              <path d="M6 18 11 9l4 5 3-6" />
              <circle cx="6" cy="18" r="1.2" />
              <circle cx="11" cy="9" r="1.2" />
              <circle cx="15" cy="14" r="1.2" />
              <circle cx="18" cy="8" r="1.2" />
            </svg>
          </button>
        </div>
      </div>

      ${renderCompareInfo(state)}

      ${renderSidebarToggle(state.sidebarOpen)}

      ${
          state.canvasView === "map"
              ? renderTimeSlider({
                    date: state.date,
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

      ${renderTutorialButton()}
      ${renderTutorialOverlay(getTutorialState())}
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
            deltaX = (window.innerWidth - padding) - rect.right;
        } else if (rect.left < padding) {
            deltaX = padding - rect.left;
        }

        if (rect.bottom > window.innerHeight - padding) {
            deltaY = (window.innerHeight - padding) - rect.bottom;
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
        if (
            state.currentData &&
            !state.dataError &&
            state.dataMin !== null &&
            state.dataMax !== null
        ) {
            applyMapInteractions(mapCanvas);
            renderMapData(
                state.currentData,
                mapCanvas,
                paletteOptions,
                state.palette,
                state.dataMin,
                state.dataMax,
                state.variable,
                state.selectedUnit,
            );

            // Draw the gradient on the legend canvas
            const palette =
                paletteOptions.find((p) => p.name === state.palette) ||
                paletteOptions[0];
            drawLegendGradient("legend-gradient-canvas", palette.colors);

            // Render overlay if actively drawing or if there's a completed polygon
            if (
                state.drawState.active ||
                (state.mapPolygon !== null && state.mapPolygon.length >= 3)
            ) {
                requestAnimationFrame(renderDrawOverlayPaths);
            }
        }
    }

    // Apply responsive padding to charts after DOM is ready
    const currentPadding = (state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24) + 8;
    const scale = state.sidebarOpen ? 1 : 0.9;
    applyChartLayoutOffset(currentPadding, scale);
    updateMapSearchPosition();
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

function renderChartSvg(boxes: ChartBox[]): string {
    if (!boxes.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const sortedBoxes = [...boxes].sort((a, b) => {
        return scenarios.indexOf(a.scenario) - scenarios.indexOf(b.scenario);
    });

    const palette =
        paletteOptions.find((p) => p.name === state.palette) ||
        paletteOptions[0];
    const colors = palette.colors;

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
          }" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.08)" />
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
            const color = colors[idx % colors.length];
            const { min, q1, median, q3, max, mean } = box.stats;
            const boxTop = yScale(q3) + margin.top;
            const boxBottom = yScale(q1) + margin.top;
            const rectHeight = Math.max(2, boxBottom - boxTop);
            return `
        <g>
          <line x1="${x}" x2="${x}" y1="${yScale(min) + margin.top}" y2="${
              yScale(max) + margin.top
          }" stroke="${color}" stroke-width="2" stroke-linecap="round" />
          <rect x="${
              x - 24
          }" y="${boxTop}" width="48" height="${rectHeight}" fill="rgba(255,255,255,0.06)" stroke="${color}" stroke-width="2" rx="6" />
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
        </g>
      `;
        })
        .join("");

    const axisLine = `
      <line
        x1="${margin.left}"
        x2="${margin.left}"
        y1="${margin.top}"
        y2="${height - margin.bottom}"
        stroke="rgba(255,255,255,0.65)"
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
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Global box plots" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto;">
        ${axisLine}
        ${axisTicks}
        ${boxesMarkup}
        ${yLabel}
      </svg>
    `;
}

function renderMiniChartSvg(boxes: ChartBox[], unitLabel: string): string {
    if (!boxes.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const sortedBoxes = [...boxes].sort((a, b) => {
        return scenarios.indexOf(a.scenario) - scenarios.indexOf(b.scenario);
    });

    const palette =
        paletteOptions.find((p) => p.name === state.palette) ||
        paletteOptions[0];
    const colors = palette.colors;

    const width = 560;
    const height = 300;
    const margin = { top: 18, right: 16, bottom: 52, left: 48 };
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
    const yTicks = yScale.ticks(4);

    const xStep = plotWidth / (sortedBoxes.length + 1);

    const axisTicks = yTicks
        .map((tick) => {
            const y = yScale(tick) + margin.top;
            return `
        <g>
          <line x1="${margin.left}" x2="${
              width - margin.right
          }" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.06)" />
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
            const color = colors[idx % colors.length];
            const { min, q1, median, q3, max, mean } = box.stats;
            const boxTop = yScale(q3) + margin.top;
            const boxBottom = yScale(q1) + margin.top;
            const rectHeight = Math.max(2, boxBottom - boxTop);
            return `
        <g>
          <line x1="${x}" x2="${x}" y1="${yScale(min) + margin.top}" y2="${
              yScale(max) + margin.top
          }" stroke="${color}" stroke-width="1.6" stroke-linecap="round" />
          <rect x="${
              x - 16
          }" y="${boxTop}" width="32" height="${rectHeight}" fill="rgba(255,255,255,0.06)" stroke="${color}" stroke-width="1.6" rx="5" />
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
        </g>
      `;
        })
        .join("");

    const axisLine = `
      <line
        x1="${margin.left}"
        x2="${margin.left}"
        y1="${margin.top}"
        y2="${height - margin.bottom}"
        stroke="rgba(255,255,255,0.55)"
        stroke-width="1"
      />
    `;

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mini box plots" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto;">
        ${axisLine}
        ${axisTicks}
        ${boxesMarkup}
        <text x="${margin.left}" y="${margin.top - 6}" fill="var(--text-secondary)" font-size="9">${escapeHtml(
            unitLabel,
        )}</text>
      </svg>
    `;
}

function renderChartRangeSvg(series: ChartSeries[]): string {
    if (!series.length) {
        return `<div style="${styleAttr(
            styles.chartEmpty,
        )}">No chart data loaded yet.</div>`;
    }

    const palette =
        paletteOptions.find((p) => p.name === state.palette) ||
        paletteOptions[0];
    const colors = palette.colors;

    const width = 960;
    const height = 460;
    const margin = { top: 28, right: 32, bottom: 82, left: 86 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

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
    const xTicks = xScale.ticks(6);
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
          }" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.08)" />
          <text x="${margin.left - 10}" y="${
              y + 4
          }" fill="var(--text-secondary)" font-size="11" text-anchor="end">
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
          }" stroke="rgba(255,255,255,0.06)" />
          <text x="${x}" y="${height - margin.bottom + 26}" fill="var(--text-secondary)" font-size="11" text-anchor="middle">
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
        x="${margin.left - 70}"
        y="${margin.top + plotHeight / 2}"
        fill="var(--text-secondary)"
        font-size="12"
        text-anchor="middle"
        transform="rotate(-90 ${margin.left - 70} ${margin.top + plotHeight / 2})"
      >
        ${state.chartUnit}
      </text>
    `;

    return `
      <div style="width:100%; display:flex; flex-direction:column; gap:12px; align-items:center;">
        <div style="position:relative; width:100%; display:flex; justify-content:center;">
          <div style="position:absolute; top:10px; right:16px; display:flex; gap:12px; align-items:center; color:var(--text-secondary); font-size:11.5px; z-index:2;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:26px; height:0; border-top:1px solid var(--text-primary);"></span>
              <span>Median</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="display:inline-block; width:26px; height:0; border-top:1px dashed var(--text-primary);"></span>
              <span>Mean</span>
            </div>
          </div>
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution over time" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto;">
            ${axisTicksY}
            ${axisTicksX}
            <path
              d="M ${margin.left} ${margin.top} L ${margin.left} ${height - margin.bottom} L ${width - margin.right} ${height - margin.bottom}"
              fill="none"
              stroke="rgba(255,255,255,0.6)"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            ${seriesMarkup}
            ${yLabel}
          </svg>
        </div>
        <div style="${styleAttr(styles.chartLegend)}">
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
        </div>
      </div>
    `;
}

function renderChartArea() {
    let body = "";
    const isRangeMode = state.chartMode === "range";
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
                  ? renderChartSvg(state.chartBoxes)
                  : isRangeMode && state.chartRangeSeries
                    ? renderChartRangeSvg(state.chartRangeSeries)
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
            ? renderChartRangeSvg(state.chartRangeSeries ?? [])
            : renderChartSvg(state.chartBoxes ?? []);
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

    const paddingRight = state.sidebarOpen ? SIDEBAR_WIDTH + 32 : 24;

    return `
      <div data-role="chart-container" style="pointer-events:auto; width:100%; display:flex; align-items:center; justify-content:center; padding:24px; padding-right:${paddingRight}px;">
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
    opts?: { type?: string; dataKey?: string; min?: string; max?: string; dataRole?: string },
) {
    const type = opts?.type ?? "date";
    const dataKey = opts?.dataKey ?? name;
    const minAttr = opts?.min ? `min="${opts.min}"` : "";
    const maxAttr = opts?.max ? `max="${opts.max}"` : "";
    const dataRole = opts?.dataRole ? `data-role="${opts.dataRole}"` : "";
    return `
    <input
      type="${type}"
      value="${value}"
      data-action="update-input"
      data-key="${dataKey}"
      ${minAttr}
      ${maxAttr}
      ${dataRole}
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

    return `
    <div class="custom-select-container">
      <div class="custom-select-info-panel" id="${uniqueId}-info" role="tooltip"></div>
      <div class="custom-select-wrapper" ${dataRole} data-key="${dataKey}" ${
          disabled ? 'data-disabled="true"' : ""
      } ${infoType ? `data-info-type="${infoType}"` : ""}>
        <div class="custom-select-trigger" data-action="update-select" data-key="${dataKey}" id="${uniqueId}-trigger" ${
            disabled ? 'aria-disabled="true"' : ""
        } tabindex="${disabled ? "-1" : "0"}">
          <span class="custom-select-value">${displayValue}</span>
          <svg class="custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="custom-select-dropdown" id="${uniqueId}-dropdown" role="listbox">
          ${options
              .map(
                  (opt) => `
                <div class="custom-select-option ${
                    opt === current ? "selected" : ""
                }" 
                     data-value="${opt}" 
                     data-action="update-select" 
                     data-key="${dataKey}"
                     role="option"
                     ${opt === current ? 'aria-selected="true"' : ""}
                     tabindex="0">
                  ${opt}
                </div>
              `,
              )
              .join("")}
          ${extraContent}
        </div>
      </div>
    </div>
  `;
}

function renderTabButton(
    value: PanelTab,
    activeStyle?: Style,
    dataKey = "panel-tab",
) {
    return `
    <button
      type="button"
      data-action="set-tab"
      data-key="${dataKey}"
      data-value="${value}"
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
}) {
    const { modeTransform, resolutionFill, modeIndicatorTransform } = params;
    const compareParameters =
        state.compareMode === "Models"
            ? [
                  renderField(
                      "Scenario",
                      renderSelect("scenario", scenarios, state.scenario, {
                          infoType: "scenario",
                      }),
                  ),
                  renderField("Date", renderInput("date", state.date)),
              ]
            : state.compareMode === "Dates"
              ? [
                    renderField(
                        "Scenario",
                        renderSelect("scenario", scenarios, state.scenario, {
                            infoType: "scenario",
                        }),
                    ),
                    renderField(
                        "Model",
                        renderSelect("model", models, state.model, {
                            infoType: "model",
                        }),
                    ),
                ]
              : [
                    renderField(
                        "Model",
                        renderSelect("model", models, state.model, {
                            infoType: "model",
                        }),
                    ),
                    renderField("Date", renderInput("date", state.date)),
                ];

    return `
    <div style="${styleAttr(styles.modeSwitch)}">
      <div data-role="mode-indicator" style="${styleAttr({
          ...styles.modeIndicator,
          transform: modeIndicatorTransform,
      })}"></div>
      ${(["Explore", "Compare"] as const)
          .map(
              (value) =>
                  `
            <button
              type="button"
              class="mode-btn"
              data-action="set-mode"
              data-value="${value}"
              style="${styleAttr(
                  mergeStyles(
                      styles.modeBtn,
                      state.mode === value ? styles.modeBtnActive : undefined,
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
                  renderSelect("scenario", scenarios, state.scenario, {
                      infoType: "scenario",
                      dataRole: "scenario-selector",
                  }),
              )}
              ${renderField(
                  "Model",
                  renderSelect("model", models, state.model, {
                      infoType: "model",
                      dataRole: "model-selector",
                  }),
              )}
              ${renderField(
                  "Date",
                  (() => {
                      const timeRange = getTimeRangeForScenario(state.scenario);
                      return renderInput("date", state.date, {
                          min: timeRange.start,
                          max: timeRange.end,
                          dataRole: "date-picker",
                      });
                  })(),
              )}
              ${renderField(
                  "Variable",
                  renderSelect("variable", variables, state.variable, {
                      infoType: "variable",
                      dataRole: "variable-selector",
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
              <div style="${styleAttr(styles.sectionTitle)}">Unit</div>
              ${renderField(
                  "",
                  renderSelect(
                      "unit",
                      getUnitOptions(state.variable).map((opt) => opt.label),
                      state.selectedUnit,
                      { dataKey: "unit", dataRole: "unit-selector" },
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
              <div style="${styleAttr(styles.sectionTitle)}">Color palette</div>
              ${renderField(
                  "",
                  renderSelect(
                      "palette",
                      paletteOptions.map((p) => p.name),
                      state.palette,
                      { dataKey: "palette", dataRole: "palette-selector" },
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
              <div style="${styleAttr(styles.sectionTitle)}">Resolution</div>
              <div style="${styleAttr(styles.resolutionRow)}">
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value="${state.resolution}"
                  data-action="set-resolution"
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
                    state.resolution === 1
                        ? "Low"
                        : state.resolution === 2
                          ? "Medium"
                          : "High"
                }</div>
              </div>
            </div>
          </div>
        </div>

        <div class="mode-pane-scrollable" style="${styleAttr(styles.modePane)}">
          <div style="${styleAttr({
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
                        state.compareMode,
                        {
                            dataKey: "compareMode",
                        },
                    ),
                )}
              </div>

              ${
                  state.compareMode === "Scenarios"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Scenario A",
                            renderSelect(
                                "compareScenarioA",
                                ["SSP245", "SSP370", "SSP585"],
                                state.compareScenarioA,
                                {
                                    dataKey: "compareScenarioA",
                                    infoType: "scenario",
                                },
                            ),
                        )}
                        ${renderField(
                            "Scenario B",
                            renderSelect(
                                "compareScenarioB",
                                ["SSP245", "SSP370", "SSP585"],
                                state.compareScenarioB,
                                {
                                    dataKey: "compareScenarioB",
                                    infoType: "scenario",
                                },
                            ),
                        )}
                      </div>
                    `
                      : ""
              }

              ${
                  state.compareMode === "Models"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Model A",
                            renderSelect(
                                "compareModelA",
                                (() => {
                                    const filtered = models.filter(
                                        (m) => m !== state.compareModelB,
                                    );
                                    // Ensure current value is always available
                                    if (
                                        !filtered.includes(state.compareModelA)
                                    ) {
                                        return [
                                            state.compareModelA,
                                            ...filtered,
                                        ];
                                    }
                                    return filtered;
                                })(),
                                state.compareModelA,
                                { dataKey: "compareModelA", infoType: "model" },
                            ),
                        )}
                        ${renderField(
                            "Model B",
                            renderSelect(
                                "compareModelB",
                                (() => {
                                    const filtered = models.filter(
                                        (m) => m !== state.compareModelA,
                                    );
                                    // Ensure current value is always available
                                    if (
                                        !filtered.includes(state.compareModelB)
                                    ) {
                                        return [
                                            state.compareModelB,
                                            ...filtered,
                                        ];
                                    }
                                    return filtered;
                                })(),
                                state.compareModelB,
                                { dataKey: "compareModelB", infoType: "model" },
                            ),
                        )}
                      </div>
                    `
                      : ""
              }

              ${
                  state.compareMode === "Dates"
                      ? `
                      <div style="${styleAttr(styles.paramGrid)}">
                        ${renderField(
                            "Start date",
                            renderInput(
                                "compareDateStart",
                                state.compareDateStart,
                                { dataKey: "compareDateStart" },
                            ),
                        )}
                        ${renderField(
                            "End date",
                            renderInput(
                                "compareDateEnd",
                                state.compareDateEnd,
                                { dataKey: "compareDateEnd" },
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
                    renderSelect("variable", variables, state.variable, {
                        infoType: "variable",
                    }),
                )}
              </div>

              <div style="margin-top:14px">
                <div style="${styleAttr({
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                })}">
                  <div style="${styleAttr(styles.sectionTitle)}">Unit</div>
                  ${renderField(
                      "",
                      renderSelect(
                          "unit",
                          getUnitOptions(state.variable).map(
                              (opt) => opt.label,
                          ),
                          state.selectedUnit,
                          { dataKey: "unit" },
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
                  <div style="${styleAttr(
                      styles.sectionTitle,
                  )}">Color palette</div>
                  ${renderField(
                      "",
                      renderSelect(
                          "palette",
                          paletteOptions.map((p) => p.name),
                          state.palette,
                          { dataKey: "palette" },
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
                  <div style="${styleAttr(
                      styles.sectionTitle,
                  )}">Resolution</div>
                  <div style="${styleAttr(styles.resolutionRow)}">
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="1"
                      value="${state.resolution}"
                      data-action="set-resolution"
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
                        state.resolution === 1
                            ? "Low"
                            : state.resolution === 2
                              ? "Medium"
                              : "High"
                    }</div>
                  </div>
                </div>
              </div>
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

function renderMapSearchBar() {
    if (state.canvasView !== "map") return "";
    const results =
        state.mapLocationSearchResults.length > 0
            ? state.mapLocationSearchResults
                  .map(
                      (res) => `
                <button
                  type="button"
                  class="location-search-result"
                  data-role="map-location-search-result"
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

    const hasQuery = state.mapLocationSearchQuery.trim().length > 0;
    const statusMessage = state.mapLocationSearchError
        ? `<div class="location-search-error">${escapeHtml(
              state.mapLocationSearchError,
          )}</div>`
        : state.mapLocationSearchLoading
          ? `<div class="location-search-status">Searching...</div>`
          : state.mapLocationSearchResults.length === 0 &&
              hasQuery &&
              !state.mapLocationSearchSelection
            ? `<div class="location-search-status">No places found. Try refining your query.</div>`
            : "";

    const showResultsPanel = Boolean(
        results || (statusMessage && !state.mapLocationSearchLoading),
    );
    const shift = state.sidebarOpen ? -SIDEBAR_WIDTH / 2 : 0;
    const wrapStyle = mergeStyles(styles.mapSearchWrap, {
        top: 18,
        transform: `translateX(calc(-50% + ${shift}px))`,
    });

    return `
      <div data-role="map-location-search" style="${styleAttr(wrapStyle)}">
        <div class="location-search-row" style="display: flex; align-items: center; gap: 8px;">
          <input
            type="text"
            class="location-search-input"
            value="${escapeHtml(state.mapLocationSearchQuery)}"
            placeholder="Search a place (e.g. Aachen)"
            data-role="map-location-search-input"
            style="flex: 1;"
          />
          <button
            type="button"
            data-action="toggle-map-draw"
            aria-label="${state.drawState.active ? "Stop drawing" : "Start drawing"}"
            style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 36px;
              height: 36px;
              padding: 0;
              border: 1px solid rgba(148, 163, 184, 0.3);
              border-radius: 6px;
              background: ${state.drawState.active ? "rgba(52, 211, 153, 0.1)" : "rgba(15, 23, 42, 0.85)"};
              color: ${state.drawState.active ? "#34d399" : "var(--text-secondary)"};
              cursor: pointer;
              transition: all 0.2s ease;
            "
            onmouseover="this.style.background='rgba(52, 211, 153, 0.2)';this.style.color='#34d399';"
            onmouseout="this.style.background='${state.drawState.active ? "rgba(52, 211, 153, 0.1)" : "rgba(15, 23, 42, 0.85)"}';this.style.color='${state.drawState.active ? "#34d399" : "var(--text-secondary)"}';"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        ${state.mapLocationSearchLoading ? statusMessage : ""}
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
    <div style="${styleAttr({
        display: "flex",
        flexDirection: "column",
        gap: 8,
    })}">
      <div style="${styleAttr(styles.sectionTitle)}">Chat</div>
      ${renderChatSection(state.chatMessages, state.chatInput)}
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

    setupBrandEyeTracking(root);

    attachSidebarHandlers({
        root,
        getSidebarOpen: () => state.sidebarOpen,
        setSidebarOpen: (isOpen) => {
            state.sidebarOpen = isOpen;
        },
        onTimeSliderUpdate: (isOpen) => {
            updateTimeSliderPosition(isOpen, SIDEBAR_WIDTH);
        },
        onCanvasToggleUpdate: (right) => {
            // keep charts aligned with toggle; +8 matches previous offset
            const scale = state.sidebarOpen ? 1 : 0.9;
            applyChartLayoutOffset(right + 8, scale);
            updateMapSearchPosition();
        },
    });

    const canvasButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-canvas"]',
    );
    canvasButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const value = btn.dataset.value as CanvasView | undefined;
            if (value) {
                if (value === state.canvasView) return;

                const previousView = state.canvasView;
                const previousIndicatorTransform =
                    previousView === "map"
                        ? "translateX(0%)"
                        : "translateX(100%)";
                const nextIndicatorTransform =
                    value === "map" ? "translateX(0%)" : "translateX(100%)";

                state.canvasView = value;

                const tutorialState = getTutorialState();
                if (
                    tutorialState.active &&
                    tutorialState.currentStep === 8 &&
                    value === "chart"
                ) {
                    completeCurrentStep();
                }

                render();

                if (value === "map") {
                    loadClimateData();
                } else {
                    loadChartData();
                }

                const canvasIndicator = root.querySelector<HTMLElement>(
                    '[data-role="canvas-indicator"]',
                );

                if (!canvasIndicator) return;

                canvasIndicator.style.removeProperty("transition");
                canvasIndicator.style.transform = previousIndicatorTransform;

                void canvasIndicator.offsetHeight;
                void canvasIndicator.getBoundingClientRect();

                requestAnimationFrame(() => {
                    canvasIndicator.style.transition = "transform 180ms ease";
                    canvasIndicator.style.transform = nextIndicatorTransform;
                });
            }
        }),
    );

    const modeButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-mode"]',
    );
    modeButtons.forEach((btn) =>
        btn.addEventListener("click", () => {
            const value = btn.dataset.value as Mode | undefined;
            if (value) {
                if (value === state.mode) return;

                const previousMode = state.mode;
                const previousModeTransform =
                    previousMode === "Explore"
                        ? "translateX(0%)"
                        : "translateX(-50%)";
                const previousIndicatorTransform =
                    previousMode === "Explore"
                        ? "translateX(0%)"
                        : "translateX(100%)";
                const nextModeTransform =
                    value === "Explore" ? "translateX(0%)" : "translateX(-50%)";
                const nextIndicatorTransform =
                    value === "Explore" ? "translateX(0%)" : "translateX(100%)";

                state.mode = value;
                render();

                const modeTrack = root.querySelector<HTMLElement>(
                    '[data-role="mode-track"]',
                );
                const modeIndicator = root.querySelector<HTMLElement>(
                    '[data-role="mode-indicator"]',
                );

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
            }
            if (state.canvasView === "map") {
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
            if (value) {
                if (value === state.panelTab) return;

                const previousTab = state.panelTab;
                const previousTabTransform =
                    previousTab === "Manual"
                        ? "translateX(0%)"
                        : "translateX(-50%)";
                const nextTabTransform =
                    value === "Manual" ? "translateX(0%)" : "translateX(-50%)";

                state.panelTab = value;
                render();

                const tabTrack = root.querySelector<HTMLElement>(
                    '[data-role="tab-track"]',
                );

                if (!tabTrack) return;

                tabTrack.style.removeProperty("transition");
                tabTrack.style.transform = previousTabTransform;

                void tabTrack.offsetHeight;
                void tabTrack.getBoundingClientRect();

                requestAnimationFrame(() => {
                    tabTrack.style.transition = "transform 220ms ease";
                    tabTrack.style.transform = nextTabTransform;
                });
            }
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

                // Trigger the change handler
                handleSelectChange(dataKey, value);

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
                        6: "palette",
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
    const handleSelectChange = async (key: string, val: string) => {
        if (!key) return;
        let triggerMapReload = false;
        let triggerChartReload = false;
        switch (key) {
            case "scenario":
                state.scenario = val;
                // Automatically update date to a valid date for the selected scenario
                state.date = getDateForScenario(val);
                // Update time range for the slider
                state.timeRange = getTimeRangeForScenario(val);
                triggerMapReload = true;
                break;
            case "model":
                state.model = val;
                triggerMapReload = true;
                break;
            case "variable":
                state.variable = val;
                // Reset unit to default for new variable
                state.selectedUnit = getDefaultUnitOption(val).label;
                triggerMapReload = true;
                break;
            case "unit":
                state.selectedUnit = val;
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
                        mapCanvas = canvas;
                        applyMapInteractions(canvas);
                        renderMapData(
                            state.currentData,
                            mapCanvas,
                            paletteOptions,
                            state.palette,
                            state.dataMin,
                            state.dataMax,
                            state.variable,
                            state.selectedUnit,
                        );

                        // Redraw gradient with new palette
                        const palette =
                            paletteOptions.find(
                                (p) => p.name === state.palette,
                            ) || paletteOptions[0];
                        drawLegendGradient(
                            "legend-gradient-canvas",
                            palette.colors,
                        );
                    }
                }
                if (state.mapMarker) {
                    if (state.mapInfoOpen) {
                        if (state.mapInfoSamples.length) {
                            state.mapInfoBoxes = buildChartBoxes(
                                state.mapInfoSamples,
                                state.variable,
                                state.selectedUnit,
                            );
                            render();
                        } else if (!state.mapInfoLoading) {
                            void loadMapInfoData();
                        }
                    }
                }
                return;
            case "palette":
                state.palette = val;
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
                            state.palette,
                            state.dataMin,
                            state.dataMax,
                            state.variable,
                            state.selectedUnit,
                        );

                        // Redraw gradient with new palette
                        const palette =
                            paletteOptions.find(
                                (p) => p.name === state.palette,
                            ) || paletteOptions[0];
                        drawLegendGradient(
                            "legend-gradient-canvas",
                            palette.colors,
                        );
                    }
                }
                return;
            case "compareMode":
                state.compareMode = val as CompareMode;
                triggerMapReload = true;
                break;
            case "compareScenarioA":
                // Prevent selecting the same scenario as B
                if (val === state.compareScenarioB) {
                    // If trying to select the same as B, swap them
                    state.compareScenarioB = state.compareScenarioA;
                }
                state.compareScenarioA = val;
                triggerMapReload = true;
                break;
            case "compareScenarioB":
                // Prevent selecting the same scenario as A
                if (val === state.compareScenarioA) {
                    // If trying to select the same as A, swap them
                    state.compareScenarioA = state.compareScenarioB;
                }
                state.compareScenarioB = val;
                triggerMapReload = true;
                break;
            case "compareModelA":
                // Prevent selecting the same model as B
                if (val === state.compareModelB) {
                    // If trying to select the same as B, swap them
                    state.compareModelB = state.compareModelA;
                }
                state.compareModelA = val;
                triggerMapReload = true;
                break;
            case "compareModelB":
                // Prevent selecting the same model as A
                if (val === state.compareModelA) {
                    // If trying to select the same as A, swap them
                    state.compareModelA = state.compareModelB;
                }
                state.compareModelB = val;
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
        render();
        if (state.canvasView === "map" && triggerMapReload) {
            loadClimateData();
            const hasPoint = state.mapMarker !== null;
            const hasPolygon =
                state.mapPolygon !== null && state.mapPolygon.length >= 3;
            if ((hasPoint || hasPolygon) && state.mapInfoOpen) {
                void loadMapInfoData();
            }
        }
        if (
            state.canvasView === "chart" &&
            (triggerChartReload || triggerMapReload)
        ) {
            loadChartData();
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
                    render();
                    return;
                }

                if (hadResults || wasLoading || hadError) {
                    state.chartLocationSearchResults = [];
                    state.chartLocationSearchLoading = false;
                    render();
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
        input.addEventListener("focus", () => {
            state.mapLocationSearchFocused = true;
        });
        const syncCursor = () => {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            state.mapLocationSearchCursor = { start, end };
        };
        input.addEventListener("input", () => {
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

            if (!trimmed) {
                state.mapLocationSearchResults = [];
                state.mapLocationSearchLoading = false;
                render();
                return;
            }

            if (hadResults || wasLoading || hadError) {
                state.mapLocationSearchResults = [];
                state.mapLocationSearchLoading = false;
                render();
            }

            mapLocationSearchDebounce = window.setTimeout(() => {
                triggerMapSearch(input.value);
            }, LOCATION_SEARCH_DEBOUNCE_MS);
        });
        input.addEventListener("keyup", syncCursor);
        input.addEventListener("click", syncCursor);
        input.addEventListener("select", syncCursor);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                clearMapSearchDebounce();
                triggerMapSearch(input.value);
            }
        });
    });

    mapSearchResults.forEach((resultEl) => {
        resultEl.addEventListener("click", () => {
            const lat = Number(resultEl.dataset.lat);
            const lon = Number(resultEl.dataset.lon);
            const name = resultEl.dataset.name ?? "Selected place";
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            applyMapSearchedLocation({ displayName: name, lat, lon });
        });
    });

    if (state.mapLocationSearchFocused) {
        const input = root.querySelector<HTMLInputElement>(
            '[data-role="map-location-search-input"]',
        );
        if (input) {
            setTimeout(() => input.focus(), 0);
            const { start, end } = state.mapLocationSearchCursor;
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

            render();
            if (state.canvasView === "chart") {
                loadChartData();
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
            render();
        }),
    );

    const textInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="update-input"]',
    );
    textInputs.forEach((input) => {
        const updateDate = () => {
            const key = input.dataset.key;
            if (!key) return;
            const value = input.value;

            // Validate date format (YYYY-MM-DD) and that it's a valid date
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const isValidFormat = dateRegex.test(value);
            const isValidDate =
                isValidFormat && !isNaN(new Date(value).getTime());

            if (!isValidDate) {
                input.style.borderColor = "rgba(239, 68, 68, 0.6)";
                return;
            }

            // Valid date - reset border
            input.style.borderColor = "";

            // Clip date to valid range for scenario (only for main date input)
            let clippedValue = value;
            if (key === "date") {
                clippedValue = clipDateToScenarioRange(value, state.scenario);
                // Update input field if date was clipped
                if (clippedValue !== value) {
                    input.value = clippedValue;
                }
            }

            // Get current value to check if it changed
            const currentValue =
                key === "date"
                    ? state.date
                    : key === "compareDateStart"
                      ? state.compareDateStart
                      : key === "compareDateEnd"
                        ? state.compareDateEnd
                        : key === "chartRangeStart"
                          ? state.chartRangeStart
                          : key === "chartRangeEnd"
                            ? state.chartRangeEnd
                            : state.chartDate;

            if (currentValue === clippedValue) return; // No change, skip update

            switch (key) {
                case "date":
                    state.date = clippedValue;

                    break;
                case "compareDateStart":
                    state.compareDateStart = value;

                    break;
                case "compareDateEnd":
                    state.compareDateEnd = value;

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
            if (
                key === "date" ||
                (state.mode === "Compare" &&
                    (key === "compareDateStart" || key === "compareDateEnd"))
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
                state.canvasView === "chart" &&
                (key === "chartDate" ||
                    key === "chartRangeStart" ||
                    key === "chartRangeEnd")
            ) {
                loadChartData();
            }
        };

        // Update on change (date picker selection) and blur (manual typing)
        input.addEventListener("change", updateDate);
        input.addEventListener("blur", updateDate);
    });

    const resolutionInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-resolution"]',
    );
    const resolutionValues = root.querySelectorAll<HTMLElement>(
        '[data-role="resolution-value"]',
    );
    const updateResolutionUI = (value: number) => {
        const fill = ((value - 1) / (3 - 1)) * 100;
        const label = value === 1 ? "Low" : value === 2 ? "Medium" : "High";
        resolutionInputs.forEach((el) => {
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
            if (!Number.isNaN(value)) {
                state.resolution = value;
                updateResolutionUI(value);
                if (state.canvasView === "map") {
                    loadClimateData();
                }
            }
        }),
    );

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

    const mapInfoCloseBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="close-map-info"]',
    );
    mapInfoCloseBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        closeMapInfoWindow();
    });

    const mapInfoExpandBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-map-info-chart"]',
    );
    mapInfoExpandBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        if (!state.mapMarker && !state.mapPolygon) return;
        state.canvasView = "chart";
        state.chartMode = "single";
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
        state.chartVariable = state.variable;
        state.chartUnit = state.selectedUnit;
        state.chartDate = state.date;
        state.chartError = null;
        render();
        loadChartData();
    });

    const mapDrawToggleBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="toggle-map-draw"]',
    );
    mapDrawToggleBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        if (state.drawState.active) {
            stopMapDrawing();
        } else {
            startMapDrawing();
        }
    });

    attachTimeSliderHandlers({
        root,
        getTimeRange: () => state.timeRange,
        onDateChange: (date) => {
            state.date = date;
            loadClimateData();
            const hasPoint = state.mapMarker !== null;
            const hasPolygon =
                state.mapPolygon !== null && state.mapPolygon.length >= 3;
            if ((hasPoint || hasPolygon) && state.mapInfoOpen) {
                void loadMapInfoData();
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

    // Attach chat handlers
    const chatContextData: ChatContextData = {
        mode: state.mode,
        canvasView: state.canvasView,
        selectedVariable: state.variable,
        selectedModel: state.model,
        selectedScenario: state.scenario,
        selectedDate: state.date,
        compareMode: state.compareMode,
        chartMode: state.chartMode,
        selectedScenario1: state.compareScenarioA,
        selectedScenario2: state.compareScenarioB,
        selectedModel1: state.compareModelA,
        selectedModel2: state.compareModelB,
        selectedDate1: state.compareDateStart,
        selectedDate2: state.compareDateEnd,
        currentDataStats:
            state.dataMin !== null && state.dataMax !== null
                ? {
                      min: state.dataMin,
                      max: state.dataMax,
                      mean: state.dataMean ?? undefined,
                  }
                : undefined,
    };

    attachChatHandlers(root, state, chatContextData);
}

async function init() {
    appRoot = document.querySelector<HTMLDivElement>("#app");
    if (!appRoot) {
        throw new Error("Root element #app not found");
    }

    // Register callback for state updates from chat/backend
    registerStateUpdateCallback((updates: Record<string, any>) => {
        Object.assign(state, updates);
        render();

        // Reload data if necessary
        if (
            state.canvasView === "map" &&
            (updates.date ||
                updates.model ||
                updates.scenario ||
                updates.variable)
        ) {
            loadClimateData();
        }
        if (
            state.canvasView === "chart" &&
            (updates.chartDate ||
                updates.chartRangeStart ||
                updates.chartRangeEnd)
        ) {
            loadChartData();
        }
    });

    render();

    checkApiAvailability().then(() => {
        render();
    });

    if (state.canvasView === "map" && state.mode === "Explore") {
        loadClimateData();
    }

    // Tutorial event handlers - attach once during init, not on every render
    appRoot.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        
        // Use closest to find the element with data-action, even if a child is clicked
        const actionElement = target.closest('[data-action]') as HTMLElement | null;
        const action = actionElement?.getAttribute("data-action");

        if (action === "tutorial-continue") {
            e.preventDefault();
            e.stopPropagation();
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
                if (target.classList.contains('custom-select-trigger') || target.closest('.custom-select-trigger')) {
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
                    6: "palette",
                };
                
                // If this selection matches the current tutorial step's expected data key
                // and it's an option being clicked (not the trigger)
                if (stepToKey[tutorialState.currentStep] === dataKey && 
                    (target.classList.contains('custom-select-option') || target.closest('.custom-select-option'))) {
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
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
