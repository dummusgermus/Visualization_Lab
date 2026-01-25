import { hexToRgb } from "../Utils/colorUtils";
import type { Metadata } from "../Utils/dataClient";
import { convertMinMax, getUnitString } from "../Utils/unitConverter";
import "./legend.css";

// Store references for indicator updates
let legendCanvas: HTMLCanvasElement | null = null;
let currentPaletteColors: string[] = [];

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
    metadata?: Metadata,
    selectedUnit?: string,
    isDifference?: boolean,
    offsetY = 0,
): string {
    const variableMeta = metadata?.variable_metadata[variable];
    const name = variableMeta?.name || variable;

    // Convert min/max if unit is selected
    let convertedMin = min;
    let convertedMax = max;
    let unit = variableMeta?.unit || "";
    
    if (selectedUnit) {
        const converted = convertMinMax(min, max, variable, selectedUnit, {
            isDifference,
        });
        convertedMin = converted.min;
        convertedMax = converted.max;
        unit = getUnitString(variable, selectedUnit);
    }

    // Calculate 5 equally spaced values from max to min
    const step = (convertedMax - convertedMin) / 4;
    const values = [
        convertedMax,
        convertedMax - step,
        convertedMax - 2 * step,
        convertedMax - 3 * step,
        convertedMin,
    ];

    const offsetStyle = offsetY
        ? `style="transform: translateY(calc(-50% - ${offsetY}px));"`
        : "";
    return `
      <div class="map-legend" ${offsetStyle}>
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

    // Redraw the gradient first
    const ctx = legendCanvas.getContext("2d");
    if (!ctx) return;

    const width = legendCanvas.width;
    const height = legendCanvas.height;

    renderGradient(ctx, width, height, currentPaletteColors);

    // Calculate position on legend (max at top, min at bottom)
    const range = max - min;
    const normalized =
        !Number.isFinite(range) || range <= 0 || !Number.isFinite(value)
            ? 0.5
            : Math.min(1, Math.max(0, (value - min) / range));
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
