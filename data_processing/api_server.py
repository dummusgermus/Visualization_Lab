from __future__ import annotations

import base64
import json
import os
import sys
from typing import List, Literal, Optional

import h5py
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure local modules are importable when running the file directly
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:  # pragma: no cover - import path juggling for script/package usage
    from . import data_loader  # type: ignore  # noqa: E402
    from . import config  # type: ignore  # noqa: E402
    from . import utils  # type: ignore  # noqa: E402
    from . import aggregated_data  # type: ignore  # noqa: E402
    from .data_loader import DataLoadingError  # type: ignore  # noqa: E402
    from .utils import ParameterValidationError  # type: ignore  # noqa: E402
    from .aggregated_data import AggregatedDataManager, AggregatedDataError  # type: ignore  # noqa: E402
except ImportError:  # pragma: no cover
    import data_loader  # type: ignore  # noqa: E402
    import config  # type: ignore  # noqa: E402
    import utils  # type: ignore  # noqa: E402
    import aggregated_data  # type: ignore  # noqa: E402
    from data_loader import DataLoadingError  # type: ignore  # noqa: E402
    from utils import ParameterValidationError  # type: ignore  # noqa: E402
    from aggregated_data import AggregatedDataManager, AggregatedDataError  # type: ignore  # noqa: E402


AllowedFormat = Literal["base64", "list", "none"]


class DataRequest(BaseModel):
    variable: str = Field(..., description="Climate variable name (e.g. 'tas')")
    time: str = Field(..., description="ISO date (YYYY-MM-DD)")
    model: str = Field(..., description="Climate model name")
    scenario: Optional[str] = Field(None, description="Emission scenario")
    resolution: str = Field(
        "medium",
        description="Spatial resolution level",
    )
    data_format: AllowedFormat = Field(
        "base64",
        description="How array payloads should be serialized",
    )


class BatchRequest(BaseModel):
    requests: List[DataRequest]


class TimeSeriesRequest(BaseModel):
    variable: str
    model: str
    start_time: str = Field(..., description="Start date (YYYY-MM-DD)")
    end_time: str = Field(..., description="End date (YYYY-MM-DD)")
    scenario: Optional[str] = None
    resolution: str = "medium"
    step_days: int = 1
    include_nan_stats: bool = False
    data_format: AllowedFormat = "none"


class PixelDataRequest(BaseModel):
    """Request for pixel/subregion climate data using logic_box bounds"""
    variable: str = Field(..., description="Climate variable name")
    model: str = Field(..., description="Climate model name")
    x0: int = Field(..., description="Left (inclusive) pixel x-index")
    x1: int = Field(..., description="Right (inclusive) pixel x-index")
    y0: int = Field(..., description="Top (inclusive) pixel y-index")
    y1: int = Field(..., description="Bottom (inclusive) pixel y-index")
    start_date: str = Field(..., description="Start date (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date (YYYY-MM-DD)")
    scenario: Optional[str] = None
    resolution: str = Field("medium", description="Spatial resolution level")
    step_days: int = Field(1, description="Time step in days")


class OnDemandAggregateRequest(BaseModel):
    variable: str
    models: List[str]
    scenario: Optional[str] = None
    start_date: str
    end_date: str
    step_days: int = 1
    resolution: str = "medium"
    x0: int
    x1: int
    y0: int
    y1: int
    mask: Optional[List[List[float]]] = Field(
        None,
        description="Optional 2D mask array matching the logic_box dimensions",
    )

def _allowed_origins() -> List[str]:
    """
    Parse allowed origins from env so that the Vite dev server can connect.

    Defaults to '*' for convenience unless NEX_GDDP_ALLOWED_ORIGINS is set to
    a comma-separated list.
    """
    raw = os.environ.get("NEX_GDDP_ALLOWED_ORIGINS", "*").strip()
    if raw == "*" or not raw:
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app = FastAPI(
    title="NEX-GDDP-CMIP6 Data Service",
    version="1.0.0",
    description="HTTP interface for the internal data preprocessing utilities",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _encode_array(array: np.ndarray, fmt: AllowedFormat):
    """Serialize numpy array payloads for JSON transport."""
    if fmt == "none":
        return None, "none"
    if fmt == "list":
        return array.tolist(), "list"

    contiguous = np.ascontiguousarray(array)
    encoded = base64.b64encode(contiguous.tobytes()).decode("ascii")
    return encoded, "base64"


def _format_result(result: dict, data_format: AllowedFormat) -> dict:
    """Attach JSON-serializable data to a loader response."""
    payload = {k: v for k, v in result.items() if k != "data"}
    arr = result.get("data")
    if arr is None:
        payload["data"] = None
        payload["data_encoding"] = "none"
        return payload

    serialized, encoding = _encode_array(arr, data_format)
    payload["data"] = serialized
    payload["data_encoding"] = encoding
    return payload


def _translate_error(exc: Exception) -> None:
    """Convert domain errors into HTTP exceptions."""
    if isinstance(exc, ParameterValidationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if isinstance(exc, DataLoadingError):
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


def _validate_logic_box(x0: int, x1: int, y0: int, y1: int):
    grid_h, grid_w = config.GRID_SHAPE
    if not (0 <= x0 <= x1 < grid_w):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid x-bounds [{x0}, {x1}] for grid width {grid_w}",
        )
    if not (0 <= y0 <= y1 < grid_h):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid y-bounds [{y0}, {y1}] for grid height {grid_h}",
        )
    return x0, x1, y0, y1


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.get("/metadata")
def metadata():
    return data_loader.get_available_metadata()


@app.post("/data")
def fetch_data(request: DataRequest):
    try:
        result = data_loader.load_data(
            variable=request.variable,
            time=request.time,
            model=request.model,
            scenario=request.scenario,
            resolution=request.resolution,
        )
        return _format_result(result, request.data_format)
    except Exception as exc:  # noqa: BLE001 - convert to HTTP errors
        _translate_error(exc)


@app.post("/data/batch")
def fetch_batch(request: BatchRequest):
    if not request.requests:
        raise HTTPException(status_code=422, detail="At least one request is required")

    raw_requests = [
        req.model_dump(exclude={"data_format"})
        for req in request.requests
    ]
    formats = [req.data_format for req in request.requests]

    try:
        results = data_loader.load_data_batch(raw_requests)
    except Exception as exc:  # noqa: BLE001
        _translate_error(exc)

    decorated = []
    for req_fmt, result in zip(formats, results):
        if isinstance(result, dict) and "error" in result:
            decorated.append(result)
            continue
        decorated.append(_format_result(result, req_fmt))
    return decorated


@app.post("/time-series")
def fetch_time_series(request: TimeSeriesRequest):
    try:
        series = data_loader.load_time_series(
            variable=request.variable,
            model=request.model,
            start_time=request.start_time,
            end_time=request.end_time,
            scenario=request.scenario,
            resolution=request.resolution,
            step_days=request.step_days,
            include_nan_stats=request.include_nan_stats,
        )
    except Exception as exc:  # noqa: BLE001
        _translate_error(exc)

    return [_format_result(entry, request.data_format) for entry in series]


@app.post("/pixel-data")
def fetch_pixel_data(request: PixelDataRequest):
    """
    Extract time series of climate data for a provided logic_box (pixel bounds).
    
    Args:
        x0, x1, y0, y1: Inclusive pixel bounds in dataset logic coordinates.
        variable/model/scenario/start_date/end_date: Same as other endpoints.
    
    Returns:
        {
            "pixel": [center_x, center_y],
            "window": [x0, x1, y0, y1],
            "variable": str,
            "model": str,
            "scenario": str,
            "unit": str,
            "timestamps": [ISO date strings],
            "values": [float or null],  # center pixel within the window
            "valid_count": int,
            "nan_count": int,
            "metadata": {...}
        }
    """
    try:
        x0, x1, y0, y1 = _validate_logic_box(
            request.x0, request.x1, request.y0, request.y1
        )
        center_x = (x0 + x1) // 2
        center_y = (y0 + y1) // 2

        series = data_loader.load_pixel_time_series(
            variable=request.variable,
            model=request.model,
            start_time=request.start_date,
            end_time=request.end_date,
            scenario=request.scenario,
            resolution=request.resolution,
            step_days=request.step_days,
            window_box=(x0, x1, y0, y1),
        )

        if not series:
            raise DataLoadingError("No data returned for specified time range")

        timestamps = [entry["time"] for entry in series if "time" in entry]
        values = []
        for entry in series:
            arr = entry.get("data")
            if arr is None:
                values.append(float("nan"))
                continue
            try:
                # arr shape is (window_height, window_width)
                local_x = min(arr.shape[1] - 1, center_x - x0)
                local_y = min(arr.shape[0] - 1, center_y - y0)
                values.append(float(arr[local_y, local_x]))
            except Exception:
                values.append(float("nan"))

        finite_values = [v for v in values if np.isfinite(v)]
        valid_count = len(finite_values)
        nan_count = len(values) - valid_count

        var_metadata = data_loader.get_available_metadata()
        var_info = var_metadata.get("variable_metadata", {}).get(request.variable, {})
        unit = var_info.get("unit", "")

        return {
            "pixel": [center_x, center_y],
            "window": [x0, x1, y0, y1],
            "variable": request.variable,
            "model": request.model,
            "scenario": request.scenario or "unknown",
            "unit": unit,
            "resolution": request.resolution,
            "timestamps": timestamps,
            "values": values,
            "valid_count": valid_count,
            "nan_count": nan_count,
            "status": "ok",
            "metadata": {
                "variable": var_info,
            },
        }

    except DataLoadingError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/pixel-data")
def fetch_pixel_data_get(
    x0: int,
    x1: int,
    y0: int,
    y1: int,
    variable: str,
    model: str,
    start_date: str,
    end_date: str,
    scenario: Optional[str] = None,
    resolution: str = "medium",
    step_days: int = 1,
):
    """GET endpoint for pixel data (convenience wrapper around POST)"""
    request = PixelDataRequest(
        x0=x0,
        x1=x1,
        y0=y0,
        y1=y1,
        variable=variable,
        model=model,
        start_date=start_date,
        end_date=end_date,
        scenario=scenario,
        resolution=resolution,
        step_days=step_days,
    )
    return fetch_pixel_data(request)




@app.post("/aggregate-on-demand")
def aggregate_on_demand(request: OnDemandAggregateRequest):
    """
    On-demand aggregation for a logic_box: read only the window, return mean time series (optional mask).
    Inputs: logic_box (x0,x1,y0,y1), variable, models, time range, resolution, step_days, optional mask.
    Outputs: per-model timestamps and mean values without downloading the full globe.
    """
    try:
        x0, x1, y0, y1 = _validate_logic_box(
            request.x0, request.x1, request.y0, request.y1
        )
        win_h = y1 - y0 + 1
        win_w = x1 - x0 + 1

        mask_arr = None
        if request.mask is not None:
            try:
                mask_arr = np.array(request.mask, dtype=float)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Invalid mask: {exc}")
            if mask_arr.shape != (win_h, win_w):
                raise HTTPException(
                    status_code=422,
                    detail=f"Mask shape {mask_arr.shape} must match window {(win_h, win_w)}",
                )

        results = {}
        for model in request.models:
            series = data_loader.load_pixel_time_series(
                variable=request.variable,
                model=model,
                start_time=request.start_date,
                end_time=request.end_date,
                scenario=request.scenario,
                resolution=request.resolution,
                step_days=request.step_days,
                window_box=(x0, x1, y0, y1),
            )

            if not series:
                raise DataLoadingError(f"No data returned for model {model}")

            timestamps = []
            values = []

            for entry in series:
                ts = entry.get("time") or entry.get("timestamp")
                if ts:
                    timestamps.append(ts)
                arr = entry.get("data")
                if arr is None:
                    values.append(float("nan"))
                    continue

                window = np.asarray(arr)
                if mask_arr is not None:
                    valid_mask = np.isfinite(mask_arr) & np.isfinite(window)
                    if not valid_mask.any():
                        values.append(float("nan"))
                        continue
                    values.append(float(np.mean(window[valid_mask])))
                else:
                    valid = np.isfinite(window)
                    if not valid.any():
                        values.append(float("nan"))
                        continue
                    values.append(float(np.mean(window[valid])))

            finite_values = [v for v in values if np.isfinite(v)]
            results[model] = {
                "timestamps": timestamps,
                "values": values,
                "valid_count": len(finite_values),
                "nan_count": len(values) - len(finite_values),
            }

        return {
            "window": [x0, x1, y0, y1],
            "variable": request.variable,
            "scenario": request.scenario or "unknown",
            "resolution": request.resolution,
            "step_days": request.step_days,
            "mask_applied": request.mask is not None,
            "models": results,
            "status": "ok",
        }

    except ParameterValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except DataLoadingError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


_aggregated_manager = None


def _get_aggregated_manager() -> AggregatedDataManager:
    """Lazy-load aggregated data manager"""
    global _aggregated_manager
    if _aggregated_manager is None:
        agg_file = os.path.join(_CURRENT_DIR, "aggregated_data.h5")
        _aggregated_manager = AggregatedDataManager(agg_file)
    return _aggregated_manager


@app.get("/aggregated-data")
def get_aggregated_data(
    region: str = "global",
    variable: str = "tas",
    scenario: str = "ssp585",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """
    Fast retrieval of pre-aggregated regional climate data.
    
    This endpoint returns mean values pre-computed for specified regions,
    enabling sub-millisecond queries compared to full data downloads.
    
    Example:
        GET /aggregated-data?region=global&variable=tas&scenario=ssp585
    
    Returns: {region, variable, scenario, models: {model_name: [values...]}}
    """
    manager = _get_aggregated_manager()
    
    if not manager.exists():
        raise HTTPException(
            status_code=503,
            detail="Aggregated data not available. Run precompute script first."
        )
    
    try:
        data = manager.get_data(
            region=region,
            variable=variable,
            scenario=scenario,
            start_date=start_date,
            end_date=end_date,
        )
        
        return {
            "region": region,
            "variable": variable,
            "scenario": scenario,
            "start_date": start_date,
            "end_date": end_date,
            "models": data,
            "status": "ok"
        }
    
    except AggregatedDataError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/aggregated-regions")
def get_aggregated_regions():
    """Get list of available pre-aggregated regions"""
    manager = _get_aggregated_manager()
    
    if not manager.exists():
        return {"regions": [], "status": "not_available"}
    
    try:
        with h5py.File(str(manager.filepath), "r") as f:
            regions = [k for k in f.keys() if k != "metadata"]
        
        return {
            "regions": regions,
            "status": "ok"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/aggregated-status")
def get_aggregated_status():
    """Check if aggregated data is available and get metadata"""
    manager = _get_aggregated_manager()
    
    if not manager.exists():
        return {
            "available": False,
            "message": "Aggregated data not precomputed"
        }
    
    try:
        import h5py
        with h5py.File(str(manager.filepath), "r") as f:
            meta = f["metadata"]
            regions = json.loads(meta.attrs.get("regions", "[]"))
            models = json.loads(meta.attrs.get("models", "[]"))
            return {
                "available": True,
                "version": meta.attrs.get("version", "unknown"),
                "created_date": meta.attrs.get("created_date", "unknown"),
                "regions": regions,
                "models": models,
            }
    except Exception as e:
        return {
            "available": False,
            "error": str(e)
        }


def main():
    """Convenience entry point for `python api_server.py`."""
    import uvicorn

    host = os.environ.get("NEX_GDDP_API_HOST", "0.0.0.0")
    port = int(os.environ.get("NEX_GDDP_API_PORT", "8000"))
    uvicorn.run(app=app, host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
