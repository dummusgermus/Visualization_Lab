# Aggregated Data

```
aggregated_data.h5
├── metadata/
│   ├── version: "1.0"
│   ├── created_date: ISO timestamp
│   ├── models: ["ACCESS-CM2", "CanESM5", ...]
│   └── regions: ["global"]
└── global/
    ├── tas/
    │   ├── historical: (1846, 11)  # 1846 timesteps × 11 models
    │   ├── ssp245: (2887, 11)
    │   ├── ssp370: (2887, 11)
    │   └── ssp585: (2887, 11)
    ├── pr/
    │   ├── historical: ...
    │   └── ...
    └── [other variables...]
```

**Size:** ~50-100 MB (gzip-compressed), vs 1.7+ GB for full data

## Usage

### 1. Generate Aggregated Data (One-time Setup)

```bash
cd data_processing
python precompute_aggregates.py
```

Notes:

- Precomputation now writes per-model aggregates (timesteps x models).
- Each dataset stores `start_date` and `step_days` so date filtering aligns with sampling.

### 2. Query Data via API

Once `aggregated_data.h5` exists, the API automatically makes it available:

**Get global temperature for SSP5-8.5 scenario:**

```bash
curl "http://localhost:8000/aggregated-data?region=global&variable=tas&scenario=ssp585"
```

**Response:**

```json
{
  "region": "global",
  "variable": "tas",
  "scenario": "ssp585",
  "models": {
    "ACCESS-CM2": [289.2, 289.4, 289.6, ...],
    "CanESM5": [288.9, 289.1, 289.3, ...],
    ...
  },
  "status": "ok"
}
```

**With date range (filters to specific period):**

```bash
curl "http://localhost:8000/aggregated-data?region=global&variable=tas&scenario=ssp245&start_date=2050-01-01&end_date=2100-12-31"
```

### 3. Check Status

```bash
curl "http://localhost:8000/aggregated-status"
```

### 4. Validate With Real Data

```bash
python validate_aggregates.py
```

Tip: set `NEX_GDDP_AGG_VALIDATE_VARIABLE` if you used a quick-test subset.

## Frontend Example (TypeScript)

```ts
type AggregatedResponse = {
  region: string;
  variable: string;
  scenario: string;
  start_date?: string | null;
  end_date?: string | null;
  models: Record<string, number[]>;
  status: "ok";
};

async function fetchAggregatedSeries() {
  const params = new URLSearchParams({
    region: "global",
    variable: "tas",
    scenario: "ssp585",
    start_date: "2015-01-01",
    end_date: "2016-12-31",
  });

  const res = await fetch(`http://localhost:8000/aggregated-data?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as AggregatedResponse;

  const series = Object.entries(payload.models).map(([model, values]) => ({
    label: model,
    values,
  }));

  return series;
}
```
