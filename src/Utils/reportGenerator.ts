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
import type { AppState, Window2State } from "../main";
import { compositeViewport } from "./screenshot";

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
 * Captures the full viewport (all map canvases + legend HTML overlays)
 * and returns a JPEG data URL at full resolution.
 */
function captureMapView(): string | null {
    const canvas = compositeViewport();
    return canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
}

/**
 * Captures one horizontal half of the viewport — used for split-view reports.
 * @param side "left" = first half, "right" = second half
 */
function captureMapViewHalf(side: "left" | "right"): string | null {
    const vw = window.innerWidth;
    const halfW = Math.floor(vw / 2);
    const startX = side === "right" ? halfW : 0;
    const canvas = compositeViewport(startX, halfW);
    return canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
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
 * Returns the new y position.
 */
function writeWrapped(
    pdf: jsPDF,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number = LINE_H,
): number {
    const lines = pdf.splitTextToSize(text, maxWidth);
    for (const line of lines) {
        if (y > PAGE_H - 15) {
            pdf.addPage();
            y = MARGIN;
        }
        pdf.text(line as string, x, y);
        y += lineHeight;
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
    return yStart + displayH + 3;
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
    const labelY = yStart + totalH + 2;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    setColor(pdf, COLORS.medium);
    pdf.text("View 1 (Left panel)",  xLeft,  labelY);
    pdf.text("View 2 (Right panel)", xRight, labelY);

    return labelY + 5;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates and downloads a PDF report of the current application state,
 * including screenshot(s), settings summary, and full chat history.
 */
export async function generateReport(state: AppState): Promise<void> {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

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
        // Capture each half of the viewport (including the legend overlay)
        const leftUrl  = captureMapViewHalf("left");
        const rightUrl = captureMapViewHalf("right");

        if (leftUrl && rightUrl) {
            y = addTwoImages(pdf, leftUrl, rightUrl, y);
        } else if (leftUrl) {
            y = addImageFitWidth(pdf, leftUrl, y);
        }

    } else if (state.canvasView === "map") {
        // Single map view — composite all canvas layers + legend HTML
        const imgUrl = captureMapView();
        if (imgUrl) y = addImageFitWidth(pdf, imgUrl, y);

    } else {
        // Chart view — use html2canvas for full-fidelity capture (includes SVG)
        const imgUrl = await captureChartView();
        if (imgUrl) y = addImageFitWidth(pdf, imgUrl, y);
    }

    y = drawDivider(pdf, y);

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
