import * as d3 from "d3";
import { geoNaturalEarth1 } from "d3-geo";
import { hexToRgb } from "./colorUtils";
import { dataToArray, type ClimateData } from "./dataClient";

let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

export function setupMapInteractions(
    canvas: HTMLCanvasElement,
    currentData: ClimateData | null,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    palette: string
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

            const minZoom = 0.5;
            const maxZoom = 10.0;

            if (newZoom >= minZoom && newZoom <= maxZoom) {
                const worldX = (mouseX + mapPanX) / mapZoom;
                const worldY = (mouseY + mapPanY) / mapZoom;

                mapZoom = newZoom;
                mapPanX = worldX * mapZoom - mouseX;
                mapPanY = worldY * mapZoom - mouseY;

                if (currentData) {
                    renderMapData(
                        currentData,
                        canvas,
                        paletteOptions,
                        palette
                    );
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

            renderMapData(currentData, canvas, paletteOptions, palette);
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

export async function renderMapData(
    data: ClimateData,
    mapCanvas: HTMLCanvasElement | null,
    paletteOptions: Array<{ name: string; colors: string[] }>,
    currentPalette: string
): Promise<void> {
    if (!mapCanvas) return;

    const arrayData = dataToArray(data);
    if (!arrayData) {
        console.warn("No data to render");
        return;
    }

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

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < arrayData.length; i++) {
        const val = arrayData[i];
        if (isFinite(val)) {
            min = Math.min(min, val);
            max = Math.max(max, val);
        }
    }

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

    ctx.translate(-mapPanX, -mapPanY);
    ctx.scale(mapZoom, mapZoom);

    // Draw the projected map (D3 projection already handles fitting to viewport)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0);

    // Draw world sphere outline for reference
    const spherePath = d3.geoPath(projection);
    const sphere = { type: "Sphere" as const };
    const pathStr = spherePath(sphere);

    if (pathStr) {
        const path2d = new Path2D(pathStr);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke(path2d);
    }

    ctx.restore();
}
