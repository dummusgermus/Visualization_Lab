const API_BASE_URL =
    import.meta.env.VITE_DATA_API_URL || "http://localhost:8000";

export type Resolution = "low" | "medium" | "high";
export type DataFormat = "base64" | "list" | "none";

export interface DataRequest {
    variable: string;
    time: string;
    model: string;
    scenario?: string;
    resolution?: Resolution;
    data_format?: DataFormat;
}

export interface ClimateData {
    variable: string;
    model: string;
    scenario: string;
    time: string;
    timestamp: string;
    resolution: Resolution;
    shape: [number, number];
    dtype: string;
    size_bytes: number;
    quality: number;
    field: string;
    data?: string | number[][] | Float32Array | Float64Array | null;
    data_encoding?: "base64" | "list" | "none";
    metadata?: {
        variable?: Record<string, any>;
        scenario?: Record<string, any>;
        comparison?: {
            labelA: string;
            labelB: string;
        };
    };
}

type VariableMetadata = {
    name: string;
    unit: string;
    description: string;
};

export interface Metadata {
    variables: string[];
    models: string[];
    scenarios: string[];
    resolutions: string[];
    variable_metadata: Record<string, VariableMetadata>;
    scenario_metadata: Record<string, any>;
    time_range: {
        start: string;
        end: string;
        historical_end: string;
        projection_start: string;
    };
}

export class DataClientError extends Error {
    statusCode?: number;
    details?: any;

    constructor(message: string, statusCode?: number, details?: any) {
        super(message);
        this.name = "DataClientError";
        this.statusCode = statusCode;
        this.details = details;
    }
}

export function normalizeScenario(scenario: string): string {
    const mapping: Record<string, string> = {
        Historical: "historical",
        SSP245: "ssp245",
        SSP585: "ssp585",
    };
    return mapping[scenario] || scenario.toLowerCase();
}

function resolutionNumberToString(resolution: number): Resolution {
    if (resolution === 1) return "low";
    if (resolution === 2) return "medium";
    return "high";
}

function decodeBase64Data(
    base64: string,
    _shape: [number, number],
    dtype: string = "float32",
): Float32Array | Float64Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    if (dtype.includes("float32")) {
        return new Float32Array(bytes.buffer);
    } else if (dtype.includes("float64")) {
        return new Float64Array(bytes.buffer);
    }
    throw new Error(`Unsupported dtype: ${dtype}`);
}

function listToArray(list: number[][], _shape: [number, number]): Float32Array {
    const flat = list.flat();
    const arr = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i++) {
        arr[i] = flat[i];
    }
    return arr;
}

// In-memory cache: key → Promise<ClimateData>. Prevents duplicate in-flight
// requests for identical parameters and avoids re-fetching on re-renders.
const _tileCache = new Map<string, Promise<ClimateData>>();

/** Clear the in-memory climate tile cache (e.g. when the user changes the API URL). */
export function clearTileCache(): void {
    _tileCache.clear();
}

function _tileCacheKey(request: DataRequest, apiUrl: string): string {
    const scenario = request.scenario
        ? normalizeScenario(request.scenario)
        : "auto";
    const fmt = request.data_format ?? "base64";
    return `${apiUrl}|${request.variable}|${request.time}|${request.model}|${scenario}|${request.resolution ?? "medium"}|${fmt}`;
}

export async function fetchClimateData(
    request: DataRequest,
    options?: { apiUrl?: string },
): Promise<ClimateData> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/data`;
    const cacheKey = _tileCacheKey(request, apiUrl);

    const cached = _tileCache.get(cacheKey);
    if (cached) return cached;

    const pending = (async (): Promise<ClimateData> => {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...request,
                    scenario: request.scenario
                        ? normalizeScenario(request.scenario)
                        : undefined,
                    data_format: request.data_format || "base64",
                }),
            });

            if (!response.ok) {
                const error = await response
                    .json()
                    .catch(() => ({ detail: response.statusText }));
                throw new DataClientError(
                    error.detail ||
                        `HTTP ${response.status}: ${response.statusText}`,
                    response.status,
                    error,
                );
            }

            return await response.json();
        } catch (error) {
            // Evict failed entries so a retry can succeed
            _tileCache.delete(cacheKey);
            if (error instanceof DataClientError) throw error;
            throw new DataClientError(
                `Failed to fetch data: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                undefined,
                error,
            );
        }
    })();

    _tileCache.set(cacheKey, pending);
    return pending;
}

// Cached metadata promise – metadata is static for the lifetime of the page.
let _metadataCache: Promise<Metadata> | null = null;

/** Force the next fetchMetadata call to re-request from the server. */
export function invalidateMetadataCache(): void {
    _metadataCache = null;
}

export async function fetchMetadata(options?: {
    apiUrl?: string;
}): Promise<Metadata> {
    const apiUrl = options?.apiUrl || API_BASE_URL;

    if (_metadataCache) return _metadataCache;

    _metadataCache = (async (): Promise<Metadata> => {
        const url = `${apiUrl}/metadata`;
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });

            if (!response.ok) {
                throw new DataClientError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    response.status,
                );
            }

            return await response.json();
        } catch (error) {
            // Evict so a retry can succeed
            _metadataCache = null;
            if (error instanceof DataClientError) throw error;
            throw new DataClientError(
                `Failed to fetch metadata: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    })();

    return _metadataCache;
}

export function dataToArray(
    data: ClimateData,
): Float32Array | Float64Array | null {
    if (!data.data) return null;

    // Allow passing through precomputed typed arrays (used for client-side comparisons)
    if (
        data.data instanceof Float32Array ||
        data.data instanceof Float64Array
    ) {
        return data.data;
    }

    if (data.data_encoding === "none") return null;

    if (data.data_encoding === "base64" && typeof data.data === "string") {
        return decodeBase64Data(data.data, data.shape, data.dtype);
    }

    if (data.data_encoding === "list" && Array.isArray(data.data)) {
        return listToArray(data.data as number[][], data.shape);
    }

    return null;
}

export function createDataRequest(params: {
    variable: string;
    date: string;
    model: string;
    scenario: string;
    resolution: number;
    dataFormat?: DataFormat;
}): DataRequest {
    return {
        variable: params.variable,
        time: params.date,
        model: params.model,
        scenario: params.scenario,
        resolution: resolutionNumberToString(params.resolution),
        data_format: params.dataFormat || "base64",
    };
}

export interface PixelDataRequest {
    variable: string;
    model: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    start_date: string;
    end_date: string;
    scenario?: string;
    resolution?: Resolution;
    step_days?: number;
}

export interface PixelDataResponse {
    pixel: [number, number];
    window: [number, number, number, number];
    variable: string;
    model: string;
    scenario: string;
    unit: string;
    resolution: string;
    timestamps: string[];
    values: (number | null)[];
    valid_count: number;
    nan_count: number;
    status: string;
    metadata?: {
        variable?: Record<string, any>;
    };
}

export interface AggregateOnDemandRequest {
    variable: string;
    models: string[];
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    start_date: string;
    end_date: string;
    scenario?: string;
    resolution?: Resolution;
    step_days?: number;
    mask?: number[][];
}

export interface AggregateOnDemandResponse {
    window: [number, number, number, number];
    variable: string;
    scenario: string;
    resolution: string;
    step_days: number;
    mask_applied: boolean;
    models: Record<
        string,
        {
            timestamps: string[];
            values: (number | null)[];
            valid_count: number;
            nan_count: number;
        }
    >;
    status: string;
}

export interface PixelDataBatchCombo {
    model: string;
    scenario?: string;
    start_date: string;
    end_date: string;
}

export interface PixelDataBatchRequest {
    variable: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    step_days?: number;
    resolution?: Resolution;
    combinations: PixelDataBatchCombo[];
}

export interface PixelDataBatchResult {
    model: string;
    scenario: string | null;
    timestamps: string[];
    values: (number | null)[];
    valid_count: number;
    nan_count: number;
}

export interface PixelDataBatchResponse {
    variable: string;
    unit: string;
    pixel: [number, number];
    window: [number, number, number, number];
    results: PixelDataBatchResult[];
}

export async function fetchPixelDataBatch(
    request: PixelDataBatchRequest,
    options?: { apiUrl?: string },
): Promise<PixelDataBatchResponse> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/pixel-data-batch`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                Pragma: "no-cache",
                Expires: "0",
            },
            body: JSON.stringify({
                ...request,
                resolution: request.resolution || "low",
                step_days: request.step_days || 1,
            }),
        });

        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ detail: response.statusText }));
            throw new DataClientError(
                error.detail ||
                    `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                error,
            );
        }

        return await response.json();
    } catch (error) {
        if (error instanceof DataClientError) {
            throw error;
        }
        throw new DataClientError(
            `Failed to fetch pixel batch data: ${
                error instanceof Error ? error.message : String(error)
            }`,
            undefined,
            error,
        );
    }
}

export async function fetchPixelData(
    request: PixelDataRequest,
    options?: { apiUrl?: string },
): Promise<PixelDataResponse> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/pixel-data`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
            body: JSON.stringify({
                ...request,
                scenario: request.scenario
                    ? normalizeScenario(request.scenario)
                    : undefined,
                resolution: request.resolution || "medium",
                step_days: request.step_days || 1,
            }),
        });

        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ detail: response.statusText }));
            throw new DataClientError(
                error.detail ||
                    `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                error,
            );
        }

        return await response.json();
    } catch (error) {
        if (error instanceof DataClientError) {
            throw error;
        }
        throw new DataClientError(
            `Failed to fetch pixel data: ${
                error instanceof Error ? error.message : String(error)
            }`,
            undefined,
            error,
        );
    }
}

export async function fetchAggregateOnDemand(
    request: AggregateOnDemandRequest,
    options?: { apiUrl?: string },
): Promise<AggregateOnDemandResponse> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/aggregate-on-demand`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
            body: JSON.stringify({
                ...request,
                scenario: request.scenario
                    ? normalizeScenario(request.scenario)
                    : undefined,
                resolution: request.resolution || "medium",
                step_days: request.step_days || 1,
            }),
        });

        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ detail: response.statusText }));
            throw new DataClientError(
                error.detail ||
                    `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                error,
            );
        }

        return await response.json();
    } catch (error) {
        if (error instanceof DataClientError) {
            throw error;
        }
        throw new DataClientError(
            `Failed to fetch aggregate data: ${
                error instanceof Error ? error.message : String(error)
            }`,
            undefined,
            error,
        );
    }
}

// ─── SSE pixel-data stream ────────────────────────────────────────────────────

/**
 * A single Server-Sent Event emitted by /pixel-data-stream.
 * `status === "done"` signals the end of the stream.
 */
export interface PixelDataStreamEvent {
    combo_idx: number;
    model: string;
    scenario: string | null;
    timestamps: string[];
    values: (number | null)[];
    valid_count: number;
    nan_count: number;
    status: "ok" | "error" | "done" | "timeout";
    error?: string;
}

/**
 * Opens a POST /pixel-data-stream SSE connection.  The server fans out all
 * combinations to a thread pool and emits one SSE event per combo as it
 * completes.  `onEvent` is called for each event; the promise resolves when
 * the "done" sentinel is received or the stream closes.
 */
export async function fetchPixelDataStream(
    request: PixelDataBatchRequest,
    onEvent: (event: PixelDataStreamEvent) => void,
    options?: { apiUrl?: string },
): Promise<void> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/pixel-data-stream`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...request,
            resolution: request.resolution || "low",
            step_days: request.step_days || 1,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new DataClientError(
            `Pixel data stream failed: HTTP ${response.status} — ${errText}`,
            response.status,
        );
    }
    if (!response.body) {
        throw new DataClientError("Pixel data stream: no response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                    const event = JSON.parse(line.slice(6)) as PixelDataStreamEvent;
                    onEvent(event);
                    if (event.status === "done" || event.status === "timeout") return;
                } catch {
                    // skip malformed event line
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export async function checkApiHealth(options?: {
    apiUrl?: string;
}): Promise<boolean> {
    const apiUrl = options?.apiUrl || API_BASE_URL;
    const url = `${apiUrl}/health`;

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch {
        return false;
    }
}
