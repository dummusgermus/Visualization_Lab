const API_BASE_URL = import.meta.env.VITE_DATA_API_URL || "http://localhost:8000";

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
  data?: string | number[][] | null;
  data_encoding?: "base64" | "list" | "none";
  metadata?: {
    variable?: Record<string, any>;
    scenario?: Record<string, any>;
  };
}

export interface Metadata {
  variables: string[];
  models: string[];
  scenarios: string[];
  resolutions: string[];
  variable_metadata: Record<string, any>;
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

  constructor(
    message: string,
    statusCode?: number,
    details?: any
  ) {
    super(message);
    this.name = "DataClientError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalizeScenario(scenario: string): string {
  const mapping: Record<string, string> = {
    "Historical": "historical",
    "SSP245": "ssp245",
    "SSP585": "ssp585",
  };
  return mapping[scenario] || scenario.toLowerCase();
}

function resolutionNumberToString(resolution: number): Resolution {
  if (resolution <= 16) return "low";
  if (resolution <= 19) return "medium";
  return "high";
}

function decodeBase64Data(
  base64: string,
  _shape: [number, number],
  dtype: string = "float32"
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

function listToArray(
  list: number[][],
  _shape: [number, number]
): Float32Array {
  const flat = list.flat();
  const arr = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i++) {
    arr[i] = flat[i];
  }
  return arr;
}

export async function fetchClimateData(
  request: DataRequest,
  options?: { apiUrl?: string }
): Promise<ClimateData> {
  const apiUrl = options?.apiUrl || API_BASE_URL;
  const url = `${apiUrl}/data`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        scenario: request.scenario ? normalizeScenario(request.scenario) : undefined,
        data_format: request.data_format || "base64",
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new DataClientError(
        error.detail || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        error
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DataClientError) {
      throw error;
    }
    throw new DataClientError(
      `Failed to fetch data: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error
    );
  }
}

export async function fetchMetadata(
  options?: { apiUrl?: string }
): Promise<Metadata> {
  const apiUrl = options?.apiUrl || API_BASE_URL;
  const url = `${apiUrl}/metadata`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new DataClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DataClientError) {
      throw error;
    }
    throw new DataClientError(
      `Failed to fetch metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function dataToArray(data: ClimateData): Float32Array | Float64Array | null {
  if (!data.data || data.data_encoding === "none") {
    return null;
  }

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

export async function checkApiHealth(
  options?: { apiUrl?: string }
): Promise<boolean> {
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
