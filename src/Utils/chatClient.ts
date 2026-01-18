/**
 * Client for interacting with the LLM chat API
 */

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
        chartMode?: string;
        dataStats?: {
            min?: number;
            max?: number;
            mean?: number;
            median?: number;
            stddev?: number;
        };
        selectedLocation?: {
            lat?: number;
            lon?: number;
            value?: number;
        };
        [key: string]: any;
    };
    history?: ChatMessage[];
}

export interface ChatResponse {
    message: string;
    success: boolean;
    error?: string;
}

/**
 * Send a chat message to the LLM API
 */
export async function sendChatMessage(
    request: ChatRequest
): Promise<ChatResponse> {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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
                `Chat API error (${response.status}): ${errorText}`
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
export function buildChatContext(state: {
    mode: string;
    canvasView: string;
    selectedVariable: string;
    selectedModel: string;
    selectedScenario: string;
    selectedDate: string;
    compareMode?: string;
    chartMode?: string;
    selectedScenario1?: string;
    selectedScenario2?: string;
    selectedModel1?: string;
    selectedModel2?: string;
    selectedDate1?: string;
    selectedDate2?: string;
    currentDataStats?: {
        min?: number;
        max?: number;
        mean?: number;
        median?: number;
        stddev?: number;
    };
    selectedLocation?: {
        lat?: number;
        lon?: number;
        value?: number;
    };
    [key: string]: any;
}): ChatRequest["context"] {
    const context: ChatRequest["context"] = {
        mode: state.mode,
        canvasView: state.canvasView,
        selectedVariable: state.selectedVariable,
        selectedModel: state.selectedModel,
        selectedScenario: state.selectedScenario,
        selectedDate: state.selectedDate,
    };

    // Add data statistics if available
    if (state.currentDataStats) {
        context.dataStats = {
            min: state.currentDataStats.min,
            max: state.currentDataStats.max,
            mean: state.currentDataStats.mean,
            median: state.currentDataStats.median,
            stddev: state.currentDataStats.stddev,
        };
    }

    // Add selected location if available
    if (state.selectedLocation) {
        context.selectedLocation = {
            lat: state.selectedLocation.lat,
            lon: state.selectedLocation.lon,
            value: state.selectedLocation.value,
        };
    }

    // Add compare mode specific context
    if (state.mode === "Compare" && state.compareMode) {
        context.compareMode = state.compareMode;

        if (state.compareMode === "Scenarios") {
            context.scenario1 = state.selectedScenario1;
            context.scenario2 = state.selectedScenario2;
        } else if (state.compareMode === "Models") {
            context.model1 = state.selectedModel1;
            context.model2 = state.selectedModel2;
        } else if (state.compareMode === "Dates") {
            context.date1 = state.selectedDate1;
            context.date2 = state.selectedDate2;
        }
    }

    // Add chart mode specific context
    if (state.canvasView === "chart" && state.chartMode) {
        context.chartMode = state.chartMode;
    }

    return context;
}
