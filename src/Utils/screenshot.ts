/**
 * Draws a rounded-rectangle path (no fill/stroke applied).
 * Compatible with all browsers (does not rely on ctx.roundRect).
 */
function rrectPath(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x,  y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y,     x + r, y);
    ctx.closePath();
}

/**
 * Reads all visible `.map-legend` HTML elements and draws their content
 * (panel background, title, and tick-value labels) onto the provided 2D
 * canvas context.
 *
 * The canvas must already be viewport-sized so that
 * `getBoundingClientRect()` coordinates map 1-to-1 onto canvas pixels.
 * Call this AFTER compositing all <canvas> layers.
 */
export function drawLegendOverlaysOntoCanvas(ctx: CanvasRenderingContext2D): void {
    const legends = document.querySelectorAll<HTMLElement>(".map-legend");
    legends.forEach((legend) => {
        const lr = legend.getBoundingClientRect();
        if (lr.width === 0 || lr.height === 0) return;

        const x = lr.left, y = lr.top, w = lr.width, h = lr.height;

        // ── Panel background + border ─────────────────────────────────────
        ctx.save();
        rrectPath(ctx, x, y, w, h, 10);
        ctx.fillStyle = "rgb(9, 14, 26)"; // fully opaque so it looks solid in screenshots/PDFs
        ctx.fill();
        ctx.strokeStyle = "rgba(100, 116, 139, 0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // ── Legend title ─────────────────────────────────────────────────
        const titleEl = legend.querySelector<HTMLElement>(".legend-title");
        if (titleEl) {
            const tr = titleEl.getBoundingClientRect();
            ctx.save();
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "600 13px system-ui,-apple-system,sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(
                titleEl.textContent?.trim() ?? "",
                tr.left,
                tr.top,
                lr.right - tr.left - 8,
            );
            ctx.restore();
        }

        // ── Tick value labels ────────────────────────────────────────────
        legend.querySelectorAll<HTMLElement>(".legend-labels span").forEach((span) => {
            const sr = span.getBoundingClientRect();
            ctx.save();
            ctx.fillStyle = "#94a3b8";
            ctx.font = "400 11px system-ui,-apple-system,sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText(
                span.textContent?.trim() ?? "",
                sr.left,
                sr.top + sr.height / 2,
            );
            ctx.restore();
        });
    });
}

/**
 * Composites all canvas layers in the viewport into a single canvas,
 * then draws legend HTML overlays on top, and returns the result.
 *
 * @param startX     Left crop offset in viewport pixels (0 for full width).
 * @param sliceWidth Width of the output slice in viewport pixels.
 *                   Defaults to the full viewport width.
 */
export function compositeViewport(
    startX = 0,
    sliceWidth?: number,
): HTMLCanvasElement | null {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sw = sliceWidth ?? vw;

    // Step 1: render all canvases onto a full-viewport backing canvas
    const full = document.createElement("canvas");
    full.width  = vw;
    full.height = vh;
    const fullCtx = full.getContext("2d");
    if (!fullCtx) return null;

    fullCtx.fillStyle = "#0f121a";
    fullCtx.fillRect(0, 0, vw, vh);

    for (const c of Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas"))) {
        if (c.width === 0 || c.height === 0) continue;
        const rect = c.getBoundingClientRect();
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;
        try {
            // Clip to the nearest overflow:hidden ancestor so that split-view panes
            // don't bleed into each other when each canvas is wider than its pane.
            let clipRect: DOMRect | null = null;
            let parent = c.parentElement;
            while (parent && parent !== document.body) {
                const style = getComputedStyle(parent);
                if (style.overflow === "hidden" || style.overflowX === "hidden") {
                    clipRect = parent.getBoundingClientRect();
                    break;
                }
                parent = parent.parentElement;
            }
            if (clipRect) {
                fullCtx.save();
                fullCtx.beginPath();
                fullCtx.rect(
                    Math.max(0, clipRect.left),
                    Math.max(0, clipRect.top),
                    Math.min(clipRect.right, vw) - Math.max(0, clipRect.left),
                    Math.min(clipRect.bottom, vh) - Math.max(0, clipRect.top),
                );
                fullCtx.clip();
                fullCtx.drawImage(c, rect.left, rect.top, rect.width, rect.height);
                fullCtx.restore();
            } else {
                fullCtx.drawImage(c, rect.left, rect.top, rect.width, rect.height);
            }
        } catch { /* ignore tainted */ }
    }

    // Step 2: draw legend HTML overlays
    drawLegendOverlaysOntoCanvas(fullCtx);

    if (startX === 0 && sw === vw) return full;

    // Step 3: slice to requested region
    const out = document.createElement("canvas");
    out.width  = sw;
    out.height = vh;
    const outCtx = out.getContext("2d");
    if (!outCtx) return null;
    outCtx.drawImage(full, startX, 0, sw, vh, 0, 0, sw, vh);
    return out;
}

/**
 * Captures all visible canvas layers merged into a single base64 string,
 * including the legend panel (title + tick labels) drawn on top.
 * Downscaled to ≤512 px on the longest side to keep AI-chat token counts low.
 */
export async function captureMapScreenshot(
    _canvas: HTMLCanvasElement,
): Promise<string | null> {
    try {
        const viewportWidth  = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const composite = compositeViewport();
        if (!composite) return null;

        console.debug(`[Screenshot] Viewport: ${viewportWidth}x${viewportHeight}`);

        // Downscale to max 512px on the longest side to stay within token limits
        const MAX_SIZE = 512;
        const scale = Math.min(MAX_SIZE / viewportWidth, MAX_SIZE / viewportHeight, 1);
        const outputWidth  = Math.round(viewportWidth  * scale);
        const outputHeight = Math.round(viewportHeight * scale);

        const output = document.createElement("canvas");
        output.width  = outputWidth;
        output.height = outputHeight;
        const outCtx = output.getContext("2d");
        if (!outCtx) return null;

        outCtx.drawImage(composite, 0, 0, outputWidth, outputHeight);

        console.debug(`[Screenshot] Downscaled to ${outputWidth}x${outputHeight} (scale: ${scale.toFixed(2)})`);

        // Encode as JPEG at reduced quality
        const base64 = output.toDataURL("image/jpeg", 0.7).split(",")[1];
        console.debug(`[Screenshot] Base64 size: ${(base64.length / 1024).toFixed(1)} KB`);

        //saveScreenshotDebug(output);
        return base64;
    } catch (e) {
        console.warn("Failed to capture canvas screenshot:", e);
        return null;
    }
}

/**
 * Captures the current viewport (map canvases + legend overlays) and returns
 * a JPEG data URL downscaled to ≤ THUMB_W px wide.  Intended for embedding a
 * small preview image alongside a saved scenario in localStorage.
 *
 * For split-view, both halves are composited into one thumbnail side-by-side.
 * For chart/non-map views the same composite is used as a best-effort capture.
 *
 * Returns a data URL string (suitable for <img src> or jsPDF addImage), or
 * null if capture fails.
 */
export function captureThumbnailDataUrl(
    thumbWidth = 1200,
): string | null {
    try {
        const composite = compositeViewport();
        if (!composite) return null;

        const vw = composite.width;
        const vh = composite.height;
        const scale = Math.min(thumbWidth / vw, 1);
        const outW = Math.round(vw * scale);
        const outH = Math.round(vh * scale);

        const out = document.createElement("canvas");
        out.width  = outW;
        out.height = outH;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(composite, 0, 0, outW, outH);

        return out.toDataURL("image/jpeg", 0.90);
    } catch {
        return null;
    }
}

/**
 * (Removed unused debug helper saveScreenshotDebug to satisfy noUnusedLocals.)
 */