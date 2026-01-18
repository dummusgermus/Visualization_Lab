# Data Preprocessing Overview

## Goals
Provide fast, cache-friendly access to NEX-GDDP-CMIP6 data and pre-aggregations so the frontend avoids downloading full global grids.

## Main Modules
  - `config.py`: Lists variables/models/scenarios/resolutions, grid specs, cache dirs, concurrency settings.
  - `utils.py`: Parameter validation, date<->timestep conversion, field name generation, scenario inference, cache init.
  - `data_loader.py`: Reads via OpenVisus; supports single/batch/multi-variable/time-series/windowed reads with memory+disk cache.
  - `aggregated_data.py`: HDF5 read/write for aggregated data (region/variable/scenario/date range -> per-model series).
  - `precompute_aggregates.py`: Bulk precompute into `aggregated_data.h5`; now supports region masks, sampling step, and quick subset via env vars.
  - `api_server.py`: FastAPI service exposing health, metadata, raw data/batch/time-series, window reads, on-demand aggregation, and precomputed aggregation queries.
  - `regions/` (optional): store region masks as `.npy` (shape = `config.GRID_SHAPE`, values 1/0/NaN) for precompute.

## Key API Endpoints (frontend quick guide)
- `/metadata` (GET): Returns available variables/models/scenarios/resolutions, metadata, and time ranges. Call first to build dropdowns.

- `/data` (POST): Single grid read.
  - Example: `{ "variable":"tas", "time":"2000-01-01", "model":"ACCESS-CM2", "scenario":"historical", "resolution":"medium", "data_format":"base64" }`
  - `data_format`: `base64` (small, recommended), `list` (debug), `none` (no data returned, for timing).

- `/data/batch` (POST): Multiple requests in one call. Body: `{ "requests": [{...DataRequest...}, ...] }`, each with its own `data_format`.

- `/time-series` (POST): Time series for one variable/model (full grid per step).
  - Example: `{ "variable":"tas", "model":"ACCESS-CM2", "start_time":"2000-01-01", "end_time":"2000-02-01", "scenario":"historical", "step_days":5, "resolution":"medium", "data_format":"none" }`
  - `include_nan_stats=true` adds NaN statistics per step.

- `/pixel-data` (POST/GET): Windowed reads by logic_box, returns the center pixel value over time (avoids full-grid download).
  - Required: `x0,x1,y0,y1,variable,model,start_date,end_date`; Optional: `scenario,resolution,step_days`.
  - Example (GET): `/pixel-data?x0=100&x1=100&y0=200&y1=200&variable=tas&model=ACCESS-CM2&start_date=2000-01-01&end_date=2000-01-10&step_days=1`

- `/aggregate-on-demand` (POST): Windowed mean (optional mask), supports multiple models. Reads only the logic_box.
  - Example:
    ```json
    {
      "variable": "tas",
      "models": ["ACCESS-CM2", "CanESM5"],
      "scenario": "historical",
      "start_date": "2000-01-01",
      "end_date": "2000-01-10",
      "step_days": 1,
      "resolution": "medium",
      "x0": 100, "x1": 102, "y0": 200, "y1": 202,
      "mask": [[1,1,1],[1,1,1],[1,1,1]]
    }
    ```
  - Returns per-model `timestamps/values/valid_count/nan_count` plus window info and mask flag.

- Precomputed aggregation endpoints
  - `/aggregated-data` (GET): Read precomputed HDF5 region means. Example: `/aggregated-data?region=global&variable=tas&scenario=ssp585&start_date=2050-01-01&end_date=2100-12-31`
  - `/aggregated-regions` (GET): List available region names.
  - `/aggregated-status` (GET): Precompute file version, created date, available models/regions; reports unavailable if missing.

## Precompute Notes
- Full run (default regions = `global` or env override): `cd data_processing && python precompute_aggregates.py`.
- Region masks & multi-region: precompute iterates over regions (global or mask-driven). Place `regions/<region>.npy` (shape `(600,1440)`, values 1/0/NaN), or list them in `regions/regions.yaml` (sample provided). Configure regions via `NEX_GDDP_REGIONS=global,eu,greenland`; override mask directory with `NEX_GDDP_REGION_DIR` (default `data_processing/regions`); override config file with `NEX_GDDP_REGIONS_CONFIG`. Sparse masks use their bounding box to minimize reads.
- Sampling cadence: `SAMPLE_EVERY_N_DAYS=30` means take one timestep every 30 days when precomputing; lowering it (e.g., 7 or 1) gives finer time resolution but increases runtime/IO.
- Quick subset/sampling (for fast test builds): set env vars before running, e.g. (PowerShell):
  ```powershell
  cd data_processing
  set NEX_GDDP_AGG_TEST=1
  set NEX_GDDP_AGG_TEST_RANGE_DAYS=60
  set NEX_GDDP_AGG_TEST_MODELS=2
  set NEX_GDDP_AGG_TEST_VARIABLES=2
  set NEX_GDDP_AGG_TEST_SCENARIOS=2
  python precompute_aggregates.py
  ```
  - `NEX_GDDP_AGG_TEST=1`: enable quick mode (otherwise full run)
  - `NEX_GDDP_AGG_TEST_RANGE_DAYS`: days span in quick mode (default 60)
  - `NEX_GDDP_AGG_TEST_MODELS`: number of models (default 2)
  - `NEX_GDDP_AGG_TEST_VARIABLES`: number of variables (default 2)
  - `NEX_GDDP_AGG_TEST_SCENARIOS`: number of scenarios (default 2)
  - Quick mode is for smoke/preview: it trims models/variables/scenarios and time span to cut runtime; for production curves, run without `NEX_GDDP_AGG_TEST`.

## Runtime & Config
- Cache: set `NEX_GDDP_CACHE_DIR` to persistent storage; `NEX_GDDP_DISABLE_DISK_CACHE=1` disables disk cache.
- Concurrency: `NEX_GDDP_MAX_WORKERS` caps high-level loader parallelism; `MEMORY_CACHE_MAXSIZE` sets in-memory LRU size.
- Precompute: run `python precompute_aggregates.py` (see quick-mode vars above).

## Usage Tips
- Common large regions (global/continents): precompute and read via `/aggregated-data` for sub-second responses.
- Small regions or ad-hoc masks: use `/aggregate-on-demand`; for single points use `/pixel-data`.
- Avoid full-grid downloads: always supply a logic_box or precomputed region instead of fetching whole globe.
