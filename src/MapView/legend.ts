import { hexToRgb } from "../Utils/colorUtils";
import type { Metadata } from "../Utils/dataClient";
import "./legend.css";

export function renderMapLegend(
    variable: string,
    min: number,
    max: number,
    metadata?: Metadata
): string {
    const variableMeta = metadata?.variable_metadata[variable];
    const unit = variableMeta?.unit || "";
    const name = variableMeta?.name || variable;

    return `
      <div class="map-legend">
        <div class="legend-title">${name}</div>
        <canvas id="legend-gradient-canvas" width="300" height="20" style="width: 100%; height: 20px; border-radius: 4px;"></canvas>
        <div class="legend-labels">
          <span>${min.toFixed(2)} ${unit}</span>
          <span>${max.toFixed(2)} ${unit}</span>
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

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Convert hex colors to RGB
    const paletteRgb = paletteColors.map(hexToRgb);

    // Create gradient by interpolating between palette colors
    for (let x = 0; x < width; x++) {
        const normalized = x / (width - 1);
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
        ctx.fillRect(x, 0, 1, height);
    }
}
