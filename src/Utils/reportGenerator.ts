/**
 * Report Generator
 *
 * Generates a PDF report of the current application state, including:
 * - Screenshot(s) of the current view
 * - Descriptions of what is shown and selected
 * - Full chat history (user and AI messages / selections)
 */

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import anyAscii from "any-ascii";
import type { AppState, Window2State } from "../main";
import { compositeViewport } from "./screenshot";
import { describeScreenshotForReport } from "./chatClient";

// ─── Colour palette for the PDF ────────────────────────────────────────────
const COLORS = {
    dark:    [30,  40,  55]  as [number, number, number],
    medium:  [80,  90, 110]  as [number, number, number],
    light:   [140, 150, 170] as [number, number, number],
    accent:  [59,  130, 246] as [number, number, number],   // blue
    user:    [30,  100, 200] as [number, number, number],   // blue
    agent:   [20,  140,  80] as [number, number, number],   // green
    divider: [220, 225, 235] as [number, number, number],
};

// ─── Screenshot capture ─────────────────────────────────────────────────────

/**
 * Captures the full viewport using html2canvas so that HTML overlays
 * (map-info panel, range view, legend, etc.) are included alongside the
 * WebGL/2D map canvases.  Falls back to the canvas-only composite on error.
 */
async function captureMapView(): Promise<string | null> {
    try {
        const offscreen = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#0f121a",
            scale: window.devicePixelRatio ?? 1,
            logging: false,
            ignoreElements: (el) =>
                el.matches('[data-role="sidebar"], [data-action="toggle-sidebar"]'),
        });
        return offscreen.toDataURL("image/jpeg", 0.92);
    } catch {
        // Fallback: canvas-only composite (no HTML overlays)
        const canvas = compositeViewport();
        return canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
    }
}

/**
 * Captures one horizontal half of the viewport — used for split-view reports.
 * @param side "left" = first half, "right" = second half
 */
async function captureMapViewHalf(side: "left" | "right"): Promise<string | null> {
    try {
        const full = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#0f121a",
            scale: window.devicePixelRatio ?? 1,
            logging: false,
            ignoreElements: (el) =>
                el.matches('[data-role="sidebar"], [data-action="toggle-sidebar"]'),
        });
        const vw = full.width;
        const vh = full.height;
        const pane2 = document.getElementById("split-pane-2");
        const dpr = window.devicePixelRatio ?? 1;
        const splitX = pane2
            ? Math.round(pane2.getBoundingClientRect().left * dpr)
            : Math.floor(vw / 2);
        const startX = side === "right" ? splitX : 0;
        const width  = side === "right" ? vw - splitX : splitX;
        const out = document.createElement("canvas");
        out.width  = width;
        out.height = vh;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(full, startX, 0, width, vh, 0, 0, width, vh);
        return out.toDataURL("image/jpeg", 0.92);
    } catch {
        // Fallback: canvas-only composite
        const vw = window.innerWidth;
        const pane2 = document.getElementById("split-pane-2");
        const splitX = pane2 ? Math.round(pane2.getBoundingClientRect().left) : Math.floor(vw / 2);
        const leftW  = splitX;
        const rightW = vw - splitX;
        const startX = side === "right" ? splitX : 0;
        const width  = side === "right" ? rightW : leftW;
        const canvas = compositeViewport(startX, width);
        return canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
    }
}

/**
 * Uses html2canvas to capture the chart/SVG view.
 * Falls back to the canvas composite if html2canvas fails.
 */
async function captureChartView(): Promise<string | null> {
    try {
        const offscreen = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#0f121a",
            scale: window.devicePixelRatio ?? 1,
            logging: false,
            ignoreElements: (el) =>
                el.matches('[data-role="sidebar"], [data-action="toggle-sidebar"]'),
        });
        return offscreen.toDataURL("image/jpeg", 0.92);
    } catch {
        return captureMapView(); // fallback
    }
}

// ─── State description builders ─────────────────────────────────────────────

function fmt(label: string, value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === "") return null;
    return `${label}: ${value}`;
}

function fmtList(label: string, values: string[] | null | undefined): string | null {
    if (!values || values.length === 0) return null;
    return `${label}: ${values.join(", ")}`;
}

/** Returns an array of "Label: value" strings describing the main app view. */
function buildMainViewLines(state: AppState): string[] {
    const lines: string[] = [];

    lines.push(`Mode: ${state.mode}`);
    lines.push(`View: ${state.canvasView === "map" ? "Map" : "Chart"}`);

    if (state.canvasView === "map") {
        if (state.mode === "Explore") {
            lines.push(...[
                fmt("Variable",  state.variable),
                fmt("Scenario",  state.scenario),
                fmt("Model",     state.model),
                fmt("Date",      state.date),
                fmt("Unit",      state.selectedUnit),
                fmt("Palette",   state.mapPalette),
            ].filter(Boolean) as string[]);

        } else if (state.mode === "Compare") {
            lines.push(`Compare Mode: ${state.compareMode}`);
            if (state.compareMode === "Scenarios") {
                lines.push(...[
                    fmt("Scenario A", state.compareScenarioA),
                    fmt("Scenario B", state.compareScenarioB),
                    fmt("Model",      state.model),
                    fmt("Date",       state.compareDateStart),
                ].filter(Boolean) as string[]);
            } else if (state.compareMode === "Models") {
                lines.push(...[
                    fmt("Model A",  state.compareModelA),
                    fmt("Model B",  state.compareModelB),
                    fmt("Scenario", state.scenario),
                    fmt("Date",     state.compareDateStart),
                ].filter(Boolean) as string[]);
            } else if (state.compareMode === "Dates") {
                lines.push(...[
                    fmt("Date A",   state.compareDateStart),
                    fmt("Date B",   state.compareDateEnd),
                    fmt("Variable", state.variable),
                    fmt("Scenario", state.scenario),
                    fmt("Model",    state.model),
                ].filter(Boolean) as string[]);
            }
            lines.push(...[
                fmt("Unit",    state.selectedUnit),
                fmt("Palette", state.mapPalette),
            ].filter(Boolean) as string[]);

        } else if (state.mode === "Ensemble") {
            lines.push(...[
                fmt("Variable",        state.ensembleVariable),
                fmtList("Scenarios",   state.ensembleScenarios),
                fmtList("Models",      state.ensembleModels),
                fmt("Statistic",       state.ensembleStatistic),
                fmt("Date",            state.ensembleDate),
                fmt("Unit",            state.ensembleUnit),
                fmt("Palette",         state.mapPalette),
            ].filter(Boolean) as string[]);
        }

        // Location / selection
        if (state.mapMarker) {
            const name = state.mapMarker.name ? ` (${state.mapMarker.name})` : "";
            lines.push(`Selected Point: ${state.mapMarker.lat.toFixed(4)}°N, ${state.mapMarker.lon.toFixed(4)}°E${name}`);
        }
        if (state.mapPolygon && state.mapPolygon.length > 0) {
            lines.push(`Selection Polygon: ${state.mapPolygon.length} vertices`);
        }

        // Active masks
        const activeMasks = (state.masks ?? []).filter(
            (m) => m.lowerBound !== null || m.upperBound !== null,
        );
        if (activeMasks.length > 0) {
            activeMasks.forEach((m, i) => {
                const lo = m.lowerBound !== null ? m.lowerBound.toFixed(2) : "−∞";
                const hi = m.upperBound !== null ? m.upperBound.toFixed(2) : "+∞";
                const varLabel = m.variable ? ` (${m.variable})` : "";
                lines.push(`Mask ${i + 1}${varLabel}: ${lo} – ${hi}`);
            });
        }

        // Map options
        const opts: string[] = [];
        if (state.mapShowBorders) opts.push("borders");
        if (state.mapShowCities)  opts.push("cities");
        if (opts.length > 0) lines.push(`Overlay: ${opts.join(", ")}`);

    } else {
        // Chart view
        lines.push(...[
            fmt("Variable",           state.chartVariable),
            fmt("Chart Mode",         state.chartMode),
            fmtList("Scenarios",      state.chartScenarios),
            fmtList("Models",         state.chartModels),
        ].filter(Boolean) as string[]);

        if (state.chartMode === "single") {
            lines.push(...[fmt("Date", state.chartDate)].filter(Boolean) as string[]);
        } else {
            if (state.chartRangeStart || state.chartRangeEnd) {
                lines.push(`Date Range: ${state.chartRangeStart} – ${state.chartRangeEnd}`);
            }
        }

        const locLabel = state.chartLocationName
            ? `${state.chartLocation} (${state.chartLocationName})`
            : state.chartLocation;
        lines.push(
            ...[ fmt("Location", locLabel), fmt("Unit", state.chartUnit) ]
                .filter(Boolean) as string[],
        );

        if (state.chartPoint) {
            lines.push(`Chart Point: ${state.chartPoint.lat.toFixed(4)}°N, ${state.chartPoint.lon.toFixed(4)}°E`);
        }
        if (state.chartPolygon && state.chartPolygon.length > 0) {
            lines.push(`Chart Polygon: ${state.chartPolygon.length} vertices`);
        }
    }

    return lines;
}

/** Returns description lines for the Window 2 (split-view right panel). */
function buildWindow2Lines(w2: Window2State): string[] {
    return [
        fmt("Mode",     w2.mode),
        fmt("Variable", w2.variable),
        fmt("Scenario", w2.scenario),
        fmt("Model",    w2.model),
        fmt("Date",     w2.date),
        fmt("Unit",     w2.selectedUnit),
        fmt("Palette",  w2.mapPalette),
    ].filter(Boolean) as string[];
}

// ─── PDF layout helpers ──────────────────────────────────────────────────────

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN  = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H    = 4.5;

function setColor(pdf: jsPDF, rgb: [number, number, number]) {
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function drawDivider(pdf: jsPDF, y: number): number {
    pdf.setDrawColor(...COLORS.divider);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
    return y + 3;
}

function sectionHeader(
    pdf: jsPDF,
    text: string,
    y: number,
): number {
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    setColor(pdf, COLORS.dark);
    pdf.text(text, MARGIN, y);
    return y + 6;
}

/**
 * Wraps text and writes it to the PDF, automatically adding pages when needed.
 * Pre-splits on explicit newlines first so agent-formatted text doesn't overflow.
 * Returns the new y position.
 */
/** Replace Unicode characters that fall outside Windows-1252 with safe equivalents.
 *  jsPDF's built-in Helvetica uses CP1252 metrics; chars outside that range are
 *  measured as zero-width by splitTextToSize, causing text to bleed off the page.
 *
 *  CP1252 covers U+0000–U+00FF (Latin-1) plus a set of extra chars in U+0080–U+009F:
 *    0x80=€  0x82=‚  0x83=ƒ  0x84=„  0x85=…  0x86=†  0x87=‡  0x88=ˆ  0x89=‰
 *    0x8A=Š  0x8B=‹  0x8C=Œ  0x8E=Ž  0x91='  0x92='  0x93="  0x94="  0x95=•
 *    0x96=–  0x97=—  0x98=˜  0x99=™  0x9A=š  0x9B=›  0x9C=œ  0x9E=ž  0x9F=Ÿ
 *  All of those are kept as-is (jsPDF maps them correctly).
 *  U+00B0 (°) is valid CP1252 and is intentionally kept. */
function toCP1252Safe(s: string): string {
    return s
        // U+2212 MINUS SIGN: not in CP1252 — replace with ASCII hyphen-minus
        .replace(/\u2212/g, "-")
        // U+00D7 × and U+00F7 ÷ are in CP1252 (Latin-1), but Helvetica lacks them
        .replace(/\u00D7/g, "x")
        .replace(/\u00F7/g, "/")
        // Strip C1 control range entries that have NO CP1252 mapping (0x81,0x8D,0x8F,0x90,0x9D)
        .replace(/[\u0081\u008D\u008F\u0090\u009D]/g, "")
        // Transliterate any remaining non-CP1252 characters (Cyrillic, CJK, Arabic, etc.)
        // to their closest Latin ASCII equivalent using any-ascii, then strip anything
        // still outside the CP1252 range (should be rare after transliteration).
        .replace(/[^\x00-\xFF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/g,
            (ch) => anyAscii(ch));
}

function writeWrapped(
    pdf: jsPDF,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number = LINE_H,
): number {
    // Split on explicit newlines first so markdown paragraph breaks are honoured.
    // toCP1252Safe is applied here so splitTextToSize gets correct CP1252 widths.
    const paragraphs = toCP1252Safe(text).split(/\r?\n/);
    for (const para of paragraphs) {
        // jsPDF splitTextToSize wraps long paragraphs; force-truncate any single
        // word that is still wider than maxWidth to prevent it bleeding off the page.
        const lines: string[] = pdf.splitTextToSize(para.length > 0 ? para : " ", maxWidth);
        for (const line of lines) {
            if (y > PAGE_H - 15) {
                pdf.addPage();
                y = MARGIN;
            }
            pdf.text(line as string, x, y);
            y += lineHeight;
        }
    }
    return y;
}

function addImageFitWidth(
    pdf: jsPDF,
    dataUrl: string,
    yStart: number,
    maxH: number = 90,
): number {
    const img = new Image();
    img.src = dataUrl;
    const nativeW = img.naturalWidth  || window.innerWidth;
    const nativeH = img.naturalHeight || window.innerHeight;
    const aspect  = nativeH / nativeW;
    const displayH = Math.min(CONTENT_W * aspect, maxH);
    const displayW = displayH / aspect;
    const xOffset  = MARGIN + (CONTENT_W - displayW) / 2;
    pdf.addImage(dataUrl, "JPEG", xOffset, yStart, displayW, displayH);
    return yStart + displayH + 8; // 8 mm margin below image
}

function addTwoImages(
    pdf: jsPDF,
    leftUrl: string,
    rightUrl: string,
    yStart: number,
    maxH: number = 80,
): number {
    const halfW = (CONTENT_W - 4) / 2;

    const imgL = new Image();
    imgL.src = leftUrl;
    const nativeLW = imgL.naturalWidth  || window.innerWidth / 2;
    const nativeLH = imgL.naturalHeight || window.innerHeight;
    const aspectL = nativeLH / nativeLW;
    const dispLH = Math.min(halfW * aspectL, maxH);
    const dispLW = dispLH / aspectL;

    const imgR = new Image();
    imgR.src = rightUrl;
    const nativeRW = imgR.naturalWidth  || window.innerWidth / 2;
    const nativeRH = imgR.naturalHeight || window.innerHeight;
    const aspectR = nativeRH / nativeRW;
    const dispRH = Math.min(halfW * aspectR, maxH);
    const dispRW = dispRH / aspectR;

    const totalH  = Math.max(dispLH, dispRH);
    const xLeft   = MARGIN;
    const xRight  = MARGIN + halfW + 4;

    pdf.addImage(leftUrl,  "JPEG", xLeft,  yStart, dispLW, dispLH);
    pdf.addImage(rightUrl, "JPEG", xRight, yStart, dispRW, dispRH);

    // Labels below images
    const labelY = yStart + totalH + 3;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    setColor(pdf, COLORS.medium);
    pdf.text("View 1 (Left panel)",  xLeft,  labelY);
    pdf.text("View 2 (Right panel)", xRight, labelY);

    return labelY + 8; // 8 mm margin below the label row
}

// ─── Saved configs (from localStorage) ──────────────────────────────────────

const CONFIG_CACHE_STORAGE_KEY = "polyoracle-saved-configs-v1";

type SavedConfigEntry = {
    name: string;
    savedAt: string;
    data: Record<string, any>;
};

function getSavedConfigsFromStorage(): SavedConfigEntry[] {
    try {
        const raw = localStorage.getItem(CONFIG_CACHE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (e): e is SavedConfigEntry =>
                    e && typeof e === "object" &&
                    typeof e.name === "string" &&
                    typeof e.savedAt === "string" &&
                    e.data && typeof e.data === "object",
            )
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    } catch {
        return [];
    }
}

/** Builds "Label: value" lines from a raw saved-config data object. */
function buildSavedConfigLines(data: Record<string, any>): string[] {
    const lines: string[] = [];
    const f = (label: string, key: string) => {
        const v = data[key];
        if (v !== null && v !== undefined && v !== "") lines.push(`${label}: ${v}`);
    };
    const fList = (label: string, key: string) => {
        const v = data[key];
        if (Array.isArray(v) && v.length > 0) lines.push(`${label}: ${v.join(", ")}`);
    };

    f("Mode", "mode");
    f("View", "canvasView");

    const mode: string = data["mode"] ?? "";
    const view: string = data["canvasView"] ?? "map";

    if (view === "map") {
        if (mode === "Explore") {
            f("Variable",  "variable");
            f("Scenario",  "scenario");
            f("Model",     "model");
            f("Date",      "date");
            f("Unit",      "selectedUnit");
            f("Palette",   "mapPalette");
        } else if (mode === "Compare") {
            f("Compare Mode",  "compareMode");
            f("Scenario A",    "compareScenarioA");
            f("Scenario B",    "compareScenarioB");
            f("Model A",       "compareModelA");
            f("Model B",       "compareModelB");
            f("Variable",      "variable");
            f("Date A",        "compareDateStart");
            f("Date B",        "compareDateEnd");
            f("Unit",          "selectedUnit");
            f("Palette",       "mapPalette");
        } else if (mode === "Ensemble") {
            f("Variable",        "ensembleVariable");
            fList("Scenarios",   "ensembleScenarios");
            fList("Models",      "ensembleModels");
            f("Statistic",       "ensembleStatistic");
            f("Date",            "ensembleDate");
            f("Unit",            "ensembleUnit");
            f("Palette",         "mapPalette");
        }
    } else {
        // Chart view
        f("Variable",     "chartVariable");
        f("Chart Mode",   "chartMode");
        fList("Scenarios","chartScenarios");
        fList("Models",   "chartModels");
        f("Date",         "chartDate");
        f("Unit",         "chartUnit");
        f("Location",     "chartLocationName");
    }

    // Masks
    const masks: Array<any> = Array.isArray(data["masks"]) ? data["masks"] : [];
    const activeMasks = masks.filter(
        (m) => m.lowerBound !== null || m.upperBound !== null,
    );
    activeMasks.forEach((m, i) => {
        const lo = m.lowerBound !== null ? Number(m.lowerBound).toFixed(2) : "−∞";
        const hi = m.upperBound !== null ? Number(m.upperBound).toFixed(2) : "+∞";
        const varLabel = m.variable ? ` (${m.variable})` : "";
        lines.push(`Mask ${i + 1}${varLabel}: ${lo} – ${hi}`);
    });

    return lines;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates and downloads a PDF report of the current application state,
 * including screenshot(s), settings summary, full chat history, and all
 * saved scenarios.
 */
export async function generateReport(state: AppState): Promise<void> {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    // Patch pdf.text so every call site is automatically CP1252-safe,
    // regardless of which helper function produced the string.
    const _origText = pdf.text.bind(pdf) as typeof pdf.text;
    (pdf as any).text = (text: string | string[], x: number, y: number, options?: any, transform?: any) => {
        const safe = typeof text === "string" ? toCP1252Safe(text)
                   : Array.isArray(text)      ? (text as string[]).map(toCP1252Safe)
                   : text;
        return _origText(safe as any, x, y, options, transform);
    };

    // ── Page 1: Title ──────────────────────────────────────────────────────

    let y = MARGIN;

    // Accent bar
    pdf.setFillColor(...COLORS.accent);
    pdf.rect(MARGIN, y, CONTENT_W, 1.2, "F");
    y += 6;

    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    setColor(pdf, COLORS.dark);
    pdf.text("Polyoracle Climate Analysis Report", MARGIN, y);
    y += 7;

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    setColor(pdf, COLORS.light);
    const timestamp = new Date().toLocaleString(undefined, {
        dateStyle: "long",
        timeStyle: "short",
    });
    pdf.text(`Generated: ${timestamp}`, MARGIN, y);
    y += 2;
    y = drawDivider(pdf, y);
    y += 2;

    // ── Screenshots ────────────────────────────────────────────────────────

    const isSplitMap = state.splitView && state.canvasView === "map";

    if (isSplitMap) {
        // Capture each half of the viewport (including HTML overlays)
        const [leftUrl, rightUrl] = await Promise.all([
            captureMapViewHalf("left"),
            captureMapViewHalf("right"),
        ]);

        if (leftUrl && rightUrl) {
            y = addTwoImages(pdf, leftUrl, rightUrl, y);
        } else if (leftUrl) {
            y = addImageFitWidth(pdf, leftUrl, y);
        }

        // AI descriptions for each panel
        const [descLeft, descRight] = await Promise.all([
            leftUrl  ? describeScreenshotForReport(leftUrl.split(",")[1],  "View 1 – Left panel")  : Promise.resolve(null),
            rightUrl ? describeScreenshotForReport(rightUrl.split(",")[1], "View 2 – Right panel") : Promise.resolve(null),
        ]);

        if (descLeft || descRight) {
            if (y > PAGE_H - 40) { pdf.addPage(); y = MARGIN; }
            y = sectionHeader(pdf, "Visual Analysis", y);
            if (descLeft) {
                pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); setColor(pdf, COLORS.accent);
                pdf.text("View 1 – Left panel", MARGIN, y);
                y += LINE_H;
                pdf.setFontSize(8.5); pdf.setFont("helvetica", "italic"); setColor(pdf, COLORS.dark);
                y = writeWrapped(pdf, descLeft, MARGIN, y, CONTENT_W);
                y += 2;
            }
            if (descRight) {
                pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); setColor(pdf, COLORS.accent);
                pdf.text("View 2 – Right panel", MARGIN, y);
                y += LINE_H;
                pdf.setFontSize(8.5); pdf.setFont("helvetica", "italic"); setColor(pdf, COLORS.dark);
                y = writeWrapped(pdf, descRight, MARGIN, y, CONTENT_W);
                y += 2;
            }
        }
        y = drawDivider(pdf, y);

    } else if (state.canvasView === "map") {
        // Single map view — composite all canvas layers + legend HTML
        const imgUrl = await captureMapView();
        if (imgUrl) y = addImageFitWidth(pdf, imgUrl, y);

        // AI description
        if (imgUrl) {
            const desc = await describeScreenshotForReport(imgUrl.split(",")[1]);
            if (desc) {
                if (y > PAGE_H - 30) { pdf.addPage(); y = MARGIN; }
                y = sectionHeader(pdf, "Visual Analysis", y);
                pdf.setFontSize(8.5); pdf.setFont("helvetica", "italic"); setColor(pdf, COLORS.dark);
                y = writeWrapped(pdf, desc, MARGIN, y, CONTENT_W);
                y += 2;
            }
        }
        y = drawDivider(pdf, y);

    } else {
        // Chart view — use html2canvas for full-fidelity capture (includes SVG)
        const imgUrl = await captureChartView();
        if (imgUrl) y = addImageFitWidth(pdf, imgUrl, y);

        // AI description
        if (imgUrl) {
            const desc = await describeScreenshotForReport(imgUrl.split(",")[1], "Chart view");
            if (desc) {
                if (y > PAGE_H - 30) { pdf.addPage(); y = MARGIN; }
                y = sectionHeader(pdf, "Visual Analysis", y);
                pdf.setFontSize(8.5); pdf.setFont("helvetica", "italic"); setColor(pdf, COLORS.dark);
                y = writeWrapped(pdf, desc, MARGIN, y, CONTENT_W);
                y += 2;
            }
        }
        y = drawDivider(pdf, y);
    }

    // ── Settings summary ───────────────────────────────────────────────────

    if (isSplitMap) {
        y = sectionHeader(pdf, "Current Settings", y);

        const mainLines = buildMainViewLines(state);
        const win2Lines = buildWindow2Lines(state.window2);
        const colW = (CONTENT_W - 4) / 2;

        // Column headers
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        setColor(pdf, COLORS.accent);
        pdf.text("View 1 – Left panel",  MARGIN,         y);
        pdf.text("View 2 – Right panel", MARGIN + colW + 4, y);
        y += 5;

        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "normal");
        setColor(pdf, COLORS.medium);

        const maxCount = Math.max(mainLines.length, win2Lines.length);
        for (let i = 0; i < maxCount; i++) {
            if (y > PAGE_H - 15) { pdf.addPage(); y = MARGIN; }
            if (mainLines[i]) pdf.text(mainLines[i], MARGIN,         y);
            if (win2Lines[i]) pdf.text(win2Lines[i], MARGIN + colW + 4, y);
            y += LINE_H;
        }
        y += 4;

    } else {
        y = sectionHeader(pdf, "Current Settings", y);
        const lines = buildMainViewLines(state);
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "normal");
        setColor(pdf, COLORS.medium);
        for (const line of lines) {
            if (y > PAGE_H - 20) { pdf.addPage(); y = MARGIN; }
            pdf.text(line, MARGIN, y);
            y += LINE_H;
        }
        y += 4;
    }

    y = drawDivider(pdf, y);

    // ── Chat / AI history ──────────────────────────────────────────────────

    if (state.chatMessages.length === 0) {
        y = sectionHeader(pdf, "Chat History", y);
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "italic");
        setColor(pdf, COLORS.light);
        pdf.text("No conversation recorded.", MARGIN, y);
    } else {
        if (y > PAGE_H - 50) { pdf.addPage(); y = MARGIN; }
        y = sectionHeader(pdf, `Chat History  (${state.chatMessages.length} messages)`, y);

        for (const msg of state.chatMessages) {
            if (y > PAGE_H - 25) { pdf.addPage(); y = MARGIN; }

            const isUser = msg.sender === "user";
            const senderLabel = isUser ? "You" : "AI Agent";
            const senderColor = isUser ? COLORS.user : COLORS.agent;

            // Sender badge
            pdf.setFontSize(8);
            pdf.setFont("helvetica", "bold");
            setColor(pdf, senderColor);
            pdf.text(`${senderLabel}:`, MARGIN, y);
            y += LINE_H;

            // Strip markdown formatting for plain PDF text
            const cleaned = msg.text
                .replace(/\*\*(.+?)\*\*/g,  "$1")
                .replace(/```[\s\S]+?```/g, "[code block]")
                .replace(/`(.+?)`/g,        "$1")
                .replace(/#+\s/g,           "")
                .trim();

            // If the AI message also contained state changes, note it
            const hasStateChange = msg.new_state && Object.keys(msg.new_state).length > 0;
            const stateNote = hasStateChange
                ? " [applied state changes to the visualization]"
                : "";

            pdf.setFontSize(8.5);
            pdf.setFont("helvetica", "normal");
            setColor(pdf, COLORS.dark);

            const fullText = cleaned + stateNote;
            y = writeWrapped(pdf, fullText, MARGIN + 4, y, CONTENT_W - 4);
            y += 2; // small gap between messages
        }
    }

    // ── Saved Scenarios ────────────────────────────────────────────────────

    const savedConfigs = getSavedConfigsFromStorage();

    if (savedConfigs.length > 0) {
        pdf.addPage();
        y = MARGIN;

        // Accent bar
        pdf.setFillColor(...COLORS.accent);
        pdf.rect(MARGIN, y, CONTENT_W, 1.2, "F");
        y += 6;

        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        setColor(pdf, COLORS.dark);
        pdf.text(`Saved Scenarios  (${savedConfigs.length})`, MARGIN, y);
        y += 7;
        y = drawDivider(pdf, y);

        for (const entry of savedConfigs) {
            if (y > PAGE_H - 40) { pdf.addPage(); y = MARGIN; }

            // Entry name + timestamp
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "bold");
            setColor(pdf, COLORS.dark);
            pdf.text(entry.name, MARGIN, y);
            y += LINE_H;

            const savedDate = new Date(entry.savedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
            });
            pdf.setFontSize(8);
            pdf.setFont("helvetica", "italic");
            setColor(pdf, COLORS.light);
            pdf.text(`Saved: ${savedDate}`, MARGIN, y);
            y += LINE_H + 1;

            // Thumbnail screenshot (if captured at save time)
            const thumbnail: string | undefined = (entry.data as any)._thumbnail;
            if (thumbnail) {
                const img = new Image();
                img.src = thumbnail;
                const nativeW = img.naturalWidth  || window.innerWidth;
                const nativeH = img.naturalHeight || window.innerHeight;
                const aspect  = nativeH / nativeW;
                const thumbDisplayW = CONTENT_W; // full content width
                const thumbDisplayH = thumbDisplayW * aspect;
                if (y + thumbDisplayH + 2 > PAGE_H - 15) { pdf.addPage(); y = MARGIN; }
                pdf.addImage(thumbnail, "JPEG", MARGIN, y, thumbDisplayW, thumbDisplayH);
                y += thumbDisplayH + 3;
            }
            const cd = entry.data?.configDescription as {
                title?: string;
                body?: string;
            } | null | undefined;
            if (cd?.body) {
                pdf.setFontSize(8.5);
                pdf.setFont("helvetica", "italic");
                setColor(pdf, COLORS.dark);
                y = writeWrapped(pdf, cd.body, MARGIN + 2, y, CONTENT_W - 2);
                y += 2;
            }

            // Settings lines
            const settingLines = buildSavedConfigLines(entry.data);
            if (settingLines.length > 0) {
                pdf.setFontSize(8.5);
                pdf.setFont("helvetica", "normal");
                setColor(pdf, COLORS.medium);
                for (const line of settingLines) {
                    if (y > PAGE_H - 15) { pdf.addPage(); y = MARGIN; }
                    pdf.text(line, MARGIN + 2, y);
                    y += LINE_H;
                }
            }

            y += 3;
            y = drawDivider(pdf, y);
        }
    }

    // ── Footer on every page ───────────────────────────────────────────────

    const totalPages = (pdf as any).internal.getNumberOfPages() as number;
    for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        pdf.setFontSize(7.5);
        pdf.setFont("helvetica", "normal");
        setColor(pdf, COLORS.light);
        pdf.text(
            `Page ${p} / ${totalPages}`,
            PAGE_W - MARGIN,
            PAGE_H - 6,
            { align: "right" },
        );
        pdf.text("Polyoracle Climate Visualization", MARGIN, PAGE_H - 6);
    }

    // ── Download ───────────────────────────────────────────────────────────

    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`polyoracle-report-${dateStr}.pdf`);
}
