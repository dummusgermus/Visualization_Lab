/**
 * Captures all visible canvas layers merged into a single base64 PNG string,
 * respecting each canvas's position in the viewport.
 */
export async function captureMapScreenshot(
    _canvas: HTMLCanvasElement,
): Promise<string | null> {
    try {
        const allCanvases = Array.from(
            document.querySelectorAll<HTMLCanvasElement>("canvas")
        );

        if (allCanvases.length === 0) return null;

        const viewportWidth  = window.innerWidth;
        const viewportHeight = window.innerHeight;

        console.debug(`[Screenshot] Viewport: ${viewportWidth}x${viewportHeight}`);
        allCanvases.forEach((c, i) => {
            const r = c.getBoundingClientRect();
            console.debug(`[Screenshot] Canvas[${i}] pos=(${r.left.toFixed(0)},${r.top.toFixed(0)}) css=${r.width.toFixed(0)}x${r.height.toFixed(0)} buffer=${c.width}x${c.height}`);
        });

        // Step 1: Composite all canvas layers at viewport size
        const composite = document.createElement("canvas");
        composite.width  = viewportWidth;
        composite.height = viewportHeight;

        const ctx = composite.getContext("2d");
        if (!ctx) return null;

        ctx.fillStyle = "#0f121a";
        ctx.fillRect(0, 0, viewportWidth, viewportHeight);

        for (const c of allCanvases) {
            if (c.width === 0 || c.height === 0) continue;
            const rect = c.getBoundingClientRect();
            if (rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight) {
                console.debug(`[Screenshot] Skipping off-screen canvas`);
                continue;
            }
            try {
                ctx.drawImage(c, rect.left, rect.top, rect.width, rect.height);
            } catch (e) {
                console.warn("[Screenshot] Could not draw canvas layer:", e);
            }
        }

        // Step 2: Downscale to max 512px on the longest side to stay within token limits
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

        // Step 3: Encode as JPEG (much smaller than PNG) at reduced quality
        const base64 = output.toDataURL("image/jpeg", 0.7).split(",")[1];

        console.debug(`[Screenshot] Base64 size: ${(base64.length / 1024).toFixed(1)} KB`);

        // Debug: save screenshot as downloadable file
        saveScreenshotDebug(output);

        return base64;
    } catch (e) {
        console.warn("Failed to capture canvas screenshot:", e);
        return null;
    }
}

/**
 * Debug helper: triggers a download of the canvas as PNG
 */
function saveScreenshotDebug(canvas: HTMLCanvasElement): void {
    try {
        const link = document.createElement("a");
        link.download = `chat-screenshot-debug-${Date.now()}.jpg`;
        link.href = canvas.toDataURL("image/jpeg", 0.7);
        link.click();
        link.remove();
        console.debug("[Screenshot] Debug image downloaded.");
    } catch (e) {
        console.warn("[Screenshot] Debug save failed:", e);
    }
}