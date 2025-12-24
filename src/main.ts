import {
  type ClimateData,
  createDataRequest,
  DataClientError,
  dataToArray,
  fetchClimateData
} from "./dataClient";
import "./style.css";

type Mode = "Explore" | "Compare";
type PanelTab = "Manual" | "Chat";
type CanvasView = "map" | "chart";
type CompareMode = "Scenarios" | "Models" | "Dates";

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
const variables = ["tas", "pr", "rsds", "hurs", "rlds", "sfcWind", "tasmin", "tasmax"];

const paletteOptions = [
  { name: "Viridis", colors: ["#440154", "#3b528b", "#21908d", "#5dc863", "#fde725"] },
  { name: "Magma", colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d"] },
  { name: "Cividis", colors: ["#00204c", "#31456a", "#6b6d7f", "#a59c8f", "#fdea9b"] },
  { name: "Thermal", colors: ["#04142f", "#155570", "#1fa187", "#f8c932", "#f16623"] },
];

type ChatMessage = { id: number; sender: "user" | "agent"; text: string };

type AppState = {
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
  compareMode: CompareMode;
  compareModelA: string;
  compareModelB: string;
  compareDateStart: string;
  compareDateEnd: string;
  isLoading: boolean;
  dataError: string | null;
  currentData: ClimateData | null;
  apiAvailable: boolean | null;
};

const SIDEBAR_WIDTH = 360;

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
  resolution: 18,
  chatInput: "",
  chatMessages: [],
  compareMode: "Scenarios",
  compareModelA: models[0],
  compareModelB: models[1] ?? models[0],
  compareDateStart: "2000-01-01",
  compareDateEnd: "2000-12-31",
  isLoading: false,
  dataError: null,
  currentData: null,
  apiAvailable: null,
};

let agentReplyTimer: number | null = null;
let mapCanvas: HTMLCanvasElement | null = null;
let mapZoom = 1.0;
let mapPanX = 0;
let mapPanY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

let appRoot: HTMLDivElement | null = null;

function setupMapInteractions(canvas: HTMLCanvasElement) {
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = mapZoom * zoomFactor;
    
    if (state.currentData) {
      const [height, width] = state.currentData.shape;
      const minZoomWidth = rect.width / width;
      const minZoomHeight = rect.height / height;
      const minZoom = Math.min(minZoomWidth, minZoomHeight);
      const maxZoom = 10.0;
      
      if (newZoom >= minZoom && newZoom <= maxZoom) {
        const worldX = (mouseX + mapPanX) / mapZoom;
        const worldY = (mouseY + mapPanY) / mapZoom;
        
        mapZoom = newZoom;
        mapPanX = worldX * mapZoom - mouseX;
        mapPanY = worldY * mapZoom - mouseY;
        
        renderMapData(state.currentData);
      }
    }
  }, { passive: false });
  
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartPanX = mapPanX;
      dragStartPanY = mapPanY;
      canvas.style.cursor = "grabbing";
    }
  });
  
  canvas.addEventListener("mousemove", (e) => {
    if (isDragging && state.currentData) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      mapPanX = dragStartPanX - deltaX;
      mapPanY = dragStartPanY - deltaY;
      
      const [height, width] = state.currentData.shape;
      const rect = canvas.getBoundingClientRect();
      const scaledHeight = height * mapZoom;
      const minZoomWidth = rect.width / width;
      const minZoomHeight = rect.height / height;
      const minZoom = Math.min(minZoomWidth, minZoomHeight);
      const isAtMinZoom = Math.abs(mapZoom - minZoom) < 0.001;
      
      if (!isAtMinZoom && scaledHeight > rect.height) {
        const maxPanY = scaledHeight - rect.height;
        mapPanY = Math.max(0, Math.min(mapPanY, maxPanY));
      }
      
      renderMapData(state.currentData);
    }
  });
  
  canvas.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = "grab";
    }
  });
  
  canvas.addEventListener("mouseleave", () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = "grab";
    }
  });
  
  canvas.style.cursor = "grab";
}

async function loadClimateData() {
  console.log("fetching")
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
    state.currentData = data;
    state.isLoading = false;
    
    render();
    
    if (appRoot) {
      const canvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
      if (canvas) {
        mapCanvas = canvas;
        setupMapInteractions(canvas);
        const rect = canvas.getBoundingClientRect();
        if (rect && data.shape) {
          const [height, width] = data.shape;
          const minZoomWidth = rect.width / width;
          const minZoomHeight = rect.height / height;
          const minZoom = Math.min(minZoomWidth, minZoomHeight);
          mapZoom = minZoom;
          mapPanX = 0;
          mapPanY = 0;
        }
        renderMapData(data);
      }
    }
  } catch (error) {
    if (error instanceof DataClientError && error.statusCode) {
      state.dataError = error.message;
    } else {
      state.dataError = error instanceof Error ? error.message : String(error);
    }
    state.isLoading = false;
    state.currentData = null;
    render();
  }
}

async function renderMapData(data: ClimateData) {
  if (!mapCanvas) return;

  const arrayData = dataToArray(data);
  if (!arrayData) {
    console.warn("No data to render");
    return;
  }
 
  const ctx = mapCanvas.getContext("2d");
  if (!ctx) return;

  const [height, width] = data.shape;
  const rect = mapCanvas.getBoundingClientRect();
  mapCanvas.width = rect.width * window.devicePixelRatio;
  mapCanvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  ctx.clearRect(0, 0, rect.width, rect.height);
  
  ctx.save();
  
  const viewWidth = rect.width;
  const viewHeight = rect.height;
  
  const minZoomWidth = viewWidth / width;
  const minZoomHeight = viewHeight / height;
  const minZoom = Math.min(minZoomWidth, minZoomHeight);
  
  if (mapZoom < minZoom) {
    mapZoom = minZoom;
  }
  
  const scaledHeight = height * mapZoom;
  
  const isAtMinZoom = Math.abs(mapZoom - minZoom) < 0.001;
  if (isAtMinZoom) {
    if (scaledHeight < viewHeight) {
      mapPanY = (viewHeight - scaledHeight) / 2;
    } else {
      mapPanY = 0;
    }
  } else {
    const maxPanY = Math.max(0, scaledHeight - viewHeight);
    mapPanY = Math.max(0, Math.min(mapPanY, maxPanY));
  }
  
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arrayData.length; i++) {
    const val = arrayData[i];
    if (isFinite(val)) {
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
  }

  const palette = paletteOptions.find((p) => p.name === state.palette) || paletteOptions[0];
  const colors = palette.colors;

  // Pre-compute RGB values for palette
  const paletteRgb = colors.map(hexToRgb);

  // We use imageData instead of filling pixels because filling pixels individually is slow
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;
  console.log("Rendering map data...");
  // Fill ImageData with colored pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const flippedY = height - 1 - y;
      const idx = flippedY * width + x;
      const value = arrayData[idx];

      const pixelIdx = (y * width + x) * 4;

      if (!isFinite(value)) {
        // Transparent pixel for invalid data
        pixels[pixelIdx + 3] = 0;
        continue;
      }

      const normalized = (value - min) / (max - min);
      const colorIdx = Math.floor(normalized * (paletteRgb.length - 1));
      const c1 = paletteRgb[Math.min(colorIdx, paletteRgb.length - 1)];
      const c2 = paletteRgb[Math.min(colorIdx + 1, paletteRgb.length - 1)];
      const t = normalized * (paletteRgb.length - 1) - colorIdx;

      pixels[pixelIdx] = Math.round(c1.r + (c2.r - c1.r) * t);     // R
      pixels[pixelIdx + 1] = Math.round(c1.g + (c2.g - c1.g) * t); // G
      pixels[pixelIdx + 2] = Math.round(c1.b + (c2.b - c1.b) * t); // B
      pixels[pixelIdx + 3] = 255; // Alpha
    }
  }

  // Create an offscreen canvas to hold the ImageData (See: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offscreenCtx = offscreen.getContext('2d');
  if (!offscreenCtx) return;
  offscreenCtx.putImageData(imageData, 0, 0);

  // Now render with transforms
  ctx.translate(0, -mapPanY);
  ctx.scale(mapZoom, mapZoom);
  
  const normalizedPanX = ((mapPanX % (width * mapZoom)) + (width * mapZoom)) % (width * mapZoom);
  const wrapOffset = -normalizedPanX / mapZoom;
  const wrapCount = Math.ceil((normalizedPanX + viewWidth) / (width * mapZoom)) + 1;
  const startWrap = -1;
  
  // Disable image smoothing for crisp pixels
  ctx.imageSmoothingEnabled = false;
  
  for (let wrap = startWrap; wrap < startWrap + wrapCount; wrap++) {
    ctx.drawImage(offscreen, wrap * width + wrapOffset, 0);
  }
  
  ctx.restore();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function render() {
  if (!appRoot) return;
  
  appRoot.innerHTML = `
    <div class="page">
      <div class="bg-layer-1"></div>
      <div class="bg-layer-2"></div>
      <div class="bg-overlay"></div>

      <div class="map-area">
        ${
          state.canvasView === "map"
            ? `
              <canvas id="map-canvas" class="map-canvas"></canvas>
              ${
                state.isLoading
                  ? `<div class="map-overlay">
                      <div>
                        <div class="map-title">Loading climate data...</div>
                        <div class="map-subtitle">Fetching data from API</div>
                      </div>
                    </div>`
                  : ""
              }
              ${
                state.dataError
                  ? `<div class="map-overlay">
                      <div >
                        <div class="map-title">Error loading data</div>
                        <div class="map-subtitle">${state.dataError}</div>
                        ${
                          state.apiAvailable === false
                            ? `<div class="map-subtitle">
                                Make sure the Python API server is running.
                              </div>`
                            : ""
                        }
                      </div>
                    </div>`
                  : ""
              }
              ${
                !state.isLoading && !state.dataError && !state.currentData
                  ? `<div class="map-overlay" >
                      <div>
                        <div class="map-title">No data loaded</div>
                        <div class="map-subtitle">Adjust parameters to load climate data</div>
                      </div>
                    </div>`
                  : ""
              }
            `
            : `<div>
                <div class="map-title">Chart placeholder</div>
                <div class="map-subtitle">Chart view coming soon.</div>
              </div>`
        }
      </div>

      <div class="top-bar">
        ${renderField("Scenario", renderSelect("scenario", scenarios, state.scenario))}
        ${renderField("Model", renderSelect("model", models, state.model))}
        ${renderField("Date", renderInput("date", state.date))}
        ${renderField("Variable", renderSelect("variable", variables, state.variable))}
      </div>

      <aside class="sidebar" style="transform: ${state.sidebarOpen ? 'translateX(0)' : `translateX(${SIDEBAR_WIDTH + 24}px)`}; pointer-events: ${state.sidebarOpen ? 'auto' : 'none'};">
        <div class="sidebar-top">
          <div class="logo-dot"></div>
          <div class="tab-switch">
            ${(["Manual", "Chat"] as const)
              .map((value) => `<button type="button" class="tab-btn ${state.panelTab === value ? 'active' : ''}" data-action="set-tab" data-value="${value}">${value}</button>`)
              .join("")}
          </div>
        </div>

        <div class="sidebar-content">
          <div class="tab-viewport">
            <div class="tab-track" style="transform: ${state.panelTab === 'Manual' ? 'translateX(0%)' : 'translateX(-50%)'};">
              <div class="tab-pane">
                ${renderManualSection()}
              </div>
              <div class="tab-pane">
                ${renderChatSection()}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="canvas-toggle" style="right: ${state.sidebarOpen ? SIDEBAR_WIDTH + 24 : 24}px;">
        <div class="canvas-switch">
          <div class="canvas-indicator" style="transform: ${state.canvasView === 'map' ? 'translateX(0%)' : 'translateX(100%)'}"></div>
          <button type="button" class="canvas-btn ${state.canvasView === 'map' ? 'active' : ''}" data-action="set-canvas" data-value="map">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4 6.5 9 4l6 2.5L20 4v14l-5 2.5L9 18 4 20.5V6.5Z" />
              <path d="m9 4v14m6-11.5v14" />
            </svg>
          </button>
          <button type="button" class="canvas-btn ${state.canvasView === 'chart' ? 'active' : ''}" data-action="set-canvas" data-value="chart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 18h16M6 18 11 9l4 5 3-6" />
              <circle cx="6" cy="18" r="1.2" />
              <circle cx="11" cy="9" r="1.2" />
              <circle cx="15" cy="14" r="1.2" />
              <circle cx="18" cy="8" r="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <button type="button" class="sidebar-toggle" style="position: fixed; top: 50%; transform: translateY(-50%); right: ${state.sidebarOpen ? SIDEBAR_WIDTH + 10 : 14}px; z-index: 12;" data-action="toggle-sidebar">
        <span>${state.sidebarOpen ? "›" : "‹"}</span>
      </button>
    </div>
  `;

  attachEventHandlers();
  mapCanvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
  
  if (mapCanvas) {
    setupMapInteractions(mapCanvas);
    if (state.currentData && !state.isLoading && !state.dataError) {
      renderMapData(state.currentData);
    }
  }
}

function renderField(label: string, controlHtml: string) {
  return `
    <div class="field">
      <div class="field-label">${label}</div>
      ${controlHtml}
    </div>
  `;
}

function renderInput(name: string, value: string, opts?: { type?: string; dataKey?: string }) {
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

function renderSelect(name: string, options: string[], current: string, opts?: { disabled?: boolean; dataKey?: string }) {
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

function renderManualSection() {
  const resolutionFill = ((state.resolution - 15) / (21 - 15)) * 100;
  const modeIndicatorTransform = state.mode === 'Explore' ? 'translateX(0%)' : 'translateX(100%)';
  const compareParameters =
    state.compareMode === "Models"
      ? [
          renderField("Scenario", renderSelect("scenario", scenarios, state.scenario)),
          renderField("Date", renderInput("date", state.date)),
        ]
      : state.compareMode === "Dates"
        ? [
            renderField("Scenario", renderSelect("scenario", scenarios, state.scenario)),
            renderField("Model", renderSelect("model", models, state.model)),
          ]
        : [
            renderField("Model", renderSelect("model", models, state.model)),
            renderField("Date", renderInput("date", state.date)),
          ];

  return `
    <div class="mode-switch">
      <div data-role="mode-indicator" class="mode-indicator" style="transform: ${modeIndicatorTransform};"></div>
      ${(["Explore", "Compare"] as const)
        .map((value) =>
          `
            <button
              type="button"
              class="mode-btn ${state.mode === value ? 'active' : ''}"
              data-action="set-mode"
              data-value="${value}"
            >
              ${value}
            </button>
          `
        )
        .join("")}
    </div>

    <div class="mode-viewport">
      <div data-role="mode-track" class="mode-track" style="transform: ${state.mode === 'Explore' ? 'translateX(0%)' : 'translateX(-50%)'};">
        <div class="mode-pane">
          <div class="section-title">Parameters</div>
          <div class="param-grid">
            ${renderField("Scenario", renderSelect("scenario", scenarios, state.scenario))}
            ${renderField("Model", renderSelect("model", models, state.model))}
            ${renderField("Date", renderInput("date", state.date))}
            ${renderField("Variable", renderSelect("variable", variables, state.variable))}
          </div>

          <div>
            <div class="section-title">Color palette</div>
            ${renderField(
              "Palette",
              renderSelect("palette", paletteOptions.map((p) => p.name), state.palette, { dataKey: "palette" })
            )}
          </div>

          <div>
            <div class="section-title">Resolution</div>
            <div class="resolution-row">
              <input
                type="range"
                min="15"
                max="21"
                step="1"
                value="${state.resolution}"
                data-action="set-resolution"
                class="resolution-slider"
                style="--slider-fill: ${resolutionFill}%"
              />
              <div data-role="resolution-value" class="resolution-value">${state.resolution}</div>
            </div>
          </div>
        </div>

        <div class="mode-pane">
          <div class="section-title">Compare</div>
          <div>
            ${renderField(
              "What do you want to compare",
              renderSelect("compareMode", ["Scenarios", "Models", "Dates"], state.compareMode, {
                dataKey: "compareMode",
              })
            )}
          </div>

          ${
            state.compareMode === "Scenarios"
              ? `
                  <div class="param-grid">
                    ${renderField(
                      "Scenario A",
                      renderSelect("compareScenarioA", ["SSP245"], "SSP245", { disabled: true })
                    )}
                    ${renderField(
                      "Scenario B",
                      renderSelect("compareScenarioB", ["SSP585"], "SSP585", { disabled: true })
                    )}
                  </div>
                `
              : ""
          }

          ${
            state.compareMode === "Models"
              ? `
                  <div class="param-grid">
                    ${renderField(
                      "Model A",
                      renderSelect("compareModelA", models, state.compareModelA, { dataKey: "compareModelA" })
                    )}
                    ${renderField(
                      "Model B",
                      renderSelect("compareModelB", models, state.compareModelB, { dataKey: "compareModelB" })
                    )}
                  </div>
                `
              : ""
          }

          ${
            state.compareMode === "Dates"
              ? `
                  <div class="param-grid">
                    ${renderField(
                      "Start date",
                      renderInput("compareDateStart", state.compareDateStart, { dataKey: "compareDateStart" })
                    )}
                    ${renderField(
                      "End date",
                      renderInput("compareDateEnd", state.compareDateEnd, { dataKey: "compareDateEnd" })
                    )}
  </div>
`
              : ""
          }

          <div class="param-grid">
            ${compareParameters.join("")}
            ${renderField("Variable", renderSelect("variable", variables, state.variable))}
          </div>

          <div>
            <div class="section-title">Color palette</div>
            ${renderField(
              "Palette",
              renderSelect("palette", paletteOptions.map((p) => p.name), state.palette, { dataKey: "palette" })
            )}
          </div>

          <div >
            <div class="section-title">Resolution</div>
            <div class="resolution-row">
              <input
                type="range"
                min="15"
                max="21"
                step="1"
                value="${state.resolution}"
                data-action="set-resolution"
                class="resolution-slider"
                style="--slider-fill: ${resolutionFill}%"
              />
              <div data-role="resolution-value" class="resolution-value">${state.resolution}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderChatSection() {
  return `
    <div >
      <div class="section-title">Chat</div>
      <div class="chat-stack">
        <div class="chat-lead">Discuss the data with an agent, or ask questions.</div>

        <div class="chat-messages">
          ${state.chatMessages
            .map((msg) => {
              const bubbleClass = msg.sender === "user" ? "chat-bubble user" : "chat-bubble agent";
              return `<div class="${bubbleClass}">${msg.text}</div>`;
            })
            .join("")}
        </div>

        <div class="chat-box">
          <input
            type="text"
            value="${state.chatInput}"
            data-action="chat-input"
            class="chat-input"
            placeholder="Ask a question"
          />
          <button type="button" data-action="chat-send" aria-label="Send chat message" class="chat-send">
            ➤
          </button>
        </div>
      </div>
    </div>
  `;
}

function attachEventHandlers() {
  if (!appRoot) return; // Defensive check (should never happen due to initialization check)
  const root = appRoot; // TypeScript narrowing
  const sidebarToggle = root.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]');
  sidebarToggle?.addEventListener("click", () => {
    const sidebar = root.querySelector<HTMLElement>('[data-role="sidebar"]');
    const canvasToggle = root.querySelector<HTMLElement>('[data-role="canvas-toggle"]');

    if (!sidebar || !canvasToggle || !sidebarToggle) return;

    const nextOpen = !state.sidebarOpen;
    state.sidebarOpen = nextOpen;

    // Update sidebar visibility with smooth transition (transform already has a CSS transition)
    const translateX = nextOpen ? "translateX(0)" : `translateX(${SIDEBAR_WIDTH + 24}px)`;
    sidebar.style.transform = translateX;
    sidebar.style.pointerEvents = nextOpen ? "auto" : "none";
    sidebar.setAttribute("aria-hidden", String(!nextOpen));

    // Move the toggle button alongside the sidebar
    const toggleRight = nextOpen ? `${SIDEBAR_WIDTH + 10}px` : "14px";
    sidebarToggle.style.right = toggleRight;
    sidebarToggle.setAttribute("aria-label", nextOpen ? "Collapse sidebar" : "Expand sidebar");

    const iconSpan = sidebarToggle.querySelector("span");
    if (iconSpan) {
      iconSpan.textContent = nextOpen ? "›" : "‹";
    }

    // Shift the canvas toggle so it always sits just to the left of the sidebar
    const canvasRight = nextOpen ? SIDEBAR_WIDTH + 24 : 24;
    canvasToggle.style.right = `${canvasRight}px`;
  });

  const canvasButtons = root.querySelectorAll<HTMLButtonElement>('[data-action="set-canvas"]');
  canvasButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      const value = btn.dataset.value as CanvasView | undefined;
      if (value) {
        if (value === state.canvasView) return;

        const previousView = state.canvasView;
        const previousIndicatorTransform = previousView === "map" ? "translateX(0%)" : "translateX(100%)";
        const nextIndicatorTransform = value === "map" ? "translateX(0%)" : "translateX(100%)";

        state.canvasView = value;
        render();
        
        if (value === "map") {
          loadClimateData();
        }

        const canvasIndicator = root.querySelector<HTMLElement>('[data-role="canvas-indicator"]');

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

  const modeButtons = root.querySelectorAll<HTMLButtonElement>('[data-action="set-mode"]');
  modeButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      const value = btn.dataset.value as Mode | undefined;
      if (value) {
        if (value === state.mode) return;

        const previousMode = state.mode;
        const previousModeTransform = previousMode === "Explore" ? "translateX(0%)" : "translateX(-50%)";
        const previousIndicatorTransform = previousMode === "Explore" ? "translateX(0%)" : "translateX(100%)";
        const nextModeTransform = value === "Explore" ? "translateX(0%)" : "translateX(-50%)";
        const nextIndicatorTransform = value === "Explore" ? "translateX(0%)" : "translateX(100%)";

        state.mode = value;
        render();

        const modeTrack = root.querySelector<HTMLElement>('[data-role="mode-track"]');
        const modeIndicator = root.querySelector<HTMLElement>('[data-role="mode-indicator"]');

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

  const tabButtons = root.querySelectorAll<HTMLButtonElement>('[data-action="set-tab"]');
  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      const value = btn.dataset.value as PanelTab | undefined;
      if (value) {
        if (value === state.panelTab) return;

        const previousTab = state.panelTab;
        const previousTabTransform = previousTab === "Manual" ? "translateX(0%)" : "translateX(-50%)";
        const nextTabTransform = value === "Manual" ? "translateX(0%)" : "translateX(-50%)";

        state.panelTab = value;
        render();

        const tabTrack = root.querySelector<HTMLElement>('[data-role="tab-track"]');

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

  const selectInputs = root.querySelectorAll<HTMLSelectElement>('[data-action="update-select"]');
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
            const canvas = appRoot.querySelector<HTMLCanvasElement>("#map-canvas");
            if (canvas) {
              mapCanvas = canvas;
              renderMapData(state.currentData);
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

  const textInputs = root.querySelectorAll<HTMLInputElement>('[data-action="update-input"]');
  textInputs.forEach((input) =>
    input.addEventListener("input", () => {
      
      const key = input.dataset.key;
      console.log(input);
      if (!key) return;
      const value = input.value;
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
      render();
      if (key === "date") {
        loadClimateData();
      }
    })
  );

  const resolutionInputs = root.querySelectorAll<HTMLInputElement>('[data-action="set-resolution"]');
  const resolutionValues = root.querySelectorAll<HTMLElement>('[data-role="resolution-value"]');
  const updateResolutionUI = (value: number) => {
    const fill = ((value - 15) / (21 - 15)) * 100;
    resolutionInputs.forEach((el) => {
      el.value = String(value);
      el.style.setProperty("--slider-fill", `${fill}%`);
    });
    resolutionValues.forEach((el) => {
      el.textContent = String(value);
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

  const chatInput = root.querySelector<HTMLInputElement>('[data-action="chat-input"]');
  const chatSend = root.querySelector<HTMLButtonElement>('[data-action="chat-send"]');
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

async function checkApiAvailability() {
  try {
    const response = await fetch('http://localhost:8123/health');
    state.apiAvailable = response.ok;
  } catch (error) {
    state.apiAvailable = false;
  }
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
