import * as d3 from "d3";
import { hexToRgb } from "../Utils/colorUtils";
import { dataToArray, type ClimateData } from "../Utils/dataClient";
import { convertMinMax, convertValue } from "../Utils/unitConverter";
import { hideTooltip, setDataRange, showTooltip } from "./tooltip";

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

// Export function to reset map transform state
export function resetMapTransform(): void {
    currentTransform = d3.zoomIdentity;
    if (zoomBehavior && cachedMapCanvas) {
        d3.select(cachedMapCanvas).call(
            zoomBehavior.transform,
            d3.zoomIdentity
        );
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
    latStep: number
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
    arrayData: Float32Array | Float64Array
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
    clientY: number
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

    // Calculate latitude (will be in [-90, 90] range)
    const lat = 90 - (worldY / mapHeight) * 180;

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
    drawCallbacks = enabled ? callbacks ?? null : null;
}

export function projectLonLatToCanvas(
    canvas: HTMLCanvasElement,
    lon: number,
    lat: number
): { x: number; y: number } | null {
    if (!cachedMapCanvas) return null;
    const mapWidth = cachedMapCanvas.width;
    const mapHeight = cachedMapCanvas.height;

    // Normalize longitude to [-180, 180] range first
    let normalizedLon = lon;
    while (normalizedLon > 180) normalizedLon -= 360;
    while (normalizedLon < -180) normalizedLon += 360;

    const projectedX = ((normalizedLon + 180) / 360) * mapWidth;
    const projectedY = ((90 - lat) / 180) * mapHeight;

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
        onTransform?: () => void;
    }
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
            if (currentData) {
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

    selection.on("click.draw", (e: MouseEvent) => {
        if (drawMode) {
            const coords = pointerToLonLat(canvas, e.clientX, e.clientY);
            if (coords) {
                drawCallbacks?.onClick?.(coords);
            }
        }
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
                cachedIsDifference
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
}

export function renderMapData(
    data: ClimateData,
    mapCanvas: HTMLCanvasElement | null,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    currentPalette: string,
    min: number,
    max: number,
    variable?: string,
    selectedUnit?: string
): void {
    if (!mapCanvas) return;

    const arrayData = dataToArray(data);
    if (!arrayData) {
        console.warn("No data to render");
        return;
    }

    console.log("Rendering map data (full render)");

    const setup = setupCanvas(mapCanvas);
    if (!setup) return;
    const { ctx, rect, viewWidth, viewHeight } = setup;
    const [height, width] = data.shape;

    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();

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

    // Set data range for tooltip/legend indicator
    setDataRange(min, max, variable, selectedUnit, isDifference);

    const palette =
        paletteOptions.find((p) => p.name === currentPalette) ||
        paletteOptions[0];
    const colors = palette.colors;

    // Pre-compute RGB values for palette
    const paletteRgb = colors.map(hexToRgb);

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

    console.log("Rendering map data");

    // Pre-calculate cell size
    const cellSize = Math.max(viewWidth / width, viewHeight / height) * 0.8;
    const halfCell = Math.ceil(cellSize / 2);

    const lonStep = 360 / width;
    // NEX-GDDP-CMIP6 dataset: latitude range is -60°S to 90°N (150° total, not 180°)
    const latStep = 150 / height;

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

            // Guard against zero data range (e.g., identical datasets) to avoid NaN
            const range = convertedMax - convertedMin;
            const normalized =
                range === 0
                    ? 0.5
                    : Math.min(
                          1,
                          Math.max(0, (displayValue - convertedMin) / range)
                      );

            const colorIdx = Math.floor(normalized * (paletteRgb.length - 1));
            const c1 = paletteRgb[Math.min(colorIdx, paletteRgb.length - 1)];
            const c2 =
                paletteRgb[Math.min(colorIdx + 1, paletteRgb.length - 1)];
            const t = normalized * (paletteRgb.length - 1) - colorIdx;

            const r = Math.round(c1.r + (c2.r - c1.r) * t);
            const g = Math.round(c1.g + (c2.g - c1.g) * t);
            const b = Math.round(c1.b + (c2.b - c1.b) * t);

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
                    valueLookup[iy][ix] = value;
                }
            }
        }
    }

    offscreenCtx.putImageData(imageData, 0, 0);
    cachedMapCanvas = offscreen;
    cachedValueLookup = valueLookup;

    // draw the cached map with current transform
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();

    // Apply D3 zoom transform
    ctx.translate(currentTransform.x, currentTransform.y);
    ctx.scale(currentTransform.k, currentTransform.k);

    // horizontal wrapping
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
}

function updateTooltip(
    clientX: number,
    clientY: number,
    mouseX: number,
    mouseY: number,
    unit: string,
    _variable?: string,
    _selectedUnit?: string,
    isDifference?: boolean
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
                isDifference
            );
        } else {
            hideTooltip();
        }
    } else {
        hideTooltip();
    }
}
