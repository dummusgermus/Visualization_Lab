/**
 * Export Dialog
 *
 * Provides a unified export interface with four sections:
 *  1. Screenshot  – PNG/JPEG capture of the current view
 *  2. Animation   – MP4 time-lapse through a date range
 *  3. Report      – PDF via the existing generateReport utility
 *  4. Data        – Customisable CSV/JSON download from the API
 */

import html2canvas from "html2canvas";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { AppState } from "../main";
import { generateReport } from "../Utils/reportGenerator";
import { compositeViewport } from "../Utils/screenshot";
import { normalizeScenario } from "../Utils/dataClient";
import "./exportDialog.css";

// ─── Constants (mirrors main.ts) ───────────────────────────────────────────

const ALL_SCENARIOS = ["Historical", "SSP245", "SSP370", "SSP585"];
const ALL_MODELS = [
    "ACCESS-CM2", "CanESM5", "CESM2", "CMCC-CM2-SR5", "EC-Earth3",
    "GFDL-ESM4", "INM-CM5-0", "IPSL-CM6A-LR", "MIROC6",
    "MPI-ESM1-2-HR", "MRI-ESM2-0",
];
const ALL_VARIABLES: Record<string, string> = {
    tas:      "Near-Surface Air Temp (tas)",
    pr:       "Precipitation (pr)",
    rsds:     "SW Radiation (rsds)",
    hurs:     "Relative Humidity (hurs)",
    rlds:     "LW Radiation (rlds)",
    sfcWind:  "Wind Speed (sfcWind)",
    tasmin:   "Min Air Temp (tasmin)",
    tasmax:   "Max Air Temp (tasmax)",
};

const API_BASE_URL =
    (import.meta as any).env?.VITE_DATA_API_URL || "http://localhost:8000";

// ─── Callbacks interface ────────────────────────────────────────────────────

export interface ExportDialogCallbacks {
    /** Sets the map date and re-renders the UI (does NOT fetch data). */
    setAnimationDate: (date: string) => void;
    /** Fetches climate data for the current state. Resolves when the load is complete. */
    loadData: () => Promise<void>;
    /** Returns the live app state reference. */
    getState: () => AppState;
}

// ─── Internal dialog state ──────────────────────────────────────────────────

type TabId = "screenshot" | "animation" | "report" | "data";

interface DialogState {
    activeTab: TabId;

    // Screenshot
    ssPreviewUrl: string | null;
    ssFormat: "png" | "jpeg";
    ssBusy: boolean;

    // Animation
    animStart: string;
    animEnd: string;
    animStep: "daily" | "monthly" | "yearly" | "custom";
    animCustomDays: number;
    animFps: number;
    animProgress: number;
    animStatus: string;
    animBusy: boolean;

    // Report
    reportBusy: boolean;
    reportStatus: string;

    // Data
    dataVariables: Set<string>;
    dataModels: Set<string>;
    dataScenarios: Set<string>;
    dataFormat: "csv" | "json";
    dataStartDate: string;
    dataEndDate: string;
    dataSpatial: "full" | "draw" | "range";
    dataResolution: "low" | "medium" | "high";
    dataStep: "monthly" | "yearly";
    dataProgress: number;
    dataStatus: string;
    dataBusy: boolean;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function openExportDialog(
    appState: AppState,
    callbacks: ExportDialogCallbacks,
): void {
    // Prevent duplicate dialogs
    if (document.getElementById("export-dialog-backdrop")) return;

    const resolutionMap: Record<number, "low" | "medium" | "high"> = {
        1: "low", 2: "medium", 3: "high",
    };

    const ds: DialogState = {
        activeTab: "screenshot",

        ssPreviewUrl: null,
        ssFormat: "png",
        ssBusy: false,

        animStart: appState.mapRangeStart || appState.date.slice(0, 7) + "-01",
        animEnd: appState.mapRangeEnd || appState.date.slice(0, 7) + "-01",
        animStep: "monthly",
        animCustomDays: 7,
        animFps: 8,
        animProgress: 0,
        animStatus: "",
        animBusy: false,

        reportBusy: false,
        reportStatus: "",

        dataVariables: new Set([appState.variable]),
        dataModels: new Set([appState.model]),
        dataScenarios: new Set([appState.scenario]),
        dataFormat: "csv",
        dataStartDate: appState.mapRangeStart || appState.date,
        dataEndDate: appState.mapRangeEnd || appState.date,
        dataSpatial: appState.mapPolygon ? "draw" : "full",
        dataResolution: resolutionMap[appState.resolution] ?? "medium",
        dataStep: "monthly",
        dataProgress: 0,
        dataStatus: "",
        dataBusy: false,
    };

    // ── Build backdrop + dialog ────────────────────────────────────────────
    const backdrop = document.createElement("div");
    backdrop.id = "export-dialog-backdrop";
    backdrop.className = "export-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Export");

    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKeyDown);

    // ── Close ──────────────────────────────────────────────────────────────
    function close() {
        document.removeEventListener("keydown", onKeyDown);
        backdrop.remove();
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
    }

    // ── Re-render dialog content ───────────────────────────────────────────
    function render() {
        backdrop.innerHTML = `
        <div class="export-dialog" role="document">
            ${renderHeader()}
            ${renderTabs()}
            <div class="export-body">
                ${renderTabContent()}
            </div>
        </div>`;
        attachHandlers();
    }

    // ── Header ─────────────────────────────────────────────────────────────
    function renderHeader(): string {
        return `
        <div class="export-header">
            <div class="export-header-left">
                <div class="export-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </div>
                <div>
                    <div class="export-title">Export</div>
                    <div class="export-subtitle">Screenshot · Animation · Report · Data</div>
                </div>
            </div>
            <button class="export-close" data-action="close" aria-label="Close">×</button>
        </div>`;
    }

    // ── Tabs ────────────────────────────────────────────────────────────────
    const TABS: { id: TabId; label: string; icon: string }[] = [
        {
            id: "screenshot", label: "Screenshot",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/></svg>`,
        },
        {
            id: "animation", label: "Animation",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
        },
        {
            id: "report", label: "Report",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        },
        {
            id: "data", label: "Data",
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
        },
    ];

    // ── Initial mount (all consts are initialised; function decls are hoisted) ─
    document.body.appendChild(backdrop);
    render();

    function renderTabs(): string {
        return `
        <div class="export-tabs">
            ${TABS.map((t) => `
                <button class="export-tab${ds.activeTab === t.id ? " active" : ""}"
                        data-action="switch-tab" data-tab="${t.id}">
                    ${t.icon} ${t.label}
                </button>`).join("")}
        </div>`;
    }

    // ── Tab content dispatcher ──────────────────────────────────────────────
    function renderTabContent(): string {
        switch (ds.activeTab) {
            case "screenshot": return renderScreenshotTab();
            case "animation":  return renderAnimationTab();
            case "report":     return renderReportTab();
            case "data":       return renderDataTab();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // SCREENSHOT TAB
    // ══════════════════════════════════════════════════════════════════════

    function renderScreenshotTab(): string {
        const previewHtml = ds.ssPreviewUrl
            ? `<img class="export-screenshot-preview" src="${ds.ssPreviewUrl}" alt="Screenshot preview"/>`
            : `<div class="export-anim-preview">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.5" opacity="0.35"
                     stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="12" cy="12" r="4"/>
                </svg>
                <span>Preview will appear here</span>
               </div>`;

        return `
        <p class="export-section-desc">
            Capture the current map view as a high-quality image.
            HTML overlays (legend, panels) are included in the capture.
        </p>
        ${previewHtml}
        <div class="export-form-group" style="margin-bottom:16px;">
            <span class="export-label">Format</span>
            <div class="export-radio-group">
                ${radioChip("ss-format", "png",  "PNG (lossless)",  ds.ssFormat === "png")}
                ${radioChip("ss-format", "jpeg", "JPEG (smaller)",  ds.ssFormat === "jpeg")}
            </div>
        </div>
        <div class="export-action-row">
            <button class="export-btn export-btn-secondary" data-action="ss-preview"
                    ${ds.ssBusy ? "disabled" : ""}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                Preview
            </button>
            <button class="export-btn export-btn-primary" data-action="ss-download"
                    ${ds.ssBusy || !ds.ssPreviewUrl ? "disabled" : ""}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
            </button>
            ${ds.ssBusy ? `<span class="export-progress-label">Capturing…</span>` : ""}
        </div>`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ANIMATION TAB
    // ══════════════════════════════════════════════════════════════════════

    function renderAnimationTab(): string {
        const supportsWebCodecs = typeof VideoEncoder !== "undefined";

        const warningHtml = !supportsWebCodecs
            ? `<div class="export-info-badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                WebCodecs is not supported in this browser. MP4 export requires Chrome 94+ or Edge 94+.
               </div>`
            : "";

        return `
        <p class="export-section-desc">
            Generate a time-lapse animation by stepping through a date range at the current
            variable, model and scenario. Each frame is captured at full resolution.
            Output format: MP4 video (H.264).
        </p>
        ${warningHtml}
        <div class="export-form-grid">
            <div class="export-form-group">
                <label class="export-label" for="anim-start">Start date</label>
                <input class="export-input" type="date" id="anim-start"
                       value="${ds.animStart}" data-field="animStart"/>
            </div>
            <div class="export-form-group">
                <label class="export-label" for="anim-end">End date</label>
                <input class="export-input" type="date" id="anim-end"
                       value="${ds.animEnd}" data-field="animEnd"/>
            </div>
            <div class="export-form-group${ds.animStep === 'custom' ? ' full-width' : ''}" style="grid-column: 1 / -1;">
                <span class="export-label">Time step</span>
                <div class="export-radio-group">
                    ${radioChip("anim-step", "daily",   "Daily",    ds.animStep === "daily")}
                    ${radioChip("anim-step", "monthly",  "Monthly",  ds.animStep === "monthly")}
                    ${radioChip("anim-step", "yearly",   "Yearly",   ds.animStep === "yearly")}
                    ${radioChip("anim-step", "custom",   "Custom…",  ds.animStep === "custom")}
                </div>
                ${ds.animStep === "custom" ? `
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
                    <input class="export-input" type="number" id="anim-custom-days"
                           min="1" max="3650" value="${ds.animCustomDays}"
                           data-field="animCustomDays"
                           style="width:80px;flex-shrink:0;"/>
                    <span class="export-label" style="text-transform:none;font-size:12px;">days per step</span>
                </div>` : ""}
            </div>
            <div class="export-form-group">
                <span class="export-label">Frames per second</span>
                <div class="export-radio-group">
                    ${["4","8","12","24"].map((v) =>
                        radioChip("anim-fps", v, v + " fps", ds.animFps === Number(v))
                    ).join("")}
                </div>
            </div>
        </div>
        <div class="export-action-row">
            <button class="export-btn export-btn-primary" data-action="anim-generate"
                    ${ds.animBusy ? "disabled" : ""}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                ${ds.animBusy ? "Generating…" : "Generate Animation"}
            </button>
            ${ds.animBusy ? `
            <div class="export-progress-wrap">
                <div class="export-progress-bar">
                    <div class="export-progress-fill" style="width:${ds.animProgress}%"></div>
                </div>
                <div class="export-progress-label">${ds.animStatus}</div>
            </div>` : ds.animStatus ? `<span class="export-progress-label">${ds.animStatus}</span>` : ""}
        </div>`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // REPORT TAB
    // ══════════════════════════════════════════════════════════════════════

    function renderReportTab(): string {
        const features = [
            { title: "Map screenshots", desc: "Full-viewport capture including overlays and legend" },
            { title: "Current settings", desc: "Scenario, model, variable, date and unit" },
            { title: "Chat history",     desc: "All user messages and AI responses" },
            { title: "Split-view support", desc: "Both panes captured independently" },
        ];
        return `
        <p class="export-section-desc">
            Generate a detailed PDF report of the current application state, including
            map views, selected parameters and the full conversation history.
        </p>
        <div class="export-report-features">
            ${features.map((f) => `
            <div class="export-report-feature">
                <div class="export-report-feature-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
                <div>
                    <div class="export-report-feature-title">${f.title}</div>
                    <div class="export-report-feature-text">${f.desc}</div>
                </div>
            </div>`).join("")}
        </div>
        <div class="export-action-row">
            <button class="export-btn export-btn-primary" data-action="report-generate"
                    ${ds.reportBusy ? "disabled" : ""}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                ${ds.reportBusy ? "Generating PDF…" : "Generate PDF Report"}
            </button>
            ${ds.reportStatus
                ? `<span class="export-progress-label">${ds.reportStatus}</span>`
                : ""}
        </div>`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // DATA TAB
    // ══════════════════════════════════════════════════════════════════════

    function renderDataTab(): string {
        const hasPolygon = !!appState.mapPolygon;
        const hasRange   = !!appState.mapRangeOpen;

        return `
        <p class="export-section-desc">
            Download the raw climate data behind the current view. Choose spatial scope,
            time range, models, scenarios and output format.
        </p>

        <!-- Spatial scope -->
        <div class="export-form-group full-width" style="margin-bottom:14px;">
            <span class="export-label">Spatial scope</span>
            <div class="export-spatial-cards">
                ${spatialCard("full",  "Full map extent",
                    "All grid cells for the current global view",
                    ds.dataSpatial === "full")}
                ${spatialCard("draw",  "Drawn polygon",
                    hasPolygon ? "Average over your drawn region" : "Draw a polygon on the map first",
                    ds.dataSpatial === "draw", !hasPolygon)}
                ${spatialCard("range", "Time range view",
                    hasRange ? "Data visible in the time-range chart" : "Open the range view first",
                    ds.dataSpatial === "range", !hasRange)}
            </div>
        </div>

        <hr class="export-divider"/>

        <!-- Variable + resolution -->
        <div class="export-form-grid" style="margin-bottom:14px;">
            <div class="export-form-group full-width" style="grid-column:1/-1;">
                <span class="export-label">Variables</span>
                <div class="export-checkbox-group">
                    ${Object.entries(ALL_VARIABLES).map(([k, v]) =>
                        checkChip("data-variable", k, v, ds.dataVariables.has(k))
                    ).join("")}
                </div>
            </div>
            <div class="export-form-group">
                <span class="export-label">Resolution</span>
                <div class="export-radio-group">
                    ${radioChip("data-res", "low",    "Low",    ds.dataResolution === "low")}
                    ${radioChip("data-res", "medium", "Medium", ds.dataResolution === "medium")}
                    ${radioChip("data-res", "high",   "High",   ds.dataResolution === "high")}
                </div>
            </div>
            <div class="export-form-group">
                <label class="export-label" for="data-start">Start date</label>
                <input class="export-input" type="date" id="data-start"
                       value="${ds.dataStartDate}" data-field="dataStartDate"/>
            </div>
            <div class="export-form-group">
                <label class="export-label" for="data-end">End date</label>
                <input class="export-input" type="date" id="data-end"
                       value="${ds.dataEndDate}" data-field="dataEndDate"/>
            </div>
            <div class="export-form-group">
                <span class="export-label">Time step</span>
                <div class="export-radio-group">
                    ${radioChip("data-step", "monthly", "Monthly", ds.dataStep === "monthly")}
                    ${radioChip("data-step", "yearly",  "Yearly",  ds.dataStep === "yearly")}
                </div>
            </div>
            <div class="export-form-group">
                <span class="export-label">Output format</span>
                <div class="export-radio-group">
                    ${radioChip("data-fmt", "csv",  "CSV",  ds.dataFormat === "csv")}
                    ${radioChip("data-fmt", "json", "JSON", ds.dataFormat === "json")}
                </div>
            </div>
        </div>

        <!-- Models -->
        <div class="export-form-group full-width" style="margin-bottom:12px;">
            <span class="export-label">Models</span>
            <div class="export-checkbox-group">
                ${ALL_MODELS.map((m) => checkChip("data-model", m, m, ds.dataModels.has(m))).join("")}
            </div>
        </div>

        <!-- Scenarios -->
        <div class="export-form-group full-width" style="margin-bottom:4px;">
            <span class="export-label">Scenarios</span>
            <div class="export-checkbox-group">
                ${ALL_SCENARIOS.map((s) => checkChip("data-scenario", s, s, ds.dataScenarios.has(s))).join("")}
            </div>
        </div>

        <div class="export-action-row">
            <button class="export-btn export-btn-primary" data-action="data-download"
                    ${ds.dataBusy || ds.dataVariables.size === 0 || ds.dataModels.size === 0 || ds.dataScenarios.size === 0 ? "disabled" : ""}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                ${ds.dataBusy ? "Downloading…" : "Download Data"}
            </button>
            ${ds.dataBusy ? `
            <div class="export-progress-wrap">
                <div class="export-progress-bar">
                    <div class="export-progress-fill" style="width:${ds.dataProgress}%"></div>
                </div>
                <div class="export-progress-label">${ds.dataStatus}</div>
            </div>` : ds.dataStatus ? `<span class="export-progress-label">${ds.dataStatus}</span>` : ""}
        </div>`;
    }

    // ── Small helpers ──────────────────────────────────────────────────────

    function radioChip(name: string, value: string, label: string, checked: boolean): string {
        return `<label class="export-radio-label">
            <input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}/>
            ${label}
        </label>`;
    }

    function checkChip(name: string, value: string, label: string, checked: boolean): string {
        return `<label class="export-chip-label">
            <input type="checkbox" name="${name}" value="${value}"${checked ? " checked" : ""}/>
            ${label}
        </label>`;
    }

    function spatialCard(value: string, title: string, desc: string, selected: boolean, disabled = false): string {
        return `<label class="export-spatial-card${selected ? " selected" : ""}${disabled ? " disabled" : ""}"
                       data-spatial="${value}">
            <input type="radio" name="data-spatial" value="${value}"${selected ? " checked" : ""}/>
            <div class="export-spatial-card-title">${title}</div>
            <div class="export-spatial-card-desc">${desc}</div>
        </label>`;
    }

    // ── Attach event handlers ──────────────────────────────────────────────
    function attachHandlers() {
        const dialog = backdrop.querySelector<HTMLElement>(".export-dialog")!;

        // Close button
        dialog.querySelector<HTMLElement>('[data-action="close"]')
              ?.addEventListener("click", close);

        // Tab switching
        dialog.querySelectorAll<HTMLButtonElement>('[data-action="switch-tab"]')
              .forEach((btn) => btn.addEventListener("click", () => {
                  ds.activeTab = btn.dataset.tab as TabId;
                  render();
              }));

        // ── Screenshot tab ─────────────────────────────────────────────────
        dialog.querySelector<HTMLElement>('[data-action="ss-preview"]')
              ?.addEventListener("click", doScreenshotPreview);
        dialog.querySelector<HTMLElement>('[data-action="ss-download"]')
              ?.addEventListener("click", doScreenshotDownload);

        dialog.querySelectorAll<HTMLInputElement>('input[name="ss-format"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.ssFormat = inp.value as "png" | "jpeg";
                  ds.ssPreviewUrl = null; // invalidate preview when format changes
                  render();
              }));

        // ── Animation tab ──────────────────────────────────────────────────
        dialog.querySelector<HTMLInputElement>('[data-field="animStart"]')
              ?.addEventListener("change", (e) => {
                  ds.animStart = (e.target as HTMLInputElement).value; });
        dialog.querySelector<HTMLInputElement>('[data-field="animEnd"]')
              ?.addEventListener("change", (e) => {
                  ds.animEnd = (e.target as HTMLInputElement).value; });
        dialog.querySelectorAll<HTMLInputElement>('input[name="anim-step"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.animStep = inp.value as DialogState["animStep"];
                  render(); // re-render to show/hide custom days input
              }));
        dialog.querySelector<HTMLInputElement>('[data-field="animCustomDays"]')
              ?.addEventListener("change", (e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (v >= 1) ds.animCustomDays = v;
              });
        dialog.querySelectorAll<HTMLInputElement>('input[name="anim-fps"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.animFps = Number(inp.value); }));
        dialog.querySelector<HTMLElement>('[data-action="anim-generate"]')
              ?.addEventListener("click", doGenerateAnimation);

        // ── Report tab ─────────────────────────────────────────────────────
        dialog.querySelector<HTMLElement>('[data-action="report-generate"]')
              ?.addEventListener("click", doGenerateReport);

        // ── Data tab ───────────────────────────────────────────────────────
        dialog.querySelectorAll<HTMLElement>('[data-spatial]')
              .forEach((card) => card.addEventListener("click", () => {
                  const v = card.dataset.spatial as DialogState["dataSpatial"];
                  if (!card.classList.contains("disabled")) {
                      ds.dataSpatial = v;
                      render();
                  }
              }));

        dialog.querySelectorAll<HTMLInputElement>('input[name="data-variable"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  if (inp.checked) ds.dataVariables.add(inp.value);
                  else ds.dataVariables.delete(inp.value);
                  const btn = dialog.querySelector<HTMLButtonElement>('[data-action="data-download"]');
                  if (btn) btn.disabled = ds.dataVariables.size === 0 || ds.dataModels.size === 0 || ds.dataScenarios.size === 0;
              }));

        dialog.querySelector<HTMLInputElement>('[data-field="dataStartDate"]')
              ?.addEventListener("change", (e) => {
                  ds.dataStartDate = (e.target as HTMLInputElement).value; });
        dialog.querySelector<HTMLInputElement>('[data-field="dataEndDate"]')
              ?.addEventListener("change", (e) => {
                  ds.dataEndDate = (e.target as HTMLInputElement).value; });

        dialog.querySelectorAll<HTMLInputElement>('input[name="data-res"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.dataResolution = inp.value as "low" | "medium" | "high"; }));
        dialog.querySelectorAll<HTMLInputElement>('input[name="data-step"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.dataStep = inp.value as "monthly" | "yearly"; }));
        dialog.querySelectorAll<HTMLInputElement>('input[name="data-fmt"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  ds.dataFormat = inp.value as "csv" | "json"; }));

        dialog.querySelectorAll<HTMLInputElement>('input[name="data-model"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  if (inp.checked) ds.dataModels.add(inp.value);
                  else             ds.dataModels.delete(inp.value);
                  updateDownloadBtn();
              }));
        dialog.querySelectorAll<HTMLInputElement>('input[name="data-scenario"]')
              .forEach((inp) => inp.addEventListener("change", () => {
                  if (inp.checked) ds.dataScenarios.add(inp.value);
                  else             ds.dataScenarios.delete(inp.value);
                  updateDownloadBtn();
              }));

        dialog.querySelector<HTMLElement>('[data-action="data-download"]')
              ?.addEventListener("click", doDataDownload);
    }

    function updateDownloadBtn() {
        const btn = backdrop.querySelector<HTMLButtonElement>('[data-action="data-download"]');
        if (btn) btn.disabled = ds.dataBusy || ds.dataModels.size === 0 || ds.dataScenarios.size === 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION – Screenshot
    // ══════════════════════════════════════════════════════════════════════

    async function doScreenshotPreview() {
        ds.ssBusy = true;
        render();
        try {
            const dataUrl = await captureScreen(ds.ssFormat);
            ds.ssPreviewUrl = dataUrl;
        } catch (e) {
            console.error("Screenshot capture failed", e);
        } finally {
            ds.ssBusy = false;
            render();
        }
    }

    function doScreenshotDownload() {
        if (!ds.ssPreviewUrl) return;
        const ext = ds.ssFormat === "jpeg" ? "jpg" : "png";
        triggerDownload(ds.ssPreviewUrl, `climate-export-${timestamp()}.${ext}`);
    }

    async function captureScreen(format: "png" | "jpeg"): Promise<string> {
        try {
            const offscreen = await html2canvas(document.body, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: "#0f121a",
                scale: window.devicePixelRatio ?? 1,
                logging: false,
                ignoreElements: (el) =>
                    el.matches('[data-role="sidebar"]') ||
                    el.id === "export-dialog-backdrop",
            });
            const quality = format === "jpeg" ? 0.92 : undefined;
            return offscreen.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
        } catch {
            // fallback to canvas-only composite
            const composite = compositeViewport();
            if (!composite) throw new Error("Failed to capture screen");
            const quality = format === "jpeg" ? 0.92 : undefined;
            return composite.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION – Animation
    // ══════════════════════════════════════════════════════════════════════

    async function doGenerateAnimation() {
        if (ds.animBusy) return;
        const dates = buildDateSeries(ds.animStart, ds.animEnd, ds.animStep, ds.animCustomDays);
        if (dates.length === 0) {
            ds.animStatus = "⚠ No dates in range.";
            render();
            return;
        }

        ds.animBusy    = true;
        ds.animProgress = 0;
        ds.animStatus   = "Starting…";
        render();

        try {
            // Capture frames by stepping through dates
            const frames: HTMLCanvasElement[] = [];
            const origDate = callbacks.getState().date;

            for (let i = 0; i < dates.length; i++) {
                ds.animStatus   = `Capturing frame ${i + 1} / ${dates.length} (${dates[i]})`;
                ds.animProgress = Math.round((i / dates.length) * 80);
                updateAnimProgress();

                // Update the displayed date then trigger a full data fetch
                callbacks.setAnimationDate(dates[i]);
                await callbacks.loadData();   // waits for fetch + render to complete
                // Give the WebGL canvas an extra tick to composite the new data
                await new Promise<void>((r) => setTimeout(r, 80));

                const frame = compositeViewport();
                if (frame) {
                    // Clone the canvas (compositeViewport always reuses an element)
                    const clone = document.createElement("canvas");
                    clone.width  = frame.width;
                    clone.height = frame.height;
                    clone.getContext("2d")!.drawImage(frame, 0, 0);
                    frames.push(clone);
                }
            }

            // Restore original date and reload
            callbacks.setAnimationDate(origDate);
            void callbacks.loadData();

            if (frames.length === 0) throw new Error("No frames captured");

            ds.animStatus   = "Encoding video…";
            ds.animProgress = 85;
            updateAnimProgress();

            const blob = await encodeAnimation(frames, ds.animFps);
            ds.animStatus   = "Done!";
            ds.animProgress = 100;
            updateAnimProgress();

            triggerBlobDownload(blob, `climate-animation-${timestamp()}.mp4`);
        } catch (err: any) {
            ds.animStatus = `⚠ ${err?.message ?? "Failed"}`;
        } finally {
            ds.animBusy = false;
            render();
        }
    }

    function updateAnimProgress() {
        const fill = backdrop.querySelector<HTMLElement>(".export-progress-fill");
        const label = backdrop.querySelector<HTMLElement>(".export-progress-label");
        if (fill)  fill.style.width  = ds.animProgress + "%";
        if (label) label.textContent = ds.animStatus;
    }



    async function encodeAnimation(frames: HTMLCanvasElement[], fps: number): Promise<Blob> {
        const [first] = frames;
        // H.264 requires even dimensions – floor to nearest even number
        const width  = first.width  & ~1;
        const height = first.height & ~1;

        const target = new ArrayBufferTarget();
        const muxer  = new Muxer({
            target,
            video: { codec: "avc", width, height },
            fastStart: "in-memory",
        });

        const encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error:  (e) => { throw e; },
        });

        encoder.configure({
            codec:     "avc1.640033", // H.264 High Profile Level 5.1 (~9.4 MP max, covers 4K)
            width,
            height,
            bitrate:   6_000_000,
            framerate: fps,
        });

        const frameDuration = Math.round(1_000_000 / fps); // microseconds
        for (let i = 0; i < frames.length; i++) {
            const bitmap = await createImageBitmap(frames[i], 0, 0, width, height);
            const videoFrame = new VideoFrame(bitmap, {
                timestamp: i * frameDuration,
                duration:  frameDuration,
            });
            encoder.encode(videoFrame, { keyFrame: i % (fps * 2) === 0 });
            videoFrame.close();
            bitmap.close();
        }

        await encoder.flush();
        muxer.finalize();

        return new Blob([target.buffer], { type: "video/mp4" });
    }

    function buildDateSeries(
        start: string,
        end: string,
        step: DialogState["animStep"],
        customDays = 7,
    ): string[] {
        const result: string[] = [];
        if (!start || !end) return result;
        let current = new Date(start + "T00:00:00Z");
        const endDate = new Date(end + "T00:00:00Z");
        while (current <= endDate) {
            result.push(current.toISOString().slice(0, 10));
            if (step === "daily") {
                current.setUTCDate(current.getUTCDate() + 1);
            } else if (step === "monthly") {
                current.setUTCMonth(current.getUTCMonth() + 1);
            } else if (step === "yearly") {
                current.setUTCFullYear(current.getUTCFullYear() + 1);
            } else {
                // custom
                current.setUTCDate(current.getUTCDate() + Math.max(1, customDays));
            }
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION – Report
    // ══════════════════════════════════════════════════════════════════════

    async function doGenerateReport() {
        if (ds.reportBusy) return;
        ds.reportBusy   = true;
        ds.reportStatus  = "Generating PDF…";
        render();
        try {
            // Hide the export dialog so it doesn't appear in any screenshots
            backdrop.style.visibility = "hidden";
            await new Promise<void>((r) => setTimeout(r, 60)); // let browser repaint
            await generateReport(appState);
            ds.reportStatus = "PDF downloaded.";
        } catch (e: any) {
            ds.reportStatus = `⚠ ${e?.message ?? "Failed"}`;
        } finally {
            backdrop.style.visibility = "";
            ds.reportBusy = false;
            render();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION – Data download
    // ══════════════════════════════════════════════════════════════════════

    async function doDataDownload() {
        if (ds.dataBusy || ds.dataModels.size === 0 || ds.dataScenarios.size === 0) return;

        ds.dataBusy    = true;
        ds.dataProgress = 0;
        ds.dataStatus   = "Fetching data…";
        render();

        try {
            const variables = [...ds.dataVariables];
            const models    = [...ds.dataModels];
            const scenarios = [...ds.dataScenarios];
            const isSingleDate = ds.dataStartDate === ds.dataEndDate;
            const stepDays = ds.dataStep === "monthly" ? 30 : 365;
            const total = variables.length * models.length * scenarios.length;
            let done = 0;

            type Row = Record<string, string | number>;
            const allRows: Row[] = [];

            for (const variable of variables) {
                for (const model of models) {
                    for (const scenario of scenarios) {
                        const normalizedScenario = normalizeScenario(scenario);

                        let data: any;

                        if (ds.dataSpatial === "draw" && appState.mapPolygon) {
                            // ── Polygon aggregate from /aggregate-on-demand ──────
                            const poly = appState.mapPolygon as { lat: number; lon: number }[];
                            // Centroid of the polygon vertices
                            const centroidLat = +(poly.reduce((s, p) => s + p.lat, 0) / poly.length).toFixed(4);
                            const centroidLon = +(poly.reduce((s, p) => s + p.lon, 0) / poly.length).toFixed(4);

                            data = await fetchAggregateData({
                                variable,
                                model,
                                scenario: normalizedScenario,
                                start: ds.dataStartDate,
                                end: ds.dataEndDate,
                                resolution: ds.dataResolution,
                                stepDays,
                                polygon: poly,
                            });
                            // Parse time series rows
                            if (data?.results?.[model]) {
                                const ts = data.results[model];
                                ts.timestamps.forEach((t: string, i: number) => {
                                    allRows.push({
                                        variable,
                                        model,
                                        scenario,
                                        timestamp: t,
                                        latitude: centroidLat,
                                        longitude: centroidLon,
                                        spatial_scope: "polygon_mean",
                                        value: ts.values[i] ?? "NaN",
                                    });
                                });
                            }
                        } else if (isSingleDate) {
                            // ── Single raster snapshot from /data ────────────────
                            data = await fetchRasterData({
                                variable,
                                model,
                                scenario: normalizedScenario,
                                time: ds.dataStartDate,
                                resolution: ds.dataResolution,
                            });
                            if (data?.data) {
                                const arr  = decodeBase64Float32(data.data as string);
                                const [nRows, nCols] = data.shape as [number, number];
                                // OpenVisus full grid is south-up: row 0 = -60°S, last row = 90°N
                                for (let r = 0; r < nRows; r++) {
                                    const lat = +(-60 + (r + 0.5) * (150 / nRows)).toFixed(4);
                                    for (let c = 0; c < nCols; c++) {
                                        const val = arr[r * nCols + c];
                                        if (isNaN(val)) continue;
                                        const lonNorm = (c + 0.5) * (360 / nCols);
                                        const lon = +(lonNorm > 180 ? lonNorm - 360 : lonNorm).toFixed(4);
                                        allRows.push({
                                            variable,
                                            model,
                                            scenario,
                                            timestamp: ds.dataStartDate,
                                            latitude: lat,
                                            longitude: lon,
                                            value: val,
                                        });
                                    }
                                }
                            }
                        } else {
                            // ── Time series from /time-series ────────────────────
                            data = await fetchTimeSeries({
                                variable,
                                model,
                                scenario: normalizedScenario,
                                start: ds.dataStartDate,
                                end: ds.dataEndDate,
                                resolution: ds.dataResolution,
                                stepDays,
                            });
                            if (Array.isArray(data)) {
                                data.forEach((frame: any) => {
                                    if (frame?.time && frame.data) {
                                        const arr  = decodeBase64Float32(frame.data as string);
                                        const [nRows, nCols] = frame.shape as [number, number];
                                        // OpenVisus full grid is south-up: row 0 = -60°S, last row = 90°N
                                        for (let r = 0; r < nRows; r++) {
                                            const lat = +(-60 + (r + 0.5) * (150 / nRows)).toFixed(4);
                                            for (let c = 0; c < nCols; c++) {
                                                const val = arr[r * nCols + c];
                                                if (isNaN(val)) continue;
                                                const lonNorm = (c + 0.5) * (360 / nCols);
                                                const lon = +(lonNorm > 180 ? lonNorm - 360 : lonNorm).toFixed(4);
                                                allRows.push({
                                                    variable,
                                                    model,
                                                    scenario,
                                                    timestamp: frame.time,
                                                    latitude: lat,
                                                    longitude: lon,
                                                    value: val,
                                                });
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        done++;
                        ds.dataProgress = Math.round((done / total) * 90);
                        ds.dataStatus   = `Fetched ${done} / ${total}`;
                        updateDataProgress();
                    }
                }
            }

            if (allRows.length === 0) throw new Error("No data returned");

            ds.dataStatus   = "Writing file…";
            ds.dataProgress = 95;
            updateDataProgress();

            const filename = `climate-data-${variables.join("-")}-${timestamp()}`;
            if (ds.dataFormat === "csv") {
                const csv = rowsToCsv(allRows);
                triggerDownload(
                    "data:text/csv;charset=utf-8," + encodeURIComponent(csv),
                    filename + ".csv",
                );
            } else {
                const json = JSON.stringify({ query: buildQueryMeta(), rows: allRows }, null, 2);
                triggerDownload(
                    "data:application/json;charset=utf-8," + encodeURIComponent(json),
                    filename + ".json",
                );
            }

            ds.dataProgress = 100;
            ds.dataStatus   = `Done — ${allRows.length.toLocaleString()} records exported.`;
        } catch (err: any) {
            ds.dataStatus = `⚠ ${err?.message ?? "Failed"}`;
        } finally {
            ds.dataBusy = false;
            render();
        }
    }

    function updateDataProgress() {
        const fill  = backdrop.querySelector<HTMLElement>(".export-progress-fill");
        const label = backdrop.querySelector<HTMLElement>(".export-progress-label");
        if (fill)  fill.style.width  = ds.dataProgress + "%";
        if (label) label.textContent = ds.dataStatus;
    }

    function buildQueryMeta() {
        return {
            variables:   [...ds.dataVariables],
            models:      [...ds.dataModels],
            scenarios:   [...ds.dataScenarios],
            start_date:  ds.dataStartDate,
            end_date:    ds.dataEndDate,
            resolution:  ds.dataResolution,
            step:        ds.dataStep,
            spatial:     ds.dataSpatial,
            exported_at: new Date().toISOString(),
        };
    }

    // ── API helpers ────────────────────────────────────────────────────────

    async function fetchRasterData(params: {
        variable: string; model: string; scenario: string;
        time: string; resolution: string;
    }): Promise<any> {
        const resp = await fetch(`${API_BASE_URL}/data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                variable:    params.variable,
                model:       params.model,
                scenario:    params.scenario,
                time:        params.time,
                resolution:  params.resolution,
                data_format: "base64",
            }),
        });
        if (!resp.ok) throw new Error(`API error ${resp.status}`);
        return resp.json();
    }

    async function fetchTimeSeries(params: {
        variable: string; model: string; scenario: string;
        start: string; end: string; resolution: string; stepDays: number;
    }): Promise<any> {
        const resp = await fetch(`${API_BASE_URL}/time-series`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                variable:    params.variable,
                model:       params.model,
                scenario:    params.scenario,
                start_time:  params.start,
                end_time:    params.end,
                resolution:  params.resolution,
                step_days:   params.stepDays,
                data_format: "base64",
            }),
        });
        if (!resp.ok) throw new Error(`API error ${resp.status}`);
        return resp.json();
    }

    async function fetchAggregateData(params: {
        variable: string; model: string; scenario: string;
        start: string; end: string; resolution: string; stepDays: number;
        polygon: { lat: number; lon: number }[];
    }): Promise<any> {
        // Grid constants must match config.py: GRID_SHAPE = (600, 1440), GRID_RESOLUTION = 0.25°
        // Longitude: 0–360° system (x=0 → 0°E). Latitude: y=0 → 90°N, y=599 → ~-60°S (150° range).
        const GCOLS = 1440, GROWS = 600;

        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

        // Convert each polygon vertex to grid coords (north-down, lon 0-360)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const { lat, lon } of params.polygon) {
            const lonNorm = (((lon + 360) % 360) + 360) % 360;
            const gx = clamp(Math.round((lonNorm / 360) * GCOLS - 0.5), 0, GCOLS - 1);
            const gy = clamp(Math.round(((90 - lat) / 150) * GROWS - 0.5), 0, GROWS - 1);
            minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
            minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
        }

        const x0 = minX, x1 = maxX;
        // Flip y: OpenVisus is south-up (y=0 at south pole end)
        const y0 = GROWS - 1 - maxY;
        const y1 = GROWS - 1 - minY;

        const resp = await fetch(`${API_BASE_URL}/aggregate-on-demand`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                variable:   params.variable,
                models:     [params.model],
                scenario:   params.scenario,
                start_date: params.start,
                end_date:   params.end,
                resolution: params.resolution,
                step_days:  params.stepDays,
                x0, x1, y0, y1,
            }),
        });
        if (!resp.ok) throw new Error(`API error ${resp.status}`);
        return resp.json();
    }

    // ── Utility helpers ────────────────────────────────────────────────────

    function decodeBase64Float32(b64: string): Float32Array {
        const binary = atob(b64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Float32Array(bytes.buffer);
    }

    function rowsToCsv(rows: Record<string, string | number>[]): string {
        if (rows.length === 0) return "";
        const headers = Object.keys(rows[0]);
        const lines = [headers.join(",")];
        for (const row of rows) {
            lines.push(headers.map((h) => {
                const v = row[h];
                const s = String(v);
                return s.includes(",") ? `"${s}"` : s;
            }).join(","));
        }
        return lines.join("\n");
    }

    function triggerDownload(dataUrl: string, filename: string) {
        const a = document.createElement("a");
        a.href     = dataUrl;
        a.download = filename;
        a.click();
        a.remove();
    }

    function triggerBlobDownload(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function timestamp(): string {
        return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    }
}
