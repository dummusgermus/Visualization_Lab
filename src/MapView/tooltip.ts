import { clearLegendIndicator, updateLegendIndicator } from "./legend";
import { convertValue, getUnitString } from "../Utils/unitConverter";
import "./tooltip.css";

// Tooltip element
let tooltipElement: HTMLDivElement | null = null;
let currentMin = 0;
let currentMax = 1;
let currentVariable = "";
let currentSelectedUnit = "";
let currentIsDifference = false;

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
    
    // Convert value if unit is selected
    let convertedValue = value;
    let displayUnit = unit;
    if (currentSelectedUnit && currentVariable) {
        convertedValue = convertValue(value, currentVariable, currentSelectedUnit, {
            isDifference: isDifference ?? currentIsDifference,
        });
        displayUnit = getUnitString(currentVariable, currentSelectedUnit) || unit;
    }
    
    tooltip.textContent = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(
        2
    )}, Value: ${convertedValue.toFixed(2)} ${displayUnit}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${clientX + 10}px`;
    tooltip.style.top = `${clientY + 10}px`;

    // Update legend indicator (use converted value for indicator position)
    // But we need to convert the min/max too for proper indicator position
    let convertedMin = currentMin;
    let convertedMax = currentMax;
    if (currentSelectedUnit && currentVariable) {
        const minConverted = convertValue(
            currentMin,
            currentVariable,
            currentSelectedUnit,
            { isDifference: isDifference ?? currentIsDifference }
        );
        const maxConverted = convertValue(
            currentMax,
            currentVariable,
            currentSelectedUnit,
            { isDifference: isDifference ?? currentIsDifference }
        );
        convertedMin = minConverted;
        convertedMax = maxConverted;
    }
    updateLegendIndicator(convertedValue, convertedMin, convertedMax);
}

export function hideTooltip(): void {
    const tooltip = getOrCreateTooltip();
    tooltip.style.display = "none";

    // Clear legend indicator
    clearLegendIndicator();
}

export function setDataRange(
    min: number,
    max: number,
    variable?: string,
    selectedUnit?: string,
    isDifference?: boolean
): void {
    currentMin = min;
    currentMax = max;
    if (variable !== undefined) {
        currentVariable = variable;
    }
    if (selectedUnit !== undefined) {
        currentSelectedUnit = selectedUnit;
    }
    if (isDifference !== undefined) {
        currentIsDifference = isDifference;
    }
}
