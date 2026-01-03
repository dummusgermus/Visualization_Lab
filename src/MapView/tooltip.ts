import { clearLegendIndicator, updateLegendIndicator } from "./legend";
import "./tooltip.css";

// Tooltip element
let tooltipElement: HTMLDivElement | null = null;
let currentMin = 0;
let currentMax = 1;

function getOrCreateTooltip(): HTMLDivElement {
    if (!tooltipElement) {
        tooltipElement = document.createElement("div");
        tooltipElement.className = "map-tooltip";
        document.body.appendChild(tooltipElement);
    }
    return tooltipElement;
}

export function showTooltip(
    clientX: number,
    clientY: number,
    lat: number,
    lon: number,
    value: number,
    unit: string
): void {
    const tooltip = getOrCreateTooltip();
    tooltip.textContent = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(
        2
    )}, Value: ${value.toFixed(2)} ${unit}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${clientX + 10}px`;
    tooltip.style.top = `${clientY + 10}px`;

    // Update legend indicator
    updateLegendIndicator(value, currentMin, currentMax);
}

export function hideTooltip(): void {
    const tooltip = getOrCreateTooltip();
    tooltip.style.display = "none";

    // Clear legend indicator
    clearLegendIndicator();
}

export function setDataRange(min: number, max: number): void {
    currentMin = min;
    currentMax = max;
}
