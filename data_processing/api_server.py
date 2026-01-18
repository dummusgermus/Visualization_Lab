from __future__ import annotations

import base64
import os
import sys
from typing import List, Literal, Optional

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
    from . import utils  # type: ignore  # noqa: E402
    from . import llm_chat  # type: ignore  # noqa: E402
    from .data_loader import DataLoadingError  # type: ignore  # noqa: E402
    from .utils import ParameterValidationError  # type: ignore  # noqa: E402
except ImportError:  # pragma: no cover
    import data_loader  # type: ignore  # noqa: E402
    import utils  # type: ignore  # noqa: E402
    import llm_chat  # type: ignore  # noqa: E402
    from data_loader import DataLoadingError  # type: ignore  # noqa: E402
    from utils import ParameterValidationError  # type: ignore  # noqa: E402


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


@app.post("/chat")
def chat(request: llm_chat.ChatRequest):
    """
    Process a chat message with LLM and return a response.

    The request can include:
    - message: The user's question or message
    - context: Current application state (selected variable, model, scenario, etc.)
    - history: Previous chat messages for context
    """
    try:
        response = llm_chat.process_chat_message(
            message=request.message,
            context=request.context,
            history=request.history
        )
        return response
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Chat processing failed: {str(exc)}"
        ) from exc


def main():
    """Convenience entry point for `python api_server.py`."""
    import uvicorn

    host = os.environ.get("NEX_GDDP_API_HOST", "0.0.0.0")
    port = int(os.environ.get("NEX_GDDP_API_PORT", "8000"))
    uvicorn.run(app=app, host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
