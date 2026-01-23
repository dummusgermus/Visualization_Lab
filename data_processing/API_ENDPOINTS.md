# API reference

## Health & metadata

- `GET /health`
  - Request: none.
  - Response: `{ "status": "ok" }` (liveness).
- `GET /metadata`
  - Request: none.
  - Response: lists of variables/models/scenarios/resolutions, variable/scenario metadata, and time ranges (historical/projection).
  - Example:

  ```json
  {
    "variables": ["tas", "pr", "..."],
    "models": ["ACCESS-CM2", "CanESM5"],
    "scenarios": ["historical", "ssp245", "ssp370", "ssp585"],
    "resolutions": ["low", "medium", "high"],
    "time_range": {"start": "1950-01-01", "end": "2100-12-31"}
  }
  ```

## Raw data reads

- `POST /data`

  - Request: `variable`, `time` (YYYY-MM-DD), `model`, optional `scenario` (auto-inferred if omitted), `resolution` (`low|medium|high`), `data_format` (`base64|list|none`).
  - Response: raster payload (encoded per `data_format`), shape, dtype, field name, variable/scenario metadata.
  - Purpose: fetch a single raster.
  - Example request:

  ```json
  {
    "variable": "tas",
    "time": "2000-01-01",
    "model": "ACCESS-CM2",
    "scenario": "historical",
    "resolution": "medium",
    "data_format": "base64"
  }
  ```

  - Example response (trimmed):

  ```json
  {
    "variable": "tas",
    "model": "ACCESS-CM2",
    "scenario": "historical",
    "time": "2000-01-01",
    "shape": [300, 720],
    "dtype": "float32",
    "data_encoding": "base64",
    "data": "AAAA...",
    "metadata": {"variable": {"unit": "K"}}
  }
  ```
- `POST /data/batch`

  - Request: `requests: DataRequest[]`, each same as `/data`.
  - Response: array of results or error objects matching request order.
  - Purpose: bundle multiple `/data` calls.
  - Example request:

  ```json
  {
    "requests": [
      {"variable": "tas", "time": "2000-01-01", "model": "ACCESS-CM2", "scenario": "historical"},
      {"variable": "pr", "time": "2000-01-02", "model": "ACCESS-CM2", "scenario": "historical"}
    ]
  }
  ```
- `POST /time-series`

  - Request: `variable`, `model`, `start_time`, `end_time`, optional `scenario`, `resolution`, `step_days`, `include_nan_stats`, `data_format` (`none|base64|list`).
  - Response: array over time; each element has raster data (or metadata only if `data_format=none`), timestamp, shape, dtype, optional NaN stats.
  - Purpose: same variable/model across a date range.
  - Example request:

  ```json
  {
    "variable": "tas",
    "model": "ACCESS-CM2",
    "start_time": "2000-01-01",
    "end_time": "2000-01-05",
    "scenario": "historical",
    "step_days": 2,
    "data_format": "none"
  }
  ```

## Window / pixel reads

- `POST /pixel-data`

  - Request: window bounds `x0,x1,y0,y1` (logic coords, inclusive), `variable`, `model`, `start_date`, `end_date`, optional `scenario`, `resolution`, `step_days`.
  - Response: timestamps, window info, center-pixel value series, valid/NaN counts, variable metadata.
  - Purpose: lightweight probe without full raster download.
  - Example request:

  ```json
  {
    "variable": "tas",
    "model": "ACCESS-CM2",
    "x0": 100, "x1": 100, "y0": 200, "y1": 200,
    "start_date": "2000-01-01",
    "end_date": "2000-01-03",
    "scenario": "historical",
    "resolution": "medium"
  }
  ```
- `GET /pixel-data`

  - Request: same as above via query params.
  - Response/purpose: same as POST.

## Window aggregation (chart range friendly)

- `POST /aggregate-on-demand`
  - Request: `variable`, `models` (array), window `x0,x1,y0,y1`, `start_date`, `end_date`, optional `scenario`, `resolution`, `step_days`, `mask` (2D array matching window).
  - Response: per-model `timestamps`, window mean `values`, valid/NaN counts, plus window/scenario/resolution/step metadata.
  - Purpose: aggregate only the window over time (no global download), ideal for chart range mode.
  - Example request:

  ```json
  {
    "variable": "tas",
    "models": ["ACCESS-CM2", "CanESM5"],
    "scenario": "ssp585",
    "start_date": "2050-01-01",
    "end_date": "2050-01-10",
    "step_days": 2,
    "resolution": "low",
    "x0": 100, "x1": 110, "y0": 200, "y1": 210
  }
  ```

## Precomputed aggregation (HDF5)

- `GET /aggregated-data`

  - Request: `region` (e.g., global), `variable`, `scenario`, optional `start_date`, `end_date`.
  - Response: precomputed time series for the region/variable/scenario, grouped by model.
  - Purpose: millisecond reads of pre-aggregated results; requires `aggregated_data.h5`.
  - Example URL: `/aggregated-data?region=global&variable=tas&scenario=ssp585&start_date=2050-01-01&end_date=2100-12-31`
- `GET /aggregated-regions`

  - Request: none.
  - Response: list of regions available in precompute.
  - Purpose: populate region dropdowns.
- `GET /aggregated-status`

  - Request: none.
  - Response: availability flag, version, created date, regions, models.
  - Purpose: check precompute availability and metadata.

## Chat / LLM

- `POST /chat`
  - Request: `message`, optional `context` (frontend state), `history` (message array).
  - Response: `message` (LLM reply), optional `new_state` (mapped state updates), `success/error`.
  - Purpose: chat/explanation, or driving frontend state via tool-calls (state keys mapped backend-side).
