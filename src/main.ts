import {
    attachSidebarHandlers,
    renderSidebarToggle,
    SIDEBAR_WIDTH,
} from "./Components/sidebar";
import { drawLegendGradient, renderMapLegend } from "./MapView/legend";
import { renderMapData, setupMapInteractions } from "./MapView/map";
import {
    attachTimeSliderHandlers,
    renderTimeSlider,
    updateTimeSliderPosition,
} from "./MapView/timeSlider";
import "./style.css";
import {
    checkApiHealth,
    type ClimateData,
    createDataRequest,
    DataClientError,
    dataToArray,
    fetchClimateData,
    fetchMetadata,
    type Metadata,
} from "./Utils/dataClient";
import {
    getDefaultUnitOption,
    getUnitOptions,
} from "./Utils/unitConverter";

type Mode = "Explore" | "Compare";
type PanelTab = "Manual" | "Chat";
type CanvasView = "map" | "chart";
type CompareMode = "Scenarios" | "Models" | "Dates";

type Style = Record<string, string | number>;

const scenarios = ["Historical", "SSP245", "SSP585"];
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
    chatBox: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid var(--border-default)",
        background: "rgba(15,18,25,0.96)",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 20px rgba(0,0,0,0.38)",
    },
    chatInput: {
        flex: 1,
        padding: "12px 0",
        borderRadius: 8,
        border: "none",
        background: "var(--bg-transparent)",
        color: "white",
        fontSize: 14,
        lineHeight: 1.4,
        outline: "none",
        minHeight: 24,
    },
    chatSend: {
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid var(--accent-border-strong)",
        background: "var(--gradient-primary)",
        color: "white",
        fontWeight: 700,
        fontSize: 14,
        letterSpacing: 0.1,
        cursor: "pointer",
        boxShadow: "0 10px 22px rgba(0,0,0,0.38), var(--shadow-inset)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
    },
    chatStack: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    chatLead: {
        fontSize: 13,
        color: "var(--text-secondary)",
        lineHeight: 1.45,
        marginTop: 10,
    },
    chatMessages: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "4px 0 6px",
        paddingRight: 0,
        width: "100%",
        boxSizing: "border-box",
    },
    chatBubble: {
        maxWidth: "100%",
        width: "fit-content",
        padding: "16px 16px",
        borderRadius: 12,
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: "0 6px 14px rgba(0,0,0,0.3)",
        boxSizing: "border-box",
    },
    chatBubbleUser: {
        alignSelf: "flex-end",
        background: "var(--gradient-chat-user)",
        border: "1px solid rgba(125,211,252,0.45)",
        color: "white",
        marginRight: 26,
    },
    chatBubbleAgent: {
        alignSelf: "flex-start",
        background: "rgba(20,24,31,0.95)",
        border: "1px solid var(--border-medium)",
        color: "var(--text-primary)",
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
};

type ChatMessage = { id: number; sender: "user" | "agent"; text: string };

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
    chatInput: string;
    chatMessages: ChatMessage[];
    availableModels: string[];
    compareMode: CompareMode;
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
    chatInput: "",
    chatMessages: [],
    compareMode: "Scenarios",
    availableModels: [],
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
    timeRange: null,
    metaData: undefined,
    compareInfoOpen: false,
};

let agentReplyTimer: number | null = null;
let mapCanvas: HTMLCanvasElement | null = null;

let appRoot: HTMLDivElement | null = null;

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
                    `Values on the map represent ${end} minus ${start} in ${unitText}. A value of X means ${variableLabel} was X ${unitLabel || ""} higher on ${end} than on ${start} (negative values mean it was lower).`,
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
            const scenarioA = "SSP245";
            const scenarioB = "SSP585";
            return {
                title: "Comparing two scenarios",
                paragraphs: [
                    `We are comparing ${variableLabel} for ${scenarioB} versus ${scenarioA} on ${date} using the ${state.model} model.`,
                    `Values show ${scenarioB} minus ${scenarioA} in ${unitText}. A value of X means ${variableLabel} is X ${unitLabel || ""} higher under ${scenarioB} than under ${scenarioA}; negative values mean it is lower.`,
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
                '<span style="color: var(--accent-purple);">$1</span>'
            );
            return `<p style="display:block; margin:${margin}; line-height:1.6; white-space: normal; word-break: break-word;">${highlightedText}</p>`;
        })
        .join("");
    const compareRight = state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24;
    const compareBottom = state.mode === "Compare" && state.compareMode === "Dates" ? 120 : 88;
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
          overlayStyle
      )}">
        <div style="${styleAttr(modalStyle)}" role="dialog" aria-modal="true" aria-label="${info.title}">
          <div style="${styleAttr(styles.infoModalHeader)}">
            <div style="${styleAttr(styles.infoModalTitle)}">${info.title}</div>
            <button type="button" data-action="close-compare-info" style="${styleAttr(
                styles.infoModalClose
            )}" aria-label="Close info dialog">✕</button>
          </div>
          <div style="${styleAttr(styles.infoModalBody)}">
            ${paragraphs}
          </div>
          <div style="${styleAttr(styles.infoModalFooter)}">
            <button type="button" data-action="close-compare-info" style="${styleAttr(
                styles.infoModalConfirm
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
          })
      )}">
        <button type="button" data-action="open-compare-info" style="${styleAttr(
            styles.compareInfoButton
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
function getTimeRangeForScenario(
    scenario: string
): { start: string; end: string } {
    if (scenario === "Historical") {
        return {
            start: "1950-01-01",
            end: "2014-12-31",
        };
    }
    
    // For future scenarios (SSP245, SSP585)
    return {
        start: "2015-01-01",
        end: "2100-12-31",
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

function calculateMinMax(
    arrayData: Float32Array | Float64Array
): { min: number; max: number } {
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

function createDifferenceData(
    dataA: ClimateData,
    dataB: ClimateData,
    labelA: string,
    labelB: string
): { data: ClimateData; min: number; max: number } {
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
        }
    }

    if (!isFinite(min) || !isFinite(max)) {
        throw new Error("Comparison produced no valid numeric values.");
    }

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

    return { data: differenceData, min, max };
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
    onProgress?: (progress: number) => void
): Promise<{ data: ClimateData; min: number; max: number }> {
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
            const scenarioA = "SSP245";
            const scenarioB = "SSP585";
            const compareDate = clipDateToScenarioRange(
                state.date,
                activeScenarioForRange
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
                activeScenarioForRange
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
                state.scenario
            );
            const endDate = clipDateToScenarioRange(
                state.compareDateEnd,
                state.scenario
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
                ? "SSP245"
                : state.scenario;
        // Update time range based on the scenario driving the current request
        state.timeRange = getTimeRangeForScenario(activeScenarioForRange);
        setLoadingProgress(30);

        const result =
            state.mode === "Compare"
                ? await loadCompareData(activeScenarioForRange, setLoadingProgress)
                : await (async () => {
                      setLoadingProgress(40);
                      const clippedDate = clipDateToScenarioRange(
                          state.date,
                          activeScenarioForRange
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
                              "No data returned for the selected parameters."
                          );
                      }

                      // Cap relative humidity to 100% in Explore mode to avoid invalid values
                      if (state.variable === "hurs") {
                          const clamped = new Float32Array(arrayData.length);
                          let min = Infinity;
                          let max = -Infinity;
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
                          }
                          data = { ...data, data: clamped, data_encoding: "none" };
                          arrayData = clamped;
                          return { data, min, max };
                      }

                      const { min, max } = calculateMinMax(arrayData);
                      setLoadingProgress(95);
                      return { data, min, max };
                  })();

        state.currentData = result.data;
        state.dataMin = result.min;
        state.dataMax = result.max;

        setLoadingProgress(100);
        state.isLoading = false;

        render();

        if (appRoot) {
            const canvas =
                appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
            if (canvas) {
                const defaultUnit =
                    state.metaData?.variable_metadata[state.variable]?.unit ||
                    "";
                setupMapInteractions(
                    canvas,
                    state.currentData,
                    defaultUnit,
                    state.variable,
                    state.selectedUnit
                );
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
        render();
    }
}

function render() {
    if (!appRoot) return; // Defensive check (should never happen due to initialization check)
    const resolutionFill = ((state.resolution - 1) / (3 - 1)) * 100;

    const modeTransform =
        state.mode === "Explore" ? "translateX(0%)" : "translateX(-50%)";
    const modeIndicatorTransform =
        state.mode === "Explore" ? "translateX(0%)" : "translateX(100%)";
    const canvasIndicatorTransform =
        state.canvasView === "map" ? "translateX(0%)" : "translateX(100%)";
    const tabTransform =
        state.panelTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";

    appRoot.innerHTML = `
    <div style="${styleAttr(styles.page)}">
      <div style="${styleAttr(styles.bgLayer1)}"></div>
      <div style="${styleAttr(styles.bgLayer2)}"></div>
      <div style="${styleAttr(styles.bgOverlay)}"></div>
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
                      state.mode === "Compare"
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
              ${renderLoadingIndicator()}
              ${
                  state.dataError
                      ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10;">
                      <div style="text-align: center; max-width: 600px; padding: 20px;">
                        <div style="${styleAttr(
                            styles.mapTitle
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
                                      })
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
                            styles.mapTitle
                        )}">No data loaded</div>
                        <div style="${styleAttr(styles.mapSubtitle)}">
                          Adjust parameters to load climate data
                        </div>
                      </div>
                    </div>`
                      : ""
              }
            `
                : `<div style="text-align: center;">
                <div style="${styleAttr(
                    styles.mapTitle
                )}">Chart placeholder</div>
                <div style="${styleAttr(
                    styles.mapSubtitle
                )}">Chart view coming soon. Visualizations will render here.</div>
              </div>`
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
                        "panel-tab"
                    )
                )
                .join("")}
          </div>
        </div>

        <div class="sidebar-content">
          <div class="tab-viewport">
            <div data-role="tab-track" class="tab-track" style="transform: ${tabTransform}">
              <div class="tab-pane">
                ${renderManualSection({
                    modeTransform,
                    resolutionFill,
                    modeIndicatorTransform,
                })}
              </div>
              <div class="tab-pane">
                ${renderChatSection()}
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
                        : undefined
                )
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
                        : undefined
                )
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
    </div>
  `;

    attachEventHandlers({ resolutionFill });

    mapCanvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");

    if (mapCanvas) {
        if (
            state.currentData &&
            !state.dataError &&
            state.dataMin !== null &&
            state.dataMax !== null
        ) {
            const defaultUnit =
                state.metaData?.variable_metadata[state.variable]?.unit || "";
            setupMapInteractions(
                mapCanvas,
                state.currentData,
                defaultUnit,
                state.variable,
                state.selectedUnit
            );
            renderMapData(
                state.currentData,
                mapCanvas,
                paletteOptions,
                state.palette,
                state.dataMin,
                state.dataMax,
                state.variable,
                state.selectedUnit
            );

            // Draw the gradient on the legend canvas
            const palette =
                paletteOptions.find((p) => p.name === state.palette) ||
                paletteOptions[0];
            drawLegendGradient("legend-gradient-canvas", palette.colors);
        }
    }
}

function renderLoadingIndicator() {
    if (!state.isLoading) return "";
    const progress = Math.max(0, Math.min(100, Math.round(state.loadingProgress)));
    return `
      <div style="${styleAttr(styles.loadingIndicator)}">
        <div style="${styleAttr(styles.loadingSpinner)}"></div>
        <div style="${styleAttr(styles.loadingTextGroup)}">
          <div style="${styleAttr(styles.loadingText)}">Loading data · ${progress}%</div>
          <div style="${styleAttr(styles.loadingBar)}">
            <div style="${styleAttr({
                ...styles.loadingBarFill,
                width: `${progress}%`,
            })}"></div>
          </div>
          <div style="${styleAttr(styles.loadingSubtext)}">Fetching climate tiles</div>
        </div>
      </div>
    `;
}

function renderField(label: string, controlHtml: string) {
    return `
    <div style="${styleAttr(styles.field)}">
      ${label ? `<div style="${styleAttr(styles.fieldLabel)}">${label}</div>` : ""}
      ${controlHtml}
    </div>
  `;
}

function renderInput(
    name: string,
    value: string,
    opts?: { type?: string; dataKey?: string; min?: string; max?: string }
) {
    const type = opts?.type ?? "date";
    const dataKey = opts?.dataKey ?? name;
    const minAttr = opts?.min ? `min="${opts.min}"` : "";
    const maxAttr = opts?.max ? `max="${opts.max}"` : "";
    return `
    <input
      type="${type}"
      value="${value}"
      data-action="update-input"
      data-key="${dataKey}"
      ${minAttr}
      ${maxAttr}
    />
  `;
}

function renderSelect(
    name: string,
    options: string[],
    current: string,
    opts?: { disabled?: boolean; dataKey?: string }
) {
    const dataKey = opts?.dataKey ?? name;
    const disabled = opts?.disabled ? "disabled" : "";
    return `
    <select data-action="update-select" data-key="${dataKey}" ${disabled}>
      ${options
          .map(
              (opt) => `
            <option value="${opt}" ${opt === current ? "selected" : ""}>
              ${opt}
            </option>
          `
          )
          .join("")}
    </select>
  `;
}

function renderTabButton(
    value: PanelTab,
    activeStyle?: Style,
    dataKey = "panel-tab"
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
                      renderSelect("scenario", scenarios, state.scenario)
                  ),
                  renderField("Date", renderInput("date", state.date)),
              ]
            : state.compareMode === "Dates"
            ? [
                  renderField(
                      "Scenario",
                      renderSelect("scenario", scenarios, state.scenario)
                  ),
                  renderField(
                      "Model",
                      renderSelect("model", models, state.model)
                  ),
              ]
            : [
                  renderField(
                      "Model",
                      renderSelect("model", models, state.model)
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
                      state.mode === value ? styles.modeBtnActive : undefined
                  )
              )}"
            >
              ${value}
            </button>
          `
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
                  renderSelect("scenario", scenarios, state.scenario)
              )}
              ${renderField(
                  "Model",
                  renderSelect("model", models, state.model)
              )}
              ${renderField(
                  "Date",
                  (() => {
                      const timeRange = getTimeRangeForScenario(
                          state.scenario
                      );
                      return renderInput("date", state.date, {
                          min: timeRange.start,
                          max: timeRange.end,
                      });
                  })()
              )}
              ${renderField(
                  "Variable",
                  renderSelect("variable", variables, state.variable)
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
                      { dataKey: "unit" }
                  )
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
                      { dataKey: "palette" }
                  )
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
                      })
                  )}"
                />
                <div data-role="resolution-value" style="${styleAttr(
                    styles.resolutionValue
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
                        }
                    )
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
                                ["SSP245"],
                                "SSP245",
                                { disabled: true }
                            )
                        )}
                        ${renderField(
                            "Scenario B",
                            renderSelect(
                                "compareScenarioB",
                                ["SSP585"],
                                "SSP585",
                                { disabled: true }
                            )
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
                                models,
                                state.compareModelA,
                                { dataKey: "compareModelA" }
                            )
                        )}
                        ${renderField(
                            "Model B",
                            renderSelect(
                                "compareModelB",
                                models,
                                state.compareModelB,
                                { dataKey: "compareModelB" }
                            )
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
                                { dataKey: "compareDateStart" }
                            )
                        )}
                        ${renderField(
                            "End date",
                            renderInput(
                                "compareDateEnd",
                                state.compareDateEnd,
                                { dataKey: "compareDateEnd" }
                            )
                        )}
  </div>
`
                      : ""
              }

              <div style="${styleAttr(styles.paramGrid)}">
                ${compareParameters.join("")}
                ${renderField(
                    "Variable",
                    renderSelect("variable", variables, state.variable)
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
                              (opt) => opt.label
                          ),
                          state.selectedUnit,
                          { dataKey: "unit" }
                      )
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
                      styles.sectionTitle
                  )}">Color palette</div>
                  ${renderField(
                      "",
                      renderSelect(
                          "palette",
                          paletteOptions.map((p) => p.name),
                          state.palette,
                          { dataKey: "palette" }
                      )
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
                      styles.sectionTitle
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
                          })
                      )}"
                    />
                    <div data-role="resolution-value" style="${styleAttr(
                        styles.resolutionValue
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

function renderChatSection() {
    return `
    <div style="${styleAttr({
        display: "flex",
        flexDirection: "column",
        gap: 8,
    })}">
      <div style="${styleAttr(styles.sectionTitle)}">Chat</div>
      <div style="${styleAttr(styles.chatStack)}">
        <div style="${styleAttr(
            styles.chatLead
        )}">Discuss the data with an agent, or ask questions.</div>

        <div style="${styleAttr(styles.chatMessages)}">
          ${state.chatMessages
              .map((msg) => {
                  const bubbleStyle =
                      msg.sender === "user"
                          ? mergeStyles(
                                styles.chatBubble,
                                styles.chatBubbleUser
                            )
                          : mergeStyles(
                                styles.chatBubble,
                                styles.chatBubbleAgent
                            );
                  return `<div style="${styleAttr(bubbleStyle)}">${
                      msg.text
                  }</div>`;
              })
              .join("")}
        </div>

        <div style="${styleAttr(styles.chatBox)}">
          <input
            type="text"
            value="${state.chatInput}"
            data-action="chat-input"
            style="${styleAttr(styles.chatInput)}"
            placeholder="Ask a question"
          />
          <button type="button" data-action="chat-send" aria-label="Send chat message" style="${styleAttr(
              styles.chatSend
          )}">
            ➤
          </button>
        </div>
      </div>
    </div>
  `;
}

function attachEventHandlers(_params: { resolutionFill: number }) {
    if (!appRoot) return;
    const root = appRoot;

    attachSidebarHandlers({
        root,
        getSidebarOpen: () => state.sidebarOpen,
        setSidebarOpen: (isOpen) => {
            state.sidebarOpen = isOpen;
        },
        onTimeSliderUpdate: (isOpen) => {
            updateTimeSliderPosition(isOpen, SIDEBAR_WIDTH);
        },
    });

    const canvasButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-canvas"]'
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
                render();

                if (value === "map") {
                    loadClimateData();
                }

                const canvasIndicator = root.querySelector<HTMLElement>(
                    '[data-role="canvas-indicator"]'
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
        })
    );

    const modeButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-mode"]'
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
                    '[data-role="mode-track"]'
                );
                const modeIndicator = root.querySelector<HTMLElement>(
                    '[data-role="mode-indicator"]'
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
        })
    );

    const tabButtons = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="set-tab"]'
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
                    '[data-role="tab-track"]'
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
        })
    );

    const selectInputs = root.querySelectorAll<HTMLSelectElement>(
        '[data-action="update-select"]'
    );
    selectInputs.forEach((select) =>
        select.addEventListener("change", async () => {
            const key = select.dataset.key;
            const val = select.value;
            if (!key) return;
            switch (key) {
                case "scenario":
                    state.scenario = val;
                    // Automatically update date to a valid date for the selected scenario
                    state.date = getDateForScenario(val);
                    // Update time range for the slider
                    state.timeRange = getTimeRangeForScenario(val);
                    break;
                case "model":
                    state.model = val;
                    break;
                case "variable":
                    state.variable = val;
                    // Reset unit to default for new variable
                    state.selectedUnit = getDefaultUnitOption(val).label;
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
                            appRoot.querySelector<HTMLCanvasElement>(
                                "#map-canvas"
                            );
                        if (canvas) {
                            mapCanvas = canvas;
                            const defaultUnit =
                                state.metaData?.variable_metadata[
                                    state.variable
                                ]?.unit || "";
                            setupMapInteractions(
                                canvas,
                                state.currentData,
                                defaultUnit,
                                state.variable,
                                state.selectedUnit
                            );
                            renderMapData(
                                state.currentData,
                                mapCanvas,
                                paletteOptions,
                                state.palette,
                                state.dataMin,
                                state.dataMax,
                                state.variable,
                                state.selectedUnit
                            );

                            // Redraw gradient with new palette
                            const palette =
                                paletteOptions.find(
                                    (p) => p.name === state.palette
                                ) || paletteOptions[0];
                            drawLegendGradient(
                                "legend-gradient-canvas",
                                palette.colors
                            );
                        }
                    }
                    return;
                case "palette":
                    state.palette = val;
                    render();
                    if (
                        state.currentData &&
                        appRoot &&
                        state.dataMin !== null &&
                        state.dataMax !== null
                    ) {
                        const canvas =
                            appRoot.querySelector<HTMLCanvasElement>(
                                "#map-canvas"
                            );
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
                                state.selectedUnit
                            );

                            // Redraw gradient with new palette
                            const palette =
                                paletteOptions.find(
                                    (p) => p.name === state.palette
                                ) || paletteOptions[0];
                            drawLegendGradient(
                                "legend-gradient-canvas",
                                palette.colors
                            );
                        }
                    }
                    return;
                case "compareMode":
                    state.compareMode = val as CompareMode;
                    break;
                case "compareModelA":
                    state.compareModelA = val;
                    break;
                case "compareModelB":
                    state.compareModelB = val;
                    break;
            }
            render();
            loadClimateData();
        })
    );

    const textInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="update-input"]'
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
                    : state.compareDateEnd;

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
            }

            // Only re-render and reload if the date actually changed

            render();
            if (
                key === "date" ||
                (state.mode === "Compare" &&
                    (key === "compareDateStart" || key === "compareDateEnd"))
            ) {
                loadClimateData();
            }
        };

        // Update only on blur or Enter key to avoid excessive loading (also crashes if date is incomplete)
        input.addEventListener("blur", updateDate);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                updateDate();
                input.blur();
            }
        });
    });

    const resolutionInputs = root.querySelectorAll<HTMLInputElement>(
        '[data-action="set-resolution"]'
    );
    const resolutionValues = root.querySelectorAll<HTMLElement>(
        '[data-role="resolution-value"]'
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
                loadClimateData();
            }
        })
    );

    const infoOpenBtn = root.querySelector<HTMLButtonElement>(
        '[data-action="open-compare-info"]'
    );
    infoOpenBtn?.addEventListener("click", () => {
        state.compareInfoOpen = true;
        render();
    });

    const infoCloseBtns = root.querySelectorAll<HTMLButtonElement>(
        '[data-action="close-compare-info"]'
    );
    infoCloseBtns.forEach((btn) =>
        btn.addEventListener("click", () => {
            state.compareInfoOpen = false;
            render();
        })
    );

    attachTimeSliderHandlers({
        root,
        getTimeRange: () => state.timeRange,
        onDateChange: (date) => {
            state.date = date;
            loadClimateData();
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

    const chatInput = root.querySelector<HTMLInputElement>(
        '[data-action="chat-input"]'
    );
    const chatSend = root.querySelector<HTMLButtonElement>(
        '[data-action="chat-send"]'
    );
    chatInput?.addEventListener("input", () => {
        state.chatInput = chatInput.value;
    });
    chatInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            sendChat();
        }
    });
    chatSend?.addEventListener("click", sendChat);
}

function sendChat() {
    const text = state.chatInput.trim();
    if (!text) return;

    const userMessage: ChatMessage = { id: Date.now(), sender: "user", text };
    state.chatMessages = [...state.chatMessages, userMessage];
    state.chatInput = "";

    if (agentReplyTimer) {
        window.clearTimeout(agentReplyTimer);
    }

    agentReplyTimer = window.setTimeout(() => {
        const reply: ChatMessage = {
            id: Date.now() + 1,
            sender: "agent",
            text: "I don't work yet.",
        };
        state.chatMessages = [...state.chatMessages, reply];
        render();
    }, 1000);

    render();
}

async function init() {
    appRoot = document.querySelector<HTMLDivElement>("#app");
    if (!appRoot) {
        throw new Error("Root element #app not found");
    }

    render();

    checkApiAvailability().then(() => {
        render();
    });

    if (state.canvasView === "map" && state.mode === "Explore") {
        loadClimateData();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    // DOM is already ready
    init();
}
