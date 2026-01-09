import type {
    ChartSeries,
    ChartRangePoint,
    ChartSample,
} from "../types/chartTypes";

/**
 * Simple toy generator to mock chart range data without API calls.
 * Produces smooth sin/cos-based stats across up to 50 dates.
 */
export function generateToyRangeSeries(options?: {
    scenarios?: string[];
    startDate?: string;
    endDate?: string;
    modelsPerScenario?: number;
}): ChartSeries[] {
    const scenarios = options?.scenarios ?? ["SSP245", "SSP370", "SSP585"];
    const start = new Date(options?.startDate ?? "2000-01-01");
    const end = new Date(options?.endDate ?? "2005-12-31");
    const modelsPerScenario = Math.max(1, options?.modelsPerScenario ?? 5);

    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(0, Math.floor((end.getTime() - start.getTime()) / dayMs));
    const steps = Math.min(50, totalDays + 1 || 1);
    const stepMs = totalDays > 0 ? (end.getTime() - start.getTime()) / Math.max(1, steps - 1) : 0;

    const buildDate = (idx: number) =>
        new Date(start.getTime() + stepMs * idx)
            .toISOString()
            .slice(0, 10);

    return scenarios.map((scenario, sIdx) => {
        const points: ChartRangePoint[] = [];

        for (let i = 0; i < steps; i++) {
            const date = buildDate(i);
            const phase = i / Math.max(1, steps - 1);
            // Scenario offset to visually separate them
            const base = sIdx * 1.5;
            const median = base + Math.sin(phase * Math.PI * 2) * 2;
            const mean = median + Math.cos(phase * Math.PI * 2) * 0.4;
            const spread = 1.2 + Math.cos(phase * Math.PI) * 0.6;
            const q1 = median - spread * 0.6;
            const q3 = median + spread * 0.6;
            const min = q1 - spread * 0.5;
            const max = q3 + spread * 0.5;

            const samples: Array<ChartSample & { value: number }> = [];
            for (let m = 0; m < modelsPerScenario; m++) {
                const jitter = (m / modelsPerScenario - 0.5) * 0.6;
                samples.push({
                    scenario,
                    model: `Model-${m + 1}`,
                    rawValue: 0, // not used in mocked chart
                    value: median + jitter,
                    dateUsed: date,
                });
            }

            points.push({
                date,
                samples,
                stats: {
                    min,
                    q1,
                    median,
                    q3,
                    max,
                    mean,
                    count: samples.length,
                },
            });
        }

        return { scenario, points };
    });
}

/**
 * Utility to convert a ChartSeries[] into ChartSample[] so you can assign
 * state.chartSamples for debugging.
 */
export function flattenSeriesToSamples(series: ChartSeries[]): ChartSample[] {
    const samples: ChartSample[] = [];
    series.forEach((s) => {
        s.points.forEach((p) => {
            p.samples.forEach((sample) => {
                samples.push({
                    scenario: s.scenario,
                    model: sample.model,
                    rawValue: sample.value,
                    dateUsed: p.date,
                });
            });
        });
    });
    return samples;
}
