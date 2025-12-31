import * as d3 from "d3";
import { geoEquirectangular } from "d3-geo";
import { hexToRgb } from "../Utils/colorUtils";
import { dataToArray, type ClimateData } from "../Utils/dataClient";

let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

// Cache for pre-rendered map
let cachedMapCanvas: HTMLCanvasElement | null = null;

// Cache for hover functionality
let cachedData: ClimateData | null = null;
let cachedArrayData: Float32Array | Float64Array | null = null;
let cachedProjection: d3.GeoProjection | null = null;

// Tooltip element
let tooltipElement: HTMLDivElement | null = null;

function getOrCreateTooltip(): HTMLDivElement {
    if (!tooltipElement) {
        tooltipElement = document.createElement("div");
        tooltipElement.style.position = "fixed";
        tooltipElement.style.background = "rgba(9, 11, 16, 0.95)";
        tooltipElement.style.color = "white";
        tooltipElement.style.padding = "8px 12px";
        tooltipElement.style.borderRadius = "6px";
        tooltipElement.style.fontSize = "12px";
        tooltipElement.style.pointerEvents = "none";
        tooltipElement.style.zIndex = "1000";
        tooltipElement.style.border = "1px solid rgba(255, 255, 255, 0.12)";
        tooltipElement.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.4)";
        tooltipElement.style.display = "none";
        tooltipElement.style.whiteSpace = "nowrap";
        document.body.appendChild(tooltipElement);
    }
    return tooltipElement;
}

// Helper function to convert grid indices to lat/lon
function gridToLatLon(
    x: number,
    y: number,
    width: number,
    height: number
): [number, number] {
    const lonStep = 360 / width;
    const latStep = 180 / height;
    const lon = -180 + x * lonStep + lonStep / 2;
    const lat = 90 - y * latStep - latStep / 2;
    return [lon, lat];
}

// Helper function to convert lat/lon to grid indices
function latLonToGrid(
    lon: number,
    lat: number,
    width: number,
    height: number
): [number, number] {
    const lonStep = 360 / width;
    const latStep = 180 / height;
    const x = Math.floor((lon + 180) / lonStep);
    const y = Math.floor((90 - lat) / latStep);
    return [x, y];
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

export function setupMapInteractions(
    canvas: HTMLCanvasElement,
    currentData: ClimateData | null,
    unit: string
): void {
    canvas.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = mapZoom * zoomFactor;

            const minZoom = 0.8;
            const maxZoom = 10.0;

            if (newZoom >= minZoom && newZoom <= maxZoom) {
                const worldX = (mouseX + mapPanX) / mapZoom;
                const worldY = (mouseY + mapPanY) / mapZoom;

                mapZoom = newZoom;
                mapPanX = worldX * mapZoom - mouseX;
                mapPanY = worldY * mapZoom - mouseY;

                if (currentData) {
                    redrawCachedMap(canvas);
                }
            }
        },
        { passive: false }
    );

    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 0) {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartPanX = mapPanX;
            dragStartPanY = mapPanY;
            canvas.style.cursor = "grabbing";
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (isDragging && currentData) {
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;

            mapPanX = dragStartPanX - deltaX;
            mapPanY = dragStartPanY - deltaY;

            redrawCachedMap(canvas);

            // Hide tooltip while dragging
            const tooltip = getOrCreateTooltip();
            tooltip.style.display = "none";
        } else if (
            !isDragging &&
            cachedData &&
            cachedArrayData &&
            cachedProjection
        ) {
            // Show tooltip with hover value
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            updateTooltip(e.clientX, e.clientY, mouseX, mouseY, unit);
        }
    });

    canvas.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            canvas.style.cursor = "auto";
        }
    });

    canvas.addEventListener("mouseleave", () => {
        if (isDragging) {
            isDragging = false;
            canvas.style.cursor = "grab";
        }
        // Hide tooltip when leaving canvas
        const tooltip = getOrCreateTooltip();
        tooltip.style.display = "none";
    });

    canvas.style.cursor = "auto";
}

// Fast redraw function that just transforms the cached image
function redrawCachedMap(canvas: HTMLCanvasElement): void {
    if (!cachedMapCanvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();

    ctx.translate(-mapPanX, -mapPanY);
    ctx.scale(mapZoom, mapZoom);

    // Draw the cached pre-rendered map multiple times for horizontal wrapping
    ctx.imageSmoothingEnabled = true;
    const mapWidth = cachedMapCanvas.width;

    // Calculate visible range in world coordinates
    const viewLeft = mapPanX / mapZoom;
    const viewRight = (mapPanX + rect.width) / mapZoom;

    // Calculate which tiles we need to cover the visible area
    const startTile = Math.floor(viewLeft / mapWidth) - 1;
    const endTile = Math.ceil(viewRight / mapWidth) + 1;

    for (let i = startTile; i <= endTile; i++) {
        // Add tiny overlap to prevent gaps between tiles
        ctx.drawImage(cachedMapCanvas, i * mapWidth - 0.5, 0);
    }

    ctx.restore();
}

export function renderMapData(
    data: ClimateData,
    mapCanvas: HTMLCanvasElement | null,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    currentPalette: string,
    min: number,
    max: number
): void {
    if (!mapCanvas) return;

    const arrayData = dataToArray(data);
    if (!arrayData) {
        console.warn("No data to render");
        return;
    }

    console.log("Rendering map data (full render)");

    const ctx = mapCanvas.getContext("2d");
    if (!ctx) return;

    const [height, width] = data.shape;
    const rect = mapCanvas.getBoundingClientRect();
    mapCanvas.width = rect.width * window.devicePixelRatio;
    mapCanvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();

    const viewWidth = rect.width;
    const viewHeight = rect.height;

    // Cache for hover functionality
    cachedData = data;
    cachedArrayData = arrayData;

    const palette =
        paletteOptions.find((p) => p.name === currentPalette) ||
        paletteOptions[0];
    const colors = palette.colors;

    // Pre-compute RGB values for palette
    const paletteRgb = colors.map(hexToRgb);

    // Setup D3 geographic projection for seamless horizontal wrapping
    // Use equirectangular with explicit scale to ensure full width coverage
    const projection = geoEquirectangular()
        .scale(viewWidth / (2 * Math.PI))
        .translate([viewWidth / 2, viewHeight / 2]);

    // Cache projection for hover functionality
    // Cache projection for hover functionality
    cachedProjection = projection;

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

    // Render each data point with lat/lon projection
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = getDataValue(x, y, width, height, arrayData);
            if (value === null) continue;

            // Convert grid indices to lat/lon
            const [lon, lat] = gridToLatLon(x, y, width, height);

            // Project to canvas coordinates
            const coords = projection([lon, lat]);
            if (!coords) continue;

            const [px, py] = coords;

            // Color based on value
            const normalized = (value - min) / (max - min);
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
                }
            }
        }
    }

    offscreenCtx.putImageData(imageData, 0, 0);
    cachedMapCanvas = offscreen;

    // draw the cached map with current transform
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();

    ctx.translate(-mapPanX, -mapPanY);
    ctx.scale(mapZoom, mapZoom);

    // horizontal wrapping
    ctx.imageSmoothingEnabled = true;
    const mapWidth = cachedMapCanvas.width;
    const viewLeft = mapPanX / mapZoom;
    const viewRight = (mapPanX + rect.width) / mapZoom;
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
    unit: string
): void {
    if (!cachedData || !cachedArrayData || !cachedProjection) return;

    const tooltip = getOrCreateTooltip();

    // Convert mouse position to world coordinates (accounting for zoom and pan)
    let worldX = (mouseX + mapPanX) / mapZoom;
    const worldY = (mouseY + mapPanY) / mapZoom;

    // Normalize worldX to be within the map width (for repeating tiles)
    if (cachedMapCanvas) {
        const mapWidth = cachedMapCanvas.width;
        // Use modulo to wrap worldX to the original map coordinates
        worldX = ((worldX % mapWidth) + mapWidth) % mapWidth;
    }

    // Use the inverse projection to get lat/lon
    const coords = cachedProjection.invert?.([worldX, worldY]);
    if (!coords) {
        tooltip.style.display = "none";
        return;
    }

    const [lon, lat] = coords;

    // Verify the point is actually on the visible map by projecting it back
    const projected = cachedProjection([lon, lat]);
    if (!projected) {
        tooltip.style.display = "none";
        return;
    }

    // Check if the projected point is reasonably close to our normalized mouse position
    const [projX, projY] = projected;
    const distance = Math.sqrt(
        Math.pow(projX - worldX, 2) + Math.pow(projY - worldY, 2)
    );
    if (distance > 5) {
        tooltip.style.display = "none";
        return;
    }

    // Convert lat/lon to grid indices
    const [height, width] = cachedData.shape;
    const [x, y] = latLonToGrid(lon, lat, width, height);

    // Get the value from the data array
    const value = getDataValue(x, y, width, height, cachedArrayData);

    if (value !== null) {
        tooltip.textContent = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(
            2
        )}, Value: ${value.toFixed(2)} ${unit}`;
        tooltip.style.display = "block";
        tooltip.style.left = `${clientX + 10}px`;
        tooltip.style.top = `${clientY + 10}px`;
    } else {
        tooltip.style.display = "none";
    }
}
