import { renderMapData, setupMapInteractions } from "./MapView/map";
import {
    attachSidebarHandlers,
    renderSidebarToggle,
    SIDEBAR_WIDTH,
} from "./Components/sidebar";
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
    fetchClimateData,
    fetchMetadata,
} from "./Utils/dataClient";

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
    topBar: {
        position: "fixed",
        top: 12,
        left: 16,
        right: 380,
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 2px",
        background: "transparent",
        border: "none",
        boxShadow: "none",
        backdropFilter: "none",
        overflowX: "auto",
        overflowY: "visible",
        whiteSpace: "nowrap",
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
        color: "rgba(255,255,255,0.72)",
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
        background: "rgba(9,11,16,0.9)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
        zIndex: 101,
    },
    canvasIndicator: {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 3,
        width: "calc(50% - 3px)",
        borderRadius: 9,
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.2), rgba(167,139,250,0.2))",
        boxShadow:
            "0 8px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
        transition: "transform 180ms ease",
        zIndex: 0,
        pointerEvents: "none",
    },
    canvasBtn: {
        width: 40,
        height: 40,
        borderRadius: 9,
        border: "1px solid transparent",
        background: "transparent",
        color: "rgba(255,255,255,0.82)",
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
    mapSubtitle: { fontSize: 14, color: "rgba(255,255,255,0.75)" },
    badge: {
        padding: "4px 8px",
        borderRadius: 999,
        border: "1px solid rgba(125,211,252,0.4)",
        background: "rgba(125,211,252,0.12)",
        color: "rgba(255,255,255,0.9)",
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
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
        boxShadow: "none",
    },
    modeIndicator: {
        position: "absolute",
        top: 2,
        bottom: 2,
        left: 2,
        width: "calc(50% - 2px)",
        borderRadius: 8,
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.18), rgba(167,139,250,0.16))",
        boxShadow:
            "0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
        transition: "transform 200ms ease",
        zIndex: 0,
    },
    modeBtn: {
        flex: 1,
        padding: "8px 0",
        borderRadius: 8,
        border: "none",
        color: "rgba(255,255,255,0.8)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        background: "transparent",
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
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",
        border: "none",
        color: "white",
        boxShadow:
            "0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
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
        background: "rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.78)",
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: 0.35,
        cursor: "pointer",
        transition: "all 0.18s ease",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(0,0,0,0.32)",
        borderTop: "1px solid rgba(255,255,255,0.12)",
        borderRight: "1px solid rgba(255,255,255,0.12)",
        borderLeft: "1px solid rgba(255,255,255,0.12)",
        borderBottom: "none",
        transform: "translateY(4px)",
    },
    tabBtnActive: {
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.32), rgba(167,139,250,0.28))",
        color: "white",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.42)",
        borderTop: "1px solid rgba(125,211,252,0.6)",
        borderRight: "1px solid rgba(125,211,252,0.6)",
        borderLeft: "1px solid rgba(125,211,252,0.6)",
        borderBottom: "none",
        transform: "translateY(-4px)",
        zIndex: 1,
    },
    modeViewport: {
        overflow: "hidden",
        width: "100%",
        position: "relative",
    },
    modeTrack: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        width: "200%",
        transition: "transform 220ms ease",
    },
    modePane: {
        width: "100%",
        paddingRight: 4,
    },
    chatBox: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(15,18,25,0.96)",
        boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 20px rgba(0,0,0,0.38)",
    },
    chatInput: {
        flex: 1,
        padding: "12px 0",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "white",
        fontSize: 14,
        lineHeight: 1.4,
        outline: "none",
        minHeight: 24,
    },
    chatSend: {
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(125,211,252,0.5)",
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",
        color: "white",
        fontWeight: 700,
        fontSize: 14,
        letterSpacing: 0.1,
        cursor: "pointer",
        boxShadow:
            "0 10px 22px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
    },
    chatStack: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    chatLead: {
        fontSize: 13,
        color: "rgba(255,255,255,0.78)",
        lineHeight: 1.45,
        marginTop: 10,
    },
    chatMessages: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "4px 0 6px",
    },
    chatBubble: {
        maxWidth: "100%",
        width: "fit-content",
        padding: "16px 16px",
        borderRadius: 12,
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: "0 6px 14px rgba(0,0,0,0.3)",
    },
    chatBubbleUser: {
        alignSelf: "flex-end",
        background:
            "linear-gradient(135deg, rgba(125,211,252,0.25), rgba(167,139,250,0.25))",
        border: "1px solid rgba(125,211,252,0.45)",
        color: "white",
    },
    chatBubbleAgent: {
        alignSelf: "flex-start",
        background: "rgba(20,24,31,0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.9)",
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: "rgba(255,255,255,0.9)",
        letterSpacing: 0.3,
        textTransform: "uppercase",
    },
    paramGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    paletteGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    paletteCard: {
        padding: "9px 10px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        cursor: "pointer",
        color: "rgba(255,255,255,0.9)",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "all 0.18s ease",
    },
    paletteCardActive: {
        borderColor: "rgba(125,211,252,0.65)",
        background:
            "linear-gradient(145deg, rgba(125,211,252,0.14), rgba(255,255,255,0.03))",
        boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
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
        background: "transparent",
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
        color: "rgba(255,255,255,0.78)",
        minWidth: 60,
        textAlign: "right",
    },
    sectionText: { fontSize: 13, color: "rgba(255,255,255,0.78)" },
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
    chatInput: string;
    chatMessages: ChatMessage[];
    availableModels: string[];
    compareMode: CompareMode;
    compareModelA: string;
    compareModelB: string;
    compareDateStart: string;
    compareDateEnd: string;
    isLoading: boolean;
    dataError: string | null;
    currentData: ClimateData | null;
    apiAvailable: boolean | null;
    timeRange: {
        start: string;
        end: string;
    } | null;
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
    chatInput: "",
    chatMessages: [],
    compareMode: "Scenarios",
    availableModels: [],
    compareModelA: models[0],
    compareModelB: models[1] ?? models[0],
    compareDateStart: "2000-01-01",
    compareDateEnd: "2000-12-31",
    isLoading: false,
    dataError: null,
    currentData: null,
    apiAvailable: null,
    timeRange: null,
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

async function checkApiAvailability() {
    try {
        const available = await checkApiHealth();
        state.apiAvailable = available;
    } catch {
        state.apiAvailable = false;
    }
}

async function loadClimateData() {
    console.log("fetching");
    if (state.canvasView !== "map" || state.mode !== "Explore") {
        return;
    }

    state.isLoading = true;

    state.dataError = null;

    try {
        const request = createDataRequest({
            variable: state.variable,
            date: state.date,
            model: state.model,
            scenario: state.scenario,
            resolution: state.resolution,
        });

        const data = await fetchClimateData(request);
        const metaData = await fetchMetadata();
        console.log(metaData);
        state.availableModels = metaData.models;
        state.timeRange = metaData.time_range
            ? {
                  start: metaData.time_range.start,
                  end: metaData.time_range.historical_end,
              }
            : { start: "1950-01-01", end: "2100-12-31" };
        state.currentData = data;
        state.isLoading = false;

        render();

        if (appRoot) {
            const canvas =
                appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
            if (canvas) {
                setupMapInteractions(canvas, state.currentData);
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
        state.currentData = null;
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

      <div style="${styleAttr(styles.mapArea)}">
        ${
            state.canvasView === "map"
                ? `
              <canvas
                id="map-canvas"
                style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: auto;"
              ></canvas>
              ${
                  state.isLoading
                      ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); z-index: 10;">
                      <div style="text-align: center;">
                        <div style="${styleAttr(
                            styles.mapTitle
                        )}">Loading climate data...</div>
                        <div style="${styleAttr(
                            styles.mapSubtitle
                        )}">Fetching data from API</div>
                      </div>
                    </div>`
                      : ""
              }
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

      <div style="${styleAttr(styles.topBar)}">
        ${renderField(
            "Scenario",
            renderSelect("scenario", scenarios, state.scenario)
        )}
        ${renderField("Model", renderSelect("model", models, state.model))}
        ${renderField("Date", renderInput("date", state.date))}
        ${renderField(
            "Variable",
            renderSelect("variable", variables, state.variable)
        )}
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

      ${renderSidebarToggle(state.sidebarOpen)}

      ${renderTimeSlider({
          date: state.date,
          timeRange: state.timeRange,
          sidebarOpen: state.sidebarOpen,
          sidebarWidth: SIDEBAR_WIDTH,
      })}
    </div>
  `;

    attachEventHandlers({ resolutionFill });

    mapCanvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");

    if (mapCanvas) {
        if (state.currentData && !state.isLoading && !state.dataError) {
            setupMapInteractions(mapCanvas, state.currentData);
            renderMapData(
                state.currentData,
                mapCanvas,
                paletteOptions,
                state.palette
            );
        }
    }
}

function renderField(label: string, controlHtml: string) {
    return `
    <div style="${styleAttr(styles.field)}">
      <div style="${styleAttr(styles.fieldLabel)}">${label}</div>
      ${controlHtml}
    </div>
  `;
}

function renderInput(
    name: string,
    value: string,
    opts?: { type?: string; dataKey?: string }
) {
    const type = opts?.type ?? "date";
    const dataKey = opts?.dataKey ?? name;
    return `
    <input
      type="${type}"
      value="${value}"
      data-action="update-input"
      data-key="${dataKey}"
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
        <div style="${styleAttr(styles.modePane)}">
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
              ${renderField("Date", renderInput("date", state.date))}
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
              <div style="${styleAttr(styles.sectionTitle)}">Color palette</div>
              ${renderField(
                  "Palette",
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

        <div style="${styleAttr(styles.modePane)}">
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
                  <div style="${styleAttr(
                      styles.sectionTitle
                  )}">Color palette</div>
                  ${renderField(
                      "Palette",
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
        select.addEventListener("change", () => {
            const key = select.dataset.key;
            const val = select.value;
            if (!key) return;
            switch (key) {
                case "scenario":
                    state.scenario = val;
                    break;
                case "model":
                    state.model = val;
                    break;
                case "variable":
                    state.variable = val;
                    break;
                case "palette":
                    state.palette = val;
                    render();
                    if (state.currentData && appRoot) {
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
                                state.palette
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

            // Get current value to check if it changed
            const currentValue =
                key === "date"
                    ? state.date
                    : key === "compareDateStart"
                    ? state.compareDateStart
                    : state.compareDateEnd;

            if (currentValue === value) return; // No change, skip update

            switch (key) {
                case "date":
                    state.date = value;

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
            if (key === "date") {
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

    attachTimeSliderHandlers({
        root,
        getTimeRange: () => state.timeRange,
        onDateChange: (date) => {
            state.date = date;
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
