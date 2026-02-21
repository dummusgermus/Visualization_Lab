import countries50mUrl from "world-atlas/countries-50m.json?url";
import countries110mUrl from "world-atlas/countries-110m.json?url";
import { feature } from "topojson-client";
import mapLabels from "../data/mapLabels.json";

type LonLat = [number, number];
type BorderLine = LonLat[];

type ZoomLabel = {
    name: string;
    lon: number;
    lat: number;
    minZoom: number;
    priority: number;
};
type RawZoomLabel = [string, number, number, number, number];

type BorderBundle = {
    low: BorderLine[];
    high: BorderLine[];
};

type Transform = {
    x: number;
    y: number;
    k: number;
};

const MIN_VISIBLE_LAT = -60;
const BORDER_HIGH_DETAIL_ZOOM = 3.8;
const LABEL_START_ZOOM = 1.2;
const LABEL_ZOOM_OFFSET = 0.6;
const LABELS: ZoomLabel[] = (mapLabels as RawZoomLabel[])
    .map(([name, lon, lat, minZoom, priority]) => ({
        name,
        lon,
        lat,
        minZoom,
        priority,
    }))
    .sort((a, b) => b.priority - a.priority);

let borderData: BorderBundle | null = null;
let borderDataPromise: Promise<BorderBundle> | null = null;
let invalidateMapRender: (() => void) | null = null;
let showBorders = true;
let showLabels = true;

function normalizeLon(lon: number): number {
    let normalized = lon;
    while (normalized < -180) normalized += 360;
    while (normalized >= 180) normalized -= 360;
    return normalized;
}

function projectToWorld(
    lon: number,
    lat: number,
    worldWidth: number,
    worldHeight: number,
): { x: number; y: number } | null {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lat < MIN_VISIBLE_LAT || lat > 90) return null;
    const x = ((normalizeLon(lon) + 180) / 360) * worldWidth;
    const y = ((90 - lat) / 150) * worldHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

function extractBorderLines(geoJson: any): BorderLine[] {
    if (!geoJson || geoJson.type !== "FeatureCollection") return [];
    const lines: BorderLine[] = [];
    for (const feat of geoJson.features as any[]) {
        const geometry = feat?.geometry;
        if (!geometry) continue;
        if (geometry.type === "Polygon") {
            for (const ring of geometry.coordinates as number[][][]) {
                lines.push(ring.map(([lon, lat]) => [lon, lat]));
            }
            continue;
        }
        if (geometry.type === "MultiPolygon") {
            for (const polygon of geometry.coordinates as number[][][][]) {
                for (const ring of polygon) {
                    lines.push(ring.map(([lon, lat]) => [lon, lat]));
                }
            }
        }
    }
    return lines;
}

async function loadBorderLines(url: string): Promise<BorderLine[]> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch border data (${response.status})`);
    }
    const topology = await response.json();
    const objectEntry = Object.entries(topology.objects || {}).find(([key]) =>
        key.toLowerCase().includes("countries"),
    );
    if (!objectEntry) return [];
    const topologyObject = objectEntry[1];
    const countries = feature(topology, topologyObject as any);
    return extractBorderLines(countries as any);
}

function ensureBorderDataLoaded() {
    if (borderData) return;
    if (borderDataPromise) return;
    borderDataPromise = Promise.all([
        loadBorderLines(countries110mUrl),
        loadBorderLines(countries50mUrl),
    ])
        .then(([low, high]) => {
            borderData = { low, high };
            invalidateMapRender?.();
            return borderData;
        })
        .catch((err) => {
            console.warn("Failed to load precomputed border overlay:", err);
            borderData = { low: [], high: [] };
            return borderData;
        });
}

function drawWrappedBorders(
    ctx: CanvasRenderingContext2D,
    lines: BorderLine[],
    worldWidth: number,
    worldHeight: number,
    viewportWidth: number,
    transform: Transform,
) {
    const k = transform.k;
    const tx = transform.x;
    const ty = transform.y;

    const viewLeftWorld = -tx / k;
    const viewRightWorld = (viewportWidth - tx) / k;
    const startTile = Math.floor(viewLeftWorld / worldWidth) - 1;
    const endTile = Math.ceil(viewRightWorld / worldWidth) + 1;

    ctx.beginPath();
    for (const line of lines) {
        if (!line.length) continue;
        for (let tile = startTile; tile <= endTile; tile += 1) {
            const tileOffset = tile * worldWidth;
            let hasOpenSegment = false;
            let prevXWorld: number | null = null;

            for (const [lon, lat] of line) {
                const projected = projectToWorld(lon, lat, worldWidth, worldHeight);
                if (!projected) {
                    hasOpenSegment = false;
                    prevXWorld = null;
                    continue;
                }
                const currentXWorld = projected.x + tileOffset;
                if (
                    prevXWorld !== null &&
                    Math.abs(currentXWorld - prevXWorld) > worldWidth * 0.5
                ) {
                    hasOpenSegment = false;
                }
                prevXWorld = currentXWorld;
                const sx = currentXWorld * k + tx;
                const sy = projected.y * k + ty;
                if (!hasOpenSegment) {
                    ctx.moveTo(sx, sy);
                    hasOpenSegment = true;
                } else {
                    ctx.lineTo(sx, sy);
                }
            }
        }
    }
    ctx.stroke();
}

function overlaps(
    a: { x1: number; y1: number; x2: number; y2: number },
    b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
    return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

function maxLabelsForZoom(zoom: number): number {
    if (zoom < 0.9) return 6;
    if (zoom < 1.1) return 10;
    if (zoom < 1.4) return 16;
    if (zoom < 1.7) return 24;
    if (zoom < 2.0) return 34;
    if (zoom < 2.4) return 46;
    if (zoom < 2.8) return 62;
    if (zoom < 3.2) return 80;
    if (zoom < 3.8) return 102;
    if (zoom < 4.6) return 128;
    return 160;
}

function drawLabels(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    worldWidth: number,
    worldHeight: number,
    transform: Transform,
) {
    if (!LABELS.length) return;
    const effectiveZoom = Math.max(0, transform.k - LABEL_ZOOM_OFFSET);

    const occupied: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const wrapScreenWidth = worldWidth * transform.k;
    const viewCenterX = viewportWidth * 0.5;
    const baseFontSize =
        transform.k >= 5.4 ? 13 : transform.k >= 4.2 ? 12 : 11;
    const dotRadius = transform.k >= 4.8 ? 2.3 : 2.0;
    const limit = maxLabelsForZoom(effectiveZoom);
    let rendered = 0;

    ctx.textBaseline = "middle";
    ctx.font = `600 ${baseFontSize}px Inter, Segoe UI, sans-serif`;
    ctx.lineJoin = "round";
    ctx.fillStyle = "rgba(236, 244, 255, 0.95)";
    ctx.strokeStyle = "rgba(5, 9, 16, 0.92)";
    ctx.lineWidth = 2.5;

    for (const label of LABELS) {
        if (rendered >= limit) break;
        if (effectiveZoom < label.minZoom) continue;
        const projected = projectToWorld(label.lon, label.lat, worldWidth, worldHeight);
        if (!projected) continue;

        const baseScreenX = projected.x * transform.k + transform.x;
        const n = Math.round((viewCenterX - baseScreenX) / wrapScreenWidth);
        const x = baseScreenX + n * wrapScreenWidth;
        const y = projected.y * transform.k + transform.y;
        const labelX = x + 7;
        const labelY = y - 7;

        if (x < -80 || x > viewportWidth + 80 || y < 6 || y > viewportHeight - 6) {
            continue;
        }

        const textWidth = ctx.measureText(label.name).width;
        const bounds = {
            x1: x - dotRadius - 2,
            y1: y - dotRadius - 2,
            x2: labelX + textWidth + 4,
            y2: labelY + baseFontSize * 0.6 + 2,
        };
        if (occupied.some((box) => overlaps(box, bounds))) {
            continue;
        }
        occupied.push(bounds);

        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 250, 255, 0.98)";
        ctx.fill();
        ctx.strokeStyle = "rgba(7, 11, 20, 0.9)";
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.fillStyle = "rgba(236, 244, 255, 0.95)";
        ctx.strokeStyle = "rgba(5, 9, 16, 0.92)";
        ctx.lineWidth = 2.5;
        ctx.strokeText(label.name, labelX, labelY);
        ctx.fillText(label.name, labelX, labelY);
        rendered += 1;
    }
}

export function setBaseMapOverlayInvalidationCallback(
    callback: (() => void) | null,
) {
    invalidateMapRender = callback;
}

export function setBaseMapOverlayVisibility(options: {
    showBorders?: boolean;
    showLabels?: boolean;
}) {
    if (typeof options.showBorders === "boolean") {
        showBorders = options.showBorders;
    }
    if (typeof options.showLabels === "boolean") {
        showLabels = options.showLabels;
    }
}

export function drawBaseMapOverlay(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    worldWidth: number,
    worldHeight: number,
    transform: Transform,
) {
    ensureBorderDataLoaded();
    if (!borderData) return;

    const borderLines =
        transform.k < BORDER_HIGH_DETAIL_ZOOM ? borderData.low : borderData.high;
    if (showBorders && borderLines.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.36)";
        ctx.lineWidth = transform.k < BORDER_HIGH_DETAIL_ZOOM ? 0.8 : 1.0;
        drawWrappedBorders(
            ctx,
            borderLines,
            worldWidth,
            worldHeight,
            viewportWidth,
            transform,
        );
        ctx.restore();
    }

    if (showLabels && transform.k >= LABEL_START_ZOOM) {
        ctx.save();
        drawLabels(
            ctx,
            viewportWidth,
            viewportHeight,
            worldWidth,
            worldHeight,
            transform,
        );
        ctx.restore();
    }
}
