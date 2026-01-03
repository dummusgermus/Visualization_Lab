import { hexToRgb } from "../Utils/colorUtils";
import type { Metadata } from "../Utils/dataClient";
import "./legend.css";

// Store references for indicator updates
let legendCanvas: HTMLCanvasElement | null = null;
let currentPaletteColors: string[] = [];
let currentMin = 0;
let currentMax = 1;

// Helper function to render the gradient on a canvas
function renderGradient(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    paletteColors: string[]
): void {
    const paletteRgb = paletteColors.map(hexToRgb);

    for (let y = 0; y < height; y++) {
        const normalized = 1 - y / (height - 1);
        const colorIdx = normalized * (paletteRgb.length - 1);
        const idx1 = Math.floor(colorIdx);
        const idx2 = Math.min(idx1 + 1, paletteRgb.length - 1);
        const t = colorIdx - idx1;

        const c1 = paletteRgb[idx1];
        const c2 = paletteRgb[idx2];

        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, y, width, 1);
    }
}

export function renderMapLegend(
    variable: string,
    min: number,
    max: number,
    metadata?: Metadata
): string {
    const variableMeta = metadata?.variable_metadata[variable];
    const unit = variableMeta?.unit || "";
    const name = variableMeta?.name || variable;

    // Calculate 5 equally spaced values from max to min
    const step = (max - min) / 4;
    const values = [max, max - step, max - 2 * step, max - 3 * step, min];

    //TODO Legend still looks weird for some variables like "precipitation" because values are just 0.00
    return `
      <div class="map-legend">
        <div class="legend-title">${name}</div>
        <div class="legend-container">
        <canvas id="legend-gradient-canvas" width="20" height="200" style="width: 20px; height: 200px; border-radius: 4px;"></canvas>
          <div class="legend-labels">
            ${values
                .map((val) => `<span>${val.toFixed(2)} ${unit}</span>`)
                .join("")}
          </div>
        </div>
      </div>
    `;
}

export function drawLegendGradient(
    canvasId: string,
    paletteColors: string[]
): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
        console.warn("Legend canvas not found");
        return;
    }

    // Store references for indicator updates
    legendCanvas = canvas;
    currentPaletteColors = paletteColors;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    renderGradient(ctx, width, height, paletteColors);
}

export function updateLegendIndicator(
    value: number,
    min: number,
    max: number
): void {
    if (!legendCanvas || currentPaletteColors.length === 0) return;

    // Store current range
    currentMin = min;
    currentMax = max;

    // Redraw the gradient first
    const ctx = legendCanvas.getContext("2d");
    if (!ctx) return;

    const width = legendCanvas.width;
    const height = legendCanvas.height;

    renderGradient(ctx, width, height, currentPaletteColors);

    // Calculate position on legend (max at top, min at bottom)
    const normalized = (value - min) / (max - min);
    const y = Math.round(height * (1 - normalized));

    // Draw indicator line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

export function clearLegendIndicator(): void {
    if (!legendCanvas || currentPaletteColors.length === 0) return;

    const ctx = legendCanvas.getContext("2d");
    if (!ctx) return;

    const width = legendCanvas.width;
    const height = legendCanvas.height;

    renderGradient(ctx, width, height, currentPaletteColors);
}
