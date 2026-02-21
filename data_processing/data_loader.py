from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from functools import lru_cache
import numpy as np
import os
import sys
from typing import Iterable, List, Optional
from typing import Tuple

# Ensure current directory is in path
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

import config
import utils

import OpenVisus as ov

class DataLoadingError(Exception):
    """Data loading error"""
    pass


# Global database connection
_db = None

# Cache initialization guard
utils.ensure_cache_environment()


def get_database_connection():
    global _db
    
    if _db is None:
        try:
            _db = ov.LoadDataset(config.DATASET_URL)
        except Exception as e:
            raise DataLoadingError(f"Failed to connect to dataset: {e}")
    
    return _db


@lru_cache(maxsize=config.MEMORY_CACHE_MAXSIZE)
def _read_dataset_cached(field: str, timestep_idx: int, quality: int):
    db = get_database_connection()
    data = db.read(time=timestep_idx, field=field, quality=quality)
    data.setflags(write=False)
    utils.write_to_disk_cache(field, timestep_idx, quality, data)
    return data


def _read_dataset(field: str, timestep_idx: int, quality: int):
    cached = utils.read_from_disk_cache(field, timestep_idx, quality)
    if cached is not None:
        return cached
    return _read_dataset_cached(field, timestep_idx, quality)


def _evenly_subsample_dates(dates: List[datetime], max_points: int) -> List[datetime]:
    """Keep temporal coverage while capping processing cost."""
    if max_points <= 0 or len(dates) <= max_points:
        return dates
    # Use evenly spaced integer indices and keep endpoints.
    indices = np.linspace(0, len(dates) - 1, num=max_points, dtype=int)
    seen = set()
    reduced = []
    for idx in indices:
        if idx in seen:
            continue
        seen.add(idx)
        reduced.append(dates[idx])
    if reduced and reduced[-1] != dates[-1]:
        reduced[-1] = dates[-1]
    return reduced


def load_data(
    variable: str,
    time,
    model: str,
    scenario: str = None,
    resolution: str = "medium",
) -> dict:
    
    try:
        # Parse and validate date
        date = utils.parse_date(time)
        
        # Infer scenario if not provided
        scenario = utils.infer_scenario_from_date(date, scenario)
        
        # Validate all parameters
        utils.validate_all_parameters(variable, model, scenario, date, resolution)
        
        # Convert to internal format
        timestep_idx = utils.date_to_timestep_index(date)
        quality = utils.resolution_to_quality(resolution)
        field = utils.generate_field_name(variable, model, scenario)
        
        # Read from cache/OpenVisus
        try:
            data = _read_dataset(field, timestep_idx, quality)
        except Exception as e:
            raise DataLoadingError(f"Failed to read data: {e}")
        
        # Build result dictionary
        result = {
            'data': data,
            'variable': variable,
            'model': model,
            'scenario': scenario,
            'time': date.strftime('%Y-%m-%d'),
            'timestamp': date.isoformat(),
            'resolution': resolution,
            'shape': tuple(data.shape),
            'dtype': str(data.dtype),
            'size_bytes': data.nbytes,
            'quality': quality,
            'field': field,
            'metadata': {
                'variable': config.VARIABLE_METADATA.get(variable, {}),
                'scenario': config.SCENARIO_METADATA.get(scenario, {}),
            },
        }
        
        return result
    
    except utils.ParameterValidationError:
        raise
    except DataLoadingError:
        raise
    except Exception as e:
        raise DataLoadingError(f"Unexpected error: {e}")


def load_data_batch(requests: list) -> list:
    results = []
    for req in requests:
        try:
            result = load_data(**req)
            results.append(result)
        except Exception as e:
            results.append({
                'error': str(e),
                'request': req,
            })

    return results


def load_variables(
    variables: Iterable[str],
    time,
    model: str,
    scenario: Optional[str] = None,
    resolution: str = "medium",
    max_workers: Optional[int] = None,
) -> list:
    variables = list(variables)
    if not variables:
        raise utils.ParameterValidationError("At least one variable is required")

    def _load(var):
        return var, load_data(
            variable=var,
            time=time,
            model=model,
            scenario=scenario,
            resolution=resolution,
        )

    if len(variables) == 1 or (max_workers is not None and max_workers <= 1):
        return [load_data(
            variable=var,
            time=time,
            model=model,
            scenario=scenario,
            resolution=resolution,
        ) for var in variables]

    max_workers = max_workers or min(config.MAX_WORKERS, len(variables))
    ordered = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_load, var): var for var in variables}
        for future in as_completed(futures):
            ordered.append(future.result())

    ordered.sort(key=lambda item: variables.index(item[0]))
    return [payload for _, payload in ordered]


def load_time_series(
    variable: str,
    model: str,
    start_time,
    end_time,
    scenario: Optional[str] = None,
    resolution: str = "medium",
    step_days: int = 1,
    include_nan_stats: bool = False,
    max_workers: Optional[int] = None,
) -> List[dict]:
    start_date = utils.parse_date(start_time)
    end_date = utils.parse_date(end_time)
    if end_date < start_date:
        raise utils.ParameterValidationError("end_time must be on/after start_time")
    if step_days <= 0:
        raise utils.ParameterValidationError("step_days must be a positive integer")

    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=step_days)

    if not dates:
        return []
    dates = _evenly_subsample_dates(dates, config.MAX_TIME_SERIES_POINTS)

    def _load(date_obj):
        payload = load_data(
            variable=variable,
            time=date_obj,
            model=model,
            scenario=scenario,
            resolution=resolution,
        )
        if include_nan_stats:
            data = payload['data']
            has_finite = np.isfinite(data).any()
            payload['nan_statistics'] = {
                'valid_count': int(np.isfinite(data).sum()),
                'nan_count': int(np.isnan(data).sum()),
                'mean': float(np.nanmean(data)) if has_finite else float('nan'),
                'std': float(np.nanstd(data)) if has_finite else float('nan'),
            }
        return payload

    max_workers = max_workers or min(config.MAX_WORKERS, len(dates))
    if max_workers <= 1:
        return [_load(date_obj) for date_obj in dates]

    ordered = [None] * len(dates)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_load, date_obj): idx
            for idx, date_obj in enumerate(dates)
        }
        for future in as_completed(future_map):
            idx = future_map[future]
            ordered[idx] = future.result()
    return ordered


def load_pixel_window(
    variable: str,
    time,
    model: str,
    scenario: Optional[str],
    resolution: str,
    window_box: Tuple[int, int, int, int],
) -> dict:
    """
    Load a small window (logic_box) directly from OpenVisus to avoid full-grid reads.
    window_box: (x0, x1, y0, y1) inclusive pixel bounds.
    """
    date = utils.parse_date(time)
    scenario = utils.infer_scenario_from_date(date, scenario)
    utils.validate_all_parameters(variable, model, scenario, date, resolution)

    timestep_idx = utils.date_to_timestep_index(date)
    quality = utils.resolution_to_quality(resolution)
    field = utils.generate_field_name(variable, model, scenario)

    db = get_database_connection()
    x0, x1, y0, y1 = window_box
    # OpenVisus expects ([x0,y0],[x1,y1]) in dataset logic coords
    try:
        data = db.read(
            time=timestep_idx,
            field=field,
            quality=quality,
            logic_box=([x0, y0], [x1 + 1, y1 + 1]),  # upper bound exclusive
        )
        data.setflags(write=False)
    except Exception as e:
        raise DataLoadingError(f"Failed to read window: {e}")

    return {
        "data": data,
        "variable": variable,
        "model": model,
        "scenario": scenario,
        "time": date.strftime("%Y-%m-%d"),
        "timestamp": date.isoformat(),
        "resolution": resolution,
        "shape": tuple(data.shape),
        "dtype": str(data.dtype),
        "quality": quality,
        "field": field,
        "metadata": {
            "variable": config.VARIABLE_METADATA.get(variable, {}),
            "scenario": config.SCENARIO_METADATA.get(scenario, {}),
            "window_box": window_box,
        },
    }


def load_pixel_time_series(
    variable: str,
    model: str,
    start_time,
    end_time,
    scenario: Optional[str],
    resolution: str,
    step_days: int,
    window_box: Tuple[int, int, int, int],
) -> List[dict]:
    start_date = utils.parse_date(start_time)
    end_date = utils.parse_date(end_time)
    if end_date < start_date:
        raise utils.ParameterValidationError("end_time must be on/after start_time")
    if step_days <= 0:
        raise utils.ParameterValidationError("step_days must be a positive integer")

    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=step_days)

    if not dates:
        return []
    dates = _evenly_subsample_dates(dates, config.MAX_TIME_SERIES_POINTS)

    def _load(date_obj):
        return load_pixel_window(
            variable=variable,
            time=date_obj,
            model=model,
            scenario=scenario,
            resolution=resolution,
            window_box=window_box,
        )

    max_workers = min(config.MAX_WORKERS, len(dates))
    if max_workers <= 1:
        return [_load(date_obj) for date_obj in dates]

    ordered = [None] * len(dates)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_load, date_obj): idx
            for idx, date_obj in enumerate(dates)
        }
        for future in as_completed(future_map):
            idx = future_map[future]
            ordered[idx] = future.result()
    return ordered


def get_available_metadata() -> dict:
    return {
        'variables': config.VALID_VARIABLES,
        'models': config.VALID_MODELS,
        'scenarios': config.VALID_SCENARIOS,
        'resolutions': config.VALID_RESOLUTIONS,
        'variable_metadata': config.VARIABLE_METADATA,
        'scenario_metadata': config.SCENARIO_METADATA,
        'time_range': {
            'start': '1950-01-01',
            'end': '2100-12-31',
            'historical_end': '2014-12-31',
            'projection_start': '2015-01-01',
        },
    }
