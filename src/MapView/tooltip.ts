import { clearLegendIndicator, updateLegendIndicator } from "./legend";
import { convertValue, getUnitString } from "../Utils/unitConverter";
import "./tooltip.css";

// Per-canvas tooltip/legend state
interface CanvasTooltipState {
    min: number;
    max: number;
    variable: string;
    selectedUnit: string;
    isDifference: boolean;
    probabilityMode: boolean;
}

const defaultState = (): CanvasTooltipState => ({
    min: 0, max: 1, variable: "", selectedUnit: "", isDifference: false, probabilityMode: false,
});

const canvasStates = new Map<string, CanvasTooltipState>([
    ["legend-gradient-canvas", defaultState()],
]);

// Tooltip element
let tooltipElement: HTMLDivElement | null = null;

// Which legend canvas is currently "active" (receives the hover indicator)
let activeLegendCanvasId = "legend-gradient-canvas";

/**
 * Switch which legend canvas receives hover-indicator updates.
 * The stored data range for that canvas is used for indicator placement.
 * Call with the default id (or no args) to reset to Window 1.
 */
export function setActiveLegendCanvas(id = "legend-gradient-canvas"): void {
    activeLegendCanvasId = id;
}

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
    unit: string,
    isDifference?: boolean
): void {
    const tooltip = getOrCreateTooltip();

    const cs = canvasStates.get(activeLegendCanvasId) ?? canvasStates.get("legend-gradient-canvas") ?? defaultState();

    let convertedValue = value;
    let displayUnit = unit;
    if (cs.probabilityMode) {
        displayUnit = "%";
    } else if (cs.selectedUnit && cs.variable) {
        convertedValue = convertValue(value, cs.variable, cs.selectedUnit, {
            isDifference: isDifference ?? cs.isDifference,
        });
        displayUnit = getUnitString(cs.variable, cs.selectedUnit) || unit;
    }

    tooltip.textContent = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(
        2
    )}, Value: ${convertedValue.toFixed(2)} ${displayUnit}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${clientX + 10}px`;
    tooltip.style.top = `${clientY + 10}px`;

    updateLegendIndicator(convertedValue, cs.min, cs.max, activeLegendCanvasId);
}

export function hideTooltip(): void {
    const tooltip = getOrCreateTooltip();
    tooltip.style.display = "none";

    // Clear legend indicator on whichever canvas is currently active
    clearLegendIndicator(activeLegendCanvasId);
    // Reset routing back to the default (Window 1) legend
    activeLegendCanvasId = "legend-gradient-canvas";
}

export function setDataRange(
    min: number,
    max: number,
    variable?: string,
    selectedUnit?: string,
    isDifference?: boolean,
    isProbabilityMode?: boolean,
    canvasId = "legend-gradient-canvas",
): void {
    const existing = canvasStates.get(canvasId) ?? defaultState();
    canvasStates.set(canvasId, {
        min,
        max,
        variable: variable ?? existing.variable,
        selectedUnit: selectedUnit ?? existing.selectedUnit,
        isDifference: isDifference ?? existing.isDifference,
        probabilityMode: isProbabilityMode ?? existing.probabilityMode,
    });
}
