import * as d3 from "d3";
import { geoNaturalEarth1 } from "d3-geo";
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

export function setupMapInteractions(
    canvas: HTMLCanvasElement,
    currentData: ClimateData | null
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
        }
    });

    canvas.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            canvas.style.cursor = "grab";
        }
    });

    canvas.addEventListener("mouseleave", () => {
        if (isDragging) {
            isDragging = false;
            canvas.style.cursor = "grab";
        }
    });

    canvas.style.cursor = "grab";
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

    // Draw the cached pre-rendered map
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cachedMapCanvas, 0, 0);

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

    const palette =
        paletteOptions.find((p) => p.name === currentPalette) ||
        paletteOptions[0];
    const colors = palette.colors;

    // Pre-compute RGB values for palette
    const paletteRgb = colors.map(hexToRgb);

    // Setup D3 geographic projection (Natural Earth is good for climate data)
    const projection = geoNaturalEarth1()
        .fitSize([viewWidth, viewHeight], { type: "Sphere" })
        .translate([viewWidth / 2, viewHeight / 2]);

    // Calculate lat/lon step sizes
    const lonStep = 360 / width;
    const latStep = 180 / height;

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
            const flippedY = height - 1 - y;
            const idx = flippedY * width + x;
            const value = arrayData[idx];

            if (!isFinite(value)) continue;

            // Convert grid indices to lat/lon (this is based on regular lat/lon grid, which NEX-GDDP uses)
            const lon = -180 + x * lonStep + lonStep / 2;
            const lat = 90 - y * latStep - latStep / 2;

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

    // Fill screen at end
    offscreenCtx.putImageData(imageData, 0, 0);

    // Draw world sphere outline for reference
    const spherePath = d3.geoPath(projection);
    const sphere = { type: "Sphere" as const };
    const pathStr = spherePath(sphere);

    if (pathStr) {
        const path2d = new Path2D(pathStr);
        offscreenCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        offscreenCtx.lineWidth = 1.5;
        offscreenCtx.stroke(path2d);
    }

    // Cache this rendered map
    cachedMapCanvas = offscreen;

    // Now draw the cached map with current transform
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();

    ctx.translate(-mapPanX, -mapPanY);
    ctx.scale(mapZoom, mapZoom);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cachedMapCanvas, 0, 0);

    ctx.restore();
}
