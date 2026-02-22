import * as d3 from "d3";
import { hexToRgb } from "../Utils/colorUtils";
import { dataToArray, type ClimateData } from "../Utils/dataClient";
import { convertMinMax, convertValue } from "../Utils/unitConverter";
import { hideTooltip, setDataRange, showTooltip } from "./tooltip";
import {
    drawBaseMapOverlay,
    setBaseMapOverlayInvalidationCallback,
    setBaseMapOverlayVisibility,
} from "./baseMapOverlay";

type DrawCallbacks = {
    onClick?: (coords: { lat: number; lon: number }) => void;
    onMove?: (coords: { lat: number; lon: number }) => void;
};

// Use d3.ZoomTransform for pan/zoom state
let currentTransform = d3.zoomIdentity;
let zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown> | null = null;

// Cache for pre-rendered map
let cachedMapCanvas: HTMLCanvasElement | null = null;

// Cache for hover functionality
let cachedData: ClimateData | null = null;
let cachedIsDifference = false;
let cachedValueLookup: (Float32Array | Float64Array | null)[] | null = null;
let cachedVariable: string | undefined = undefined;
let cachedSelectedUnit: string | undefined = undefined;

let drawMode = false;
let drawCallbacks: DrawCallbacks | null = null;
let transformCallback: (() => void) | null = null;

function isDifferenceEnsembleStatistic(
    stat: "mean" | "std" | "median" | "iqr" | "percentile" | "extremes",
): boolean {
    return stat === "std" || stat === "iqr" || stat === "percentile" || stat === "extremes";
}

function erfApprox(x: number): number {
    // Abramowitz and Stegun approximation (7.1.26)
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const poly = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
    const y = 1 - poly * Math.exp(-ax * ax);
    return sign * y;
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

function computeGaussianRangeProbabilityAtIndex(
    sampleArrays: Array<Float32Array | Float64Array>,
    idx: number,
    variable: string,
    unit: string | undefined,
    lowerBound: number | null,
    upperBound: number | null,
    lowerEdited: boolean,
    upperEdited: boolean,
): number {
    let count = 0;
    let mean = 0;
    let m2 = 0;
    for (const sample of sampleArrays) {
        const raw = sample[idx];
        if (!Number.isFinite(raw)) continue;
        const clipped = variable === "hurs" ? Math.min(raw, 100) : raw;
        const value = unit ? convertValue(clipped, variable, unit) : clipped;
        if (!Number.isFinite(value)) continue;
        count += 1;
        const delta = value - mean;
        mean += delta / count;
        const delta2 = value - mean;
        m2 += delta * delta2;
    }
    if (count === 0) return NaN;

    const lower = lowerEdited && lowerBound !== null ? lowerBound : -Infinity;
    const upper = upperEdited && upperBound !== null ? upperBound : Infinity;
    if (lower > upper) return 0;

    const variance = m2 / count;
    const std = Math.sqrt(Math.max(0, variance));
    if (!Number.isFinite(std) || std < 1e-10) {
        return mean >= lower && mean <= upper ? 1 : 0;
    }

    const zLower = (lower - mean) / std;
    const zUpper = (upper - mean) / std;
    const probability = normalCdf(zUpper) - normalCdf(zLower);
    return Math.max(0, Math.min(1, probability));
}

// Export function to reset map transform state
export function resetMapTransform(): void {
    currentTransform = d3.zoomIdentity;
    if (zoomBehavior && cachedMapCanvas) {
        d3.select(cachedMapCanvas).call(
            zoomBehavior.transform,
            d3.zoomIdentity,
        );
    }
}

export function getCurrentZoomLevel(): number {
    return currentTransform.k;
}

export function setMapOverlayVisibility(options: {
    showBorders?: boolean;
    showLabels?: boolean;
}) {
    setBaseMapOverlayVisibility(options);
    if (cachedMapCanvas) {
        const targetCanvas = document.querySelector<HTMLCanvasElement>("#map-canvas");
        if (targetCanvas) {
            redrawCachedMap(targetCanvas);
        }
    }
}

// Helper function to setup canvas with proper DPI scaling
function setupCanvas(canvas: HTMLCanvasElement): {
    ctx: CanvasRenderingContext2D;
    rect: DOMRect;
    viewWidth: number;
    viewHeight: number;
} | null {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    return {
        ctx,
        rect,
        viewWidth: rect.width,
        viewHeight: rect.height,
    };
}

// Helper function to convert grid indices to lat/lon
// Climate data typically uses 0-360° longitude range (not -180 to 180°)
// We convert to -180 to 180° for standard display
function gridToLatLon(
    x: number,
    y: number,
    lonStep: number,
    latStep: number,
): [number, number] {
    const lonRaw = x * lonStep + lonStep / 2;
    const lon = lonRaw > 180 ? lonRaw - 360 : lonRaw;
    // Latitude: y=0 → 90° (North), y=height → -60° (South, excluding Antarctica)
    const lat = 90 - (y * latStep + latStep / 2);
    return [lon, lat];
}

// Helper function to get data value at grid position
function getDataValue(
    x: number,
    y: number,
    width: number,
    height: number,
    arrayData: Float32Array | Float64Array,
): number | null {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const flippedY = height - 1 - y;
    const idx = flippedY * width + x;
    const value = arrayData[idx];
    return isFinite(value) ? value : null;
}

function updateCursor(canvas: HTMLCanvasElement) {
    if (drawMode) {
        canvas.style.cursor = "crosshair";
    } else {
        canvas.style.cursor = "auto";
    }
}

function pointerToLonLat(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
): { lat: number; lon: number } | null {
    if (!cachedMapCanvas) return null;

    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Apply inverse D3 zoom transform to get world coordinates
    let worldX = (mouseX - currentTransform.x) / currentTransform.k;
    const worldY = (mouseY - currentTransform.y) / currentTransform.k;

    const mapWidth = cachedMapCanvas.width;
    const mapHeight = cachedMapCanvas.height;

    // Validate bounds first (allowing for wrapped coordinates)
    if (worldY < 0 || worldY > mapHeight) {
        return null;
    }

    // Normalize worldX to [0, mapWidth) range (canonical representation)
    // Handle both positive and negative worldX values correctly
    let normalizedX = worldX;

    // Use modulo arithmetic that works correctly with negative numbers
    // JavaScript's % operator gives negative results for negative inputs, so we need to handle that
    normalizedX = normalizedX % mapWidth;
    if (normalizedX < 0) {
        normalizedX += mapWidth;
    }

    // Clamp to ensure it's strictly in [0, mapWidth) range
    if (normalizedX < 0) normalizedX = 0;
    if (normalizedX >= mapWidth) normalizedX = mapWidth * (1 - Number.EPSILON);

    // Calculate longitude from normalized coordinate (will be in [-180, 180) range)
    const lon = (normalizedX / mapWidth) * 360 - 180;

    // Latitude range is -60°S to 90°N (150° total)
    const lat = 90 - (worldY / mapHeight) * 150;

    // Final safety clamp to ensure values are in valid ranges
    const clampedLon = Math.max(-180, Math.min(180, lon));
    const clampedLat = Math.max(-90, Math.min(90, lat));

    // Additional validation: ensure no NaN or Infinity values
    if (!Number.isFinite(clampedLon) || !Number.isFinite(clampedLat)) {
        return null;
    }

    return { lat: clampedLat, lon: clampedLon };
}

function setDrawMode(enabled: boolean, callbacks?: DrawCallbacks | null) {
    drawMode = enabled;
    drawCallbacks = enabled ? (callbacks ?? null) : null;
}

export function projectLonLatToCanvas(
    canvas: HTMLCanvasElement,
    lon: number,
    lat: number,
): { x: number; y: number } | null {
    if (!cachedMapCanvas) return null;
    const mapWidth = cachedMapCanvas.width;
    const mapHeight = cachedMapCanvas.height;

    // Normalize longitude to [-180, 180] range first
    let normalizedLon = lon;
    while (normalizedLon > 180) normalizedLon -= 360;
    while (normalizedLon < -180) normalizedLon += 360;

    const projectedX = ((normalizedLon + 180) / 360) * mapWidth;
    // Latitude range is -60°S to 90°N (150° total)
    const projectedY = ((90 - lat) / 150) * mapHeight;

    // Apply D3 zoom transform
    const x = projectedX * currentTransform.k + currentTransform.x;
    const y = projectedY * currentTransform.k + currentTransform.y;

    const rect = canvas.getBoundingClientRect();
    const wrapWidth = mapWidth * currentTransform.k;

    // Find the copy of the point that's closest to the center of the current view
    // This ensures lines connect properly when crossing the antimeridian
    const viewCenterX = rect.width / 2;
    let bestX = x;
    let bestDistance = Math.abs(x - viewCenterX);

    // Try copies to the left and right to find the closest one to the view center
    for (let offset = -wrapWidth; offset <= wrapWidth; offset += wrapWidth) {
        const candidateX = x + offset;
        const distance = Math.abs(candidateX - viewCenterX);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestX = candidateX;
        }
    }

    if (
        y < -mapHeight * currentTransform.k ||
        y > rect.height + mapHeight * currentTransform.k
    ) {
        return null;
    }

    return { x: bestX, y };
}

export function setupMapInteractions(
    canvas: HTMLCanvasElement,
    currentData: ClimateData | null,
    unit: string,
    _variable?: string,
    _selectedUnit?: string,
    options?: {
        drawMode?: boolean;
        onDrawClick?: (coords: { lat: number; lon: number }) => void;
        onDrawMove?: (coords: { lat: number; lon: number }) => void;
        onMapClick?: (coords: { lat: number; lon: number }) => void;
        onTransform?: () => void;
    },
): void {
    setDrawMode(options?.drawMode ?? false, {
        onClick: options?.onDrawClick,
        onMove: options?.onDrawMove,
    });
    transformCallback = options?.onTransform ?? null;
    updateCursor(canvas);

    const selection = d3.select(canvas);

    zoomBehavior = d3
        .zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.8, 10.0])
        .filter((e: any) => {
            if (drawMode) return false;
            return !e.ctrlKey && !e.button;
        })
        .on("zoom", (e: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
            currentTransform = e.transform;
            if (cachedMapCanvas) {
                redrawCachedMap(canvas);
            } else if (currentData) {
                redrawCachedMap(canvas);
            }
            transformCallback?.();
        })
        .on("start", () => {
            canvas.style.cursor = "grabbing";
            hideTooltip();
        })
        .on("end", () => {
            updateCursor(canvas);
        });

    selection.call(zoomBehavior);
    // Preserve the current zoom/pan state across re-renders
    selection.call(zoomBehavior.transform, currentTransform);

    selection.on("click.draw", (e: MouseEvent) => {
        const coords = pointerToLonLat(canvas, e.clientX, e.clientY);
        if (!coords) return;
        if (drawMode) {
            drawCallbacks?.onClick?.(coords);
            return;
        }
        options?.onMapClick?.(coords);
    });

    selection.on("pointermove.tooltip", (e: PointerEvent) => {
        if (drawMode) {
            const coords = pointerToLonLat(canvas, e.clientX, e.clientY);
            if (coords) {
                drawCallbacks?.onMove?.(coords);
            }
            hideTooltip();
            return;
        }

        if (
            e.buttons === 0 &&
            cachedData &&
            cachedValueLookup &&
            cachedMapCanvas
        ) {
            const [mouseX, mouseY] = d3.pointer(e, canvas);
            updateTooltip(
                e.clientX,
                e.clientY,
                mouseX,
                mouseY,
                unit,
                cachedVariable,
                cachedSelectedUnit,
                cachedIsDifference,
            );
        }
    });

    selection.on("pointerleave", () => {
        hideTooltip();
    });

    updateCursor(canvas);
}

// Fast redraw function that just transforms the cached image
function redrawCachedMap(canvas: HTMLCanvasElement): void {
    if (!cachedMapCanvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();

    // Apply D3 zoom transform
    ctx.translate(currentTransform.x, currentTransform.y);
    ctx.scale(currentTransform.k, currentTransform.k);

    // Draw the cached pre-rendered map multiple times for horizontal wrapping
    // Disable image smoothing for crisp pixels (nearest-neighbor interpolation)
    ctx.imageSmoothingEnabled = false;
    const mapWidth = cachedMapCanvas.width;
    const viewLeft = -currentTransform.x / currentTransform.k;
    const viewRight = (rect.width - currentTransform.x) / currentTransform.k;
    const startTile = Math.floor(viewLeft / mapWidth) - 1;
    const endTile = Math.ceil(viewRight / mapWidth) + 1;

    for (let i = startTile; i <= endTile; i++) {
        ctx.drawImage(cachedMapCanvas, i * mapWidth, 0);
    }

    ctx.restore();

    drawBaseMapOverlay(
        ctx,
        rect.width,
        rect.height,
        cachedMapCanvas.width,
        cachedMapCanvas.height,
        {
            x: currentTransform.x,
            y: currentTransform.y,
            k: currentTransform.k,
        },
    );
}

export function renderMapData(
    data: ClimateData,
    mapCanvas: HTMLCanvasElement | null,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    currentPalette: string,
    min: number,
    max: number,
    variable?: string,
    selectedUnit?: string,
    masks?: Array<{
        lowerBound: number | null;
        upperBound: number | null;
        lowerEdited: boolean;
        upperEdited: boolean;
        statistic?: "mean" | "std" | "median" | "iqr" | "percentile" | "extremes";
        variable?: string;
        unit?: string;
        kind?: "binary" | "probability";
    }>,
    ensembleStatistics?: Map<"mean" | "std" | "median" | "iqr" | "percentile" | "extremes", Float32Array> | null,
    isEnsembleMode?: boolean,
    maskVariableData?: Map<string, ClimateData>,
    ensembleStatisticsByVariable?: Map<
        string,
        Map<"mean" | "std" | "median" | "iqr" | "percentile" | "extremes", Float32Array>
    > | null,
    ensembleRawSamplesByVariable?: Map<
        string,
        Array<Float32Array | Float64Array>
    > | null,
): void {
    // masks parameter is used in the rendering loop below
    if (!mapCanvas) return;

    try {
        runRenderMapData(
            data,
            mapCanvas,
            paletteOptions,
            currentPalette,
            min,
            max,
            variable,
            selectedUnit,
            masks,
            ensembleStatistics,
            isEnsembleMode,
            maskVariableData,
            ensembleStatisticsByVariable,
            ensembleRawSamplesByVariable,
        );
    } catch (err) {
        console.error("renderMapData failed (e.g. when changing display variable with masks):", err);
    }
}

function runRenderMapData(
    data: ClimateData,
    mapCanvas: HTMLCanvasElement,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    currentPalette: string,
    min: number,
    max: number,
    variable?: string,
    selectedUnit?: string,
    masks?: Array<{
        lowerBound: number | null;
        upperBound: number | null;
        lowerEdited: boolean;
        upperEdited: boolean;
        statistic?: "mean" | "std" | "median" | "iqr" | "percentile" | "extremes";
        variable?: string;
        unit?: string;
        kind?: "binary" | "probability";
    }>,
    ensembleStatistics?: Map<"mean" | "std" | "median" | "iqr" | "percentile" | "extremes", Float32Array> | null,
    isEnsembleMode?: boolean,
    maskVariableData?: Map<string, ClimateData>,
    ensembleStatisticsByVariable?: Map<
        string,
        Map<"mean" | "std" | "median" | "iqr" | "percentile" | "extremes", Float32Array>
    > | null,
    ensembleRawSamplesByVariable?: Map<
        string,
        Array<Float32Array | Float64Array>
    > | null,
): void {
    const arrayData = dataToArray(data);
    if (!arrayData) {
        console.warn("No data to render");
        return;
    }

    const setup = setupCanvas(mapCanvas);
    if (!setup) return;
    let { viewWidth, viewHeight } = setup;
    
    // Ensure dimensions are valid integers (getBoundingClientRect can return decimals)
    viewWidth = Math.floor(viewWidth);
    viewHeight = Math.floor(viewHeight);
    
    // Guard against invalid canvas dimensions
    if (viewWidth <= 0 || viewHeight <= 0 || !isFinite(viewWidth) || !isFinite(viewHeight)) {
        console.warn("Invalid canvas dimensions:", { viewWidth, viewHeight });
        return;
    }
    
    const [height, width] = data.shape;
    const expectedLen = width * height;

    // Cache for hover functionality
    const isDifference =
        Boolean((data as any)?.metadata?.comparison) ||
        (typeof data.model === "string" && data.model.includes(" minus "));

    cachedData = data;
    cachedVariable = variable;
    cachedSelectedUnit = selectedUnit;
    cachedIsDifference = isDifference;
    const valueLookup = new Array(viewHeight)
        .fill(null)
        .map(() => new Float32Array(viewWidth).fill(NaN));

    // Convert min/max if unit conversion is selected
    let convertedMin = min;
    let convertedMax = max;
    if (variable && selectedUnit) {
        const converted = convertMinMax(min, max, variable, selectedUnit, {
            isDifference,
        });
        convertedMin = converted.min;
        convertedMax = converted.max;
    }
    // Guard against NaN/non-finite min/max (e.g. new variable, bad API data) to avoid crash
    if (!Number.isFinite(convertedMin)) convertedMin = 0;
    if (!Number.isFinite(convertedMax)) convertedMax = 1;
    if (convertedMax <= convertedMin) convertedMax = convertedMin + 1;

    const palette =
        paletteOptions.find((p) => p.name === currentPalette) ||
        paletteOptions[0];
    const colors = palette.colors;

    // Pre-compute RGB values for palette (need at least one for indexing)
    const paletteRgb = colors.length > 0 ? colors.map(hexToRgb) : [hexToRgb("#808080")];

    // Direct equirectangular projection (simple linear mapping)
    // This ensures accurate coordinate mapping without D3 projection quirks
    // Formula: x = (lon + 180) / 360 * viewWidth, y = (90 - lat) / 150 * viewHeight
    // This maps: lon[-180,180] -> x[0,viewWidth], lat[90,-60] -> y[0,viewHeight]
    function projectLonLat(lon: number, lat: number): [number, number] {
        const x = ((lon + 180) / 360) * viewWidth;
        const y = ((90 - lat) / 150) * viewHeight;
        return [x, y];
    }

    // Create an offscreen canvas for the projected data
    const offscreen = document.createElement("canvas");
    offscreen.width = viewWidth;
    offscreen.height = viewHeight;
    const offscreenCtx = offscreen.getContext("2d");
    if (!offscreenCtx) return;

    // Create ImageData for direct pixel manipulation
    const imageData = offscreenCtx.createImageData(viewWidth, viewHeight);
    const pixels = imageData.data;

    // Pre-calculate cell size
    const cellSize = Math.max(viewWidth / width, viewHeight / height);
    const halfCell = Math.ceil(cellSize / 2);

    const lonStep = 360 / width;
    // NEX-GDDP-CMIP6 dataset: latitude range is -60°S to 90°N (150° total, not 180°)
    const latStep = 150 / height;

    const maskVariableArrays = new Map<string, Float32Array | Float64Array>();
    const probabilityMasks =
        isEnsembleMode && masks
            ? masks.filter((mask) => mask.kind === "probability")
            : [];
    const binaryMasks =
        masks?.filter((mask) => mask.kind !== "probability") ?? [];
    const useProbabilityRendering =
        Boolean(isEnsembleMode) && probabilityMasks.length > 0;
    const effectiveColorMin = useProbabilityRendering ? 0 : convertedMin;
    const effectiveColorMax = useProbabilityRendering ? 1 : convertedMax;
    const effectiveTooltipMin = useProbabilityRendering ? 0 : convertedMin;
    const effectiveTooltipMax = useProbabilityRendering ? 100 : convertedMax;

    // Set data range for tooltip/legend indicator (use converted values)
    setDataRange(
        effectiveTooltipMin,
        effectiveTooltipMax,
        variable,
        selectedUnit,
        isDifference,
        useProbabilityRendering,
    );

    if (!isEnsembleMode && masks && masks.length > 0 && maskVariableData) {
        const uniqueMaskVars = new Set<string>();
        for (const mask of masks) {
            if (mask.variable && mask.variable !== variable) {
                uniqueMaskVars.add(mask.variable);
            }
        }

        uniqueMaskVars.forEach((maskVar) => {
            const cachedVarData = maskVariableData.get(maskVar);
            if (!cachedVarData) return;
            try {
                const varArrayData = dataToArray(cachedVarData);
                if (varArrayData && varArrayData.length === expectedLen) {
                    maskVariableArrays.set(maskVar, varArrayData);
                }
            } catch (err) {
                console.warn(
                    `Failed to decode mask data for variable ${maskVar}:`,
                    err,
                );
            }
        });
    }

    // Render each data point with lat/lon projection
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = getDataValue(x, y, width, height, arrayData);
            if (value === null) continue;

            // Convert grid indices to lat/lon
            const [lon, lat] = gridToLatLon(x, y, lonStep, latStep);

            // Project to canvas coordinates using direct equirectangular mapping
            const [px, py] = projectLonLat(lon, lat);

            // Convert value if unit conversion is selected (for color mapping)
            let displayValue = value;
            if (variable && selectedUnit) {
                displayValue = convertValue(value, variable, selectedUnit, {
                    isDifference,
                });
            }

            // Apply all masks
            // In ensemble mode: intersection (AND) - pixel must pass ALL masks
            // In other modes: union (OR) - pixel passes if it passes ANY mask
            let passesMask = false;
            if (binaryMasks.length > 0) {
                if (isEnsembleMode && ensembleStatistics) {
                    // Ensemble mode: intersection logic - must pass ALL masks
                    passesMask = true;
                    for (const mask of binaryMasks) {
                        const lowerUnrestricted =
                            !mask.lowerEdited || mask.lowerBound === null;
                        const upperUnrestricted =
                            !mask.upperEdited || mask.upperBound === null;
                        
                        // Get the statistic value for this mask
                        const maskVar = mask.variable || variable;
                        const maskUnit = mask.unit || selectedUnit;
                        const maskStat = mask.statistic || "mean";
                        const statsForVar =
                            (maskVar
                                ? ensembleStatisticsByVariable?.get(maskVar)
                                : undefined) ??
                            (maskVar === variable ? ensembleStatistics : undefined);
                        const statArray = statsForVar?.get(maskStat);
                        if (!statArray) {
                            // Statistic not available, skip this mask
                            continue;
                        }
                        
                        // Get the statistic value at this pixel
                        const idx = (height - 1 - y) * width + x;
                        const statValue = statArray[idx];
                        if (!isFinite(statValue)) {
                            passesMask = false;
                            break;
                        }
                        
                        // Convert statistic value if unit conversion is needed
                        let statDisplayValue = statValue;
                        if (maskVar && maskUnit) {
                            const isStatDifference =
                                isDifferenceEnsembleStatistic(maskStat);
                            statDisplayValue = convertValue(
                                statValue,
                                maskVar,
                                maskUnit,
                                {
                                    // Each mask statistic must be interpreted independently:
                                    // mean is absolute, all others are differences.
                                    isDifference: isStatDifference,
                                },
                            );
                        }
                        
                        // Check bounds
                        if (!lowerUnrestricted && mask.lowerBound !== null) {
                            if (statDisplayValue < mask.lowerBound) {
                                passesMask = false;
                                break;
                            }
                        }
                        
                        if (!upperUnrestricted && mask.upperBound !== null) {
                            if (statDisplayValue > mask.upperBound) {
                                passesMask = false;
                                break;
                            }
                        }
                    }
                } else {
                    // Non-ensemble mode (Explore mode): 
                    // - Union (OR) within same variable
                    // - Intersection (AND) across different variables
                    // - Filter uses only mask.variable; display variable must NOT affect which
                    //   variables we filter on. Each mask's variable is fixed.
                    
                    // Group masks by variable (skip masks without explicit variable)
                    const masksByVariable = new Map<
                        string,
                        Array<{
                            lowerBound: number | null;
                            upperBound: number | null;
                            lowerEdited: boolean;
                            upperEdited: boolean;
                            statistic?: "mean" | "std" | "median" | "iqr" | "percentile" | "extremes";
                            variable?: string;
                            unit?: string;
                            kind?: "binary" | "probability";
                        }>
                    >();
                    for (const mask of binaryMasks) {
                        const maskVar = mask.variable;
                        if (!maskVar) continue; // Don't use display variable as fallback
                        if (!masksByVariable.has(maskVar)) {
                            masksByVariable.set(maskVar, []);
                        }
                        masksByVariable.get(maskVar)!.push(mask);
                    }
                    
                    // For each variable, check if pixel passes (union within variable)
                    // Then take intersection across variables
                    passesMask = true;
                    for (const [maskVar, varMasks] of masksByVariable) {
                        let passesThisVariable = false;
                        
                        // Get data for this variable
                        let varRawValue: number;
                        
                        if (maskVar === variable) {
                            // Use current data - get raw value before unit conversion
                            varRawValue = value; // 'value' is the raw value before unit conversion
                        } else if (maskVariableArrays.has(maskVar)) {
                            const varData = maskVariableArrays.get(maskVar)!;
                            const varIdx = (height - 1 - y) * width + x;
                            varRawValue = varData[varIdx];
                            if (!isFinite(varRawValue)) {
                                passesMask = false;
                                break;
                            }
                        } else {
                            // Variable data not available – fail pixel (don't widen filter)
                            passesMask = false;
                            break;
                        }
                        
                        // Check if pixel passes any mask for this variable (union)
                        for (const mask of varMasks) {
                            const lowerUnrestricted = !mask.lowerEdited;
                            const upperUnrestricted = !mask.upperEdited;
                            
                            // Convert raw value to the mask's specified unit
                            const maskUnit = mask.unit;
                            let varDisplayValue = varRawValue;
                            if (maskUnit) {
                                varDisplayValue = convertValue(varRawValue, maskVar, maskUnit);
                            }
                            
                            let passesThisMask = true;
                            
                            if (!lowerUnrestricted && mask.lowerBound !== null) {
                                if (varDisplayValue < mask.lowerBound) {
                                    passesThisMask = false;
                                }
                            }
                            
                            if (!upperUnrestricted && mask.upperBound !== null) {
                                if (varDisplayValue > mask.upperBound) {
                                    passesThisMask = false;
                                }
                            }
                            
                            // If this mask passes, the variable passes (union logic)
                            if (passesThisMask) {
                                passesThisVariable = true;
                                break;
                            }
                        }
                        
                        // If this variable doesn't pass, the pixel doesn't pass (intersection logic)
                        if (!passesThisVariable) {
                            passesMask = false;
                            break;
                        }
                    }
                }
            } else {
                // No masks means everything passes
                passesMask = true;
            }

            let probabilityValue = 1;
            if (
                useProbabilityRendering &&
                probabilityMasks.length > 0 &&
                isEnsembleMode
            ) {
                const idx = (height - 1 - y) * width + x;
                probabilityValue = 1;
                for (const mask of probabilityMasks) {
                    const maskVar = mask.variable || variable;
                    if (!maskVar) {
                        probabilityValue = NaN;
                        break;
                    }
                    const sampleArrays =
                        ensembleRawSamplesByVariable?.get(maskVar);
                    if (!sampleArrays || sampleArrays.length === 0) {
                        probabilityValue = NaN;
                        break;
                    }
                    const maskUnit = mask.unit || selectedUnit;
                    const p = computeGaussianRangeProbabilityAtIndex(
                        sampleArrays,
                        idx,
                        maskVar,
                        maskUnit,
                        mask.lowerBound,
                        mask.upperBound,
                        mask.lowerEdited,
                        mask.upperEdited,
                    );
                    if (!Number.isFinite(p)) {
                        probabilityValue = NaN;
                        break;
                    }
                    probabilityValue *= p;
                }
                if (!Number.isFinite(probabilityValue)) {
                    probabilityValue = 0;
                } else {
                    probabilityValue = Math.max(0, Math.min(1, probabilityValue));
                }
            }

            let r: number, g: number, b: number;
            
            if (!passesMask && binaryMasks.length > 0) {
                // Render masked pixels in dark gray (slightly lighter than background)
                // Background is #070b13 (rgb(7, 11, 19)), use a slightly lighter gray
                r = 20;
                g = 24;
                b = 32;
            } else {
                // Guard against zero/NaN range and non-finite displayValue to avoid crash when switching variables
                const range = effectiveColorMax - effectiveColorMin;
                const colorValue = useProbabilityRendering
                    ? probabilityValue
                    : displayValue;
                let normalized: number;
                if (
                    !Number.isFinite(range) ||
                    range <= 0 ||
                    !Number.isFinite(colorValue)
                ) {
                    normalized = 0.5;
                } else {
                    normalized = Math.min(
                        1,
                        Math.max(0, (colorValue - effectiveColorMin) / range),
                    );
                    if (!Number.isFinite(normalized)) normalized = 0.5;
                }

                const lastIdx = Math.max(0, paletteRgb.length - 1);
                const colorIdx = Math.min(
                    Math.max(0, Math.floor(normalized * lastIdx)),
                    lastIdx,
                );
                const c1 = paletteRgb[colorIdx]!;
                const c2 = paletteRgb[Math.min(colorIdx + 1, lastIdx)] ?? c1;
                const t = Math.max(0, Math.min(1, normalized * lastIdx - colorIdx));

                r = Math.round(c1.r + (c2.r - c1.r) * t);
                g = Math.round(c1.g + (c2.g - c1.g) * t);
                b = Math.round(c1.b + (c2.b - c1.b) * t);
            }

            // Fill pixels directly in buffer for better performance
            const startX = Math.max(0, Math.floor(px - halfCell));
            const endX = Math.min(viewWidth, Math.ceil(px + halfCell));
            const startY = Math.max(0, Math.floor(py - halfCell));
            const endY = Math.min(viewHeight, Math.ceil(py + halfCell));

            for (let iy = startY; iy < endY; iy++) {
                for (let ix = startX; ix < endX; ix++) {
                    const pixelIdx = (iy * viewWidth + ix) * 4;
                    pixels[pixelIdx] = r;
                    pixels[pixelIdx + 1] = g;
                    pixels[pixelIdx + 2] = b;
                    pixels[pixelIdx + 3] = 255;
                    // Store original value for hover lookup (will be converted in tooltip)
                    valueLookup[iy][ix] = useProbabilityRendering
                        ? probabilityValue * 100
                        : value;
                }
            }
        }
    }

    offscreenCtx.putImageData(imageData, 0, 0);
    cachedMapCanvas = offscreen;
    cachedValueLookup = valueLookup;
    // Trigger redraw once the border dataset is loaded.
    setBaseMapOverlayInvalidationCallback(() => {
        redrawCachedMap(mapCanvas);
    });
    redrawCachedMap(mapCanvas);
}

export function zoomToLocation(
    canvas: HTMLCanvasElement,
    lon: number,
    lat: number,
    zoomLevel = 3.2,
    durationMs = 550,
): void {
    if (!cachedMapCanvas || !zoomBehavior) return;
    const rect = canvas.getBoundingClientRect();
    const mapWidth = cachedMapCanvas.width;
    const mapHeight = cachedMapCanvas.height;

    let normalizedLon = lon;
    while (normalizedLon > 180) normalizedLon -= 360;
    while (normalizedLon < -180) normalizedLon += 360;

    const projectedX = ((normalizedLon + 180) / 360) * mapWidth;
    const projectedY = ((90 - lat) / 150) * mapHeight;

    const candidates = [
        projectedX - mapWidth,
        projectedX,
        projectedX + mapWidth,
    ];

    let bestTargetX = rect.width / 2 - projectedX * zoomLevel;
    let bestDistance = Math.abs(bestTargetX - currentTransform.x);

    for (const candidateX of candidates) {
        const targetX = rect.width / 2 - candidateX * zoomLevel;
        const distance = Math.abs(targetX - currentTransform.x);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestTargetX = targetX;
        }
    }

    const targetY = rect.height / 2 - projectedY * zoomLevel;
    const nextTransform = d3.zoomIdentity
        .translate(bestTargetX, targetY)
        .scale(zoomLevel);

    d3.select(canvas)
        .transition()
        .duration(durationMs)
        .ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, nextTransform);
    currentTransform = nextTransform;
    transformCallback?.();
}

function updateTooltip(
    clientX: number,
    clientY: number,
    mouseX: number,
    mouseY: number,
    unit: string,
    _variable?: string,
    _selectedUnit?: string,
    isDifference?: boolean,
): void {
    if (!cachedValueLookup || !cachedMapCanvas) return;

    // Apply inverse D3 zoom transform to get world coordinates
    let worldX = (mouseX - currentTransform.x) / currentTransform.k;
    const worldY = (mouseY - currentTransform.y) / currentTransform.k;

    // Normalize worldX to be within the map width (for repeating tiles)
    const mapWidth = cachedMapCanvas.width;
    const mapHeight = cachedMapCanvas.height;
    worldX = ((worldX % mapWidth) + mapWidth) % mapWidth;

    // Direct pixel lookup
    const px = Math.floor(worldX);
    const py = Math.floor(worldY);

    if (px >= 0 && px < mapWidth && py >= 0 && py < mapHeight) {
        const rawValue = cachedValueLookup?.[py]?.[px] ?? 0;

        if (isFinite(rawValue)) {
            // Calculate lat/lon for display
            const lon = (worldX / mapWidth) * 360 - 180;
            const lat = 90 - (worldY / mapHeight) * 150;

            // Let tooltip handle conversion based on selected unit
            showTooltip(
                clientX,
                clientY,
                lat,
                lon,
                rawValue,
                unit,
                isDifference,
            );
        } else {
            hideTooltip();
        }
    } else {
        hideTooltip();
    }
}
