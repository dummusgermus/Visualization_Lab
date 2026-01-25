/**
 * Client for interacting with the LLM chat API
 */

import type { AppState, ChartLocation, EnsembleStatistic } from "../main";

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ChatRequest {
    message: string;
    context?: {
        mode?: string;
        canvasView?: string;
        selectedVariable?: string;
        selectedModel?: string;
        selectedScenario?: string;
        selectedDate?: string;
        compareMode?: string;
        ensembleScenarios?: string[];
        ensembleModels?: string[];
        ensembleStatistic?: EnsembleStatistic;
        ensembleDate?: string;
        ensembleVariable?: string;
        ensembleUnit?: string;
        ensembleStatistics?: Map<EnsembleStatistic, Float32Array> | null;
        chartState?: {
            mode?: string;
            scenarios?: string[];
            models?: string[];
            date?: string;
            rangeStart?: string;
            rangeEnd?: string;
            unit?: string;
            variable?: string;
            samples?: number;
            location?: ChartLocation;
            locationName?: string;
        };
        dataStats?: {
            min: number | null;
            max: number | null;
            mean: number | null;
            median?: number;
            stddev?: number;
        };
        selectedLocation?: {
            lat?: number;
            lon?: number;
        };
        masks?: {
            variable?: string;
            unit?: string;
            lowerBound?: number | null;
            upperBound?: number | null;
        }[];
        [key: string]: any;
    };
    history?: ChatMessage[];
}

export interface ChatResponse {
    message: string;
    success: boolean;
    new_state?: { [key: string]: any };
    error?: string;
}

/**
 * Send a chat message to the LLM API
 */
export async function sendChatMessage(
    request: ChatRequest,
): Promise<ChatResponse> {
    const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

    try {
        const response = await fetch(`${apiBaseUrl}/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Chat API error (${response.status}): ${errorText}`,
            );
        }

        const data: ChatResponse = await response.json();
        return data;
    } catch (error) {
        console.error("Chat API error:", error);
        return {
            message: `Fehler bei der Kommunikation mit dem Chat-Service: ${
                error instanceof Error ? error.message : "Unbekannter Fehler"
            }`,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Build context object from current application state
 */
export function buildChatContext(state: AppState): ChatRequest["context"] {
    const context: ChatRequest["context"] = {
        mode: state.mode,
        canvasView: state.canvasView,
        selectedVariable: state.variable,
        selectedModel: state.model,
        selectedScenario: state.scenario,
        selectedDate: state.date,
        selectedUnit: state.selectedUnit,
    };

    // Add data statistics if available
    if (
        state.dataMin !== null &&
        state.dataMax !== null &&
        state.dataMean !== null
    ) {
        context.dataStats = {
            min: state.dataMin,
            max: state.dataMax,
            mean: state.dataMean,
        };
    }

    // Add selected location if available
    if (state.chartPoint) {
        context.selectedLocation = {
            lat: state.chartPoint.lat,
            lon: state.chartPoint.lon,
        };
    }

    // Add compare mode specific context
    if (state.mode === "Compare" && state.compareMode) {
        context.compareMode = state.compareMode;

        if (state.compareMode === "Scenarios") {
            context.scenario1 = state.compareScenarioA;
            context.scenario2 = state.compareScenarioB;
        } else if (state.compareMode === "Models") {
            context.model1 = state.compareModelA;
            context.model2 = state.compareModelB;
        } else if (state.compareMode === "Dates") {
            context.date1 = state.compareDateStart;
            context.date2 = state.compareDateEnd;
        }
    }

    // Add chart mode specific context
    if (state.canvasView === "chart" && state.chartMode) {
        context.chartMode = state.chartMode;
        context.chartState = {
            mode: state.chartMode,
            scenarios: state.chartScenarios,
            models: state.chartModels,
            date: state.chartDate,
            rangeStart: state.chartRangeStart,
            rangeEnd: state.chartRangeEnd,
            unit: state.chartUnit,
            variable: state.chartVariable,
            samples: state.chartSamples.length,
            location: state.chartLocation,
            locationName: state.chartLocationName || undefined,
        };
    }
    if (state.mode === "Ensemble") {
        ((context.ensembleScenarios = state.ensembleScenarios),
            (context.ensembleModels = state.ensembleModels),
            (context.ensembleStatistic = state.ensembleStatistic),
            (context.ensembleDate = state.ensembleDate),
            (context.ensembleVariable = state.ensembleVariable),
            (context.ensembleUnit = state.ensembleUnit),
            (context.ensembleStatistics = state.ensembleStatistics));
    }
    if (state.masks && state.masks.length > 0) {
        context.masks = state.masks.map((mask) => ({
            variable: mask.variable,
            unit: mask.unit,
            statistic: mask.statistic,
            lowerBound: mask.lowerBound,
            upperBound: mask.upperBound,
        }));
    }

    return context;
}
