export type ChartSample = {
    scenario: string;
    model: string;
    rawValue: number;
    dateUsed: string;
};

export type ChartStats = {
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    mean: number;
    count: number;
};

export type ChartBox = {
    scenario: string;
    dateUsed: string;
    samples: Array<ChartSample & { value: number }>;
    stats: ChartStats;
};

export type ChartRangePoint = {
    date: string;
    samples: Array<ChartSample & { value: number }>;
    stats: ChartStats;
};

export type ChartSeries = {
    scenario: string;
    points: ChartRangePoint[];
};
