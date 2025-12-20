from datetime import datetime
import hashlib
import numpy as np
import os
from pathlib import Path
import sys
import threading

# Ensure current directory is in path
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

import config


class ParameterValidationError(Exception):
    """Parameter validation error"""
    pass


def validate_variable(variable: str) -> str:
    """Validate climate variable name"""
    if variable not in config.VALID_VARIABLES:
        raise ParameterValidationError(
            f"Invalid variable '{variable}'. Valid: {config.VALID_VARIABLES}"
        )
    return variable


def validate_model(model: str) -> str:
    """Validate climate model name"""
    if model not in config.VALID_MODELS:
        raise ParameterValidationError(
            f"Invalid model '{model}'. Valid: {config.VALID_MODELS}"
        )
    return model


def validate_scenario(scenario: str) -> str:
    """Validate emission scenario name"""
    if scenario not in config.VALID_SCENARIOS:
        raise ParameterValidationError(
            f"Invalid scenario '{scenario}'. Valid: {config.VALID_SCENARIOS}"
        )
    return scenario


def validate_resolution(resolution: str) -> str:
    """Validate spatial resolution level"""
    if resolution not in config.VALID_RESOLUTIONS:
        raise ParameterValidationError(
            f"Invalid resolution '{resolution}'. Valid: {config.VALID_RESOLUTIONS}"
        )
    return resolution


def parse_date(date_input) -> datetime:
    """Parse date input (supports str and datetime objects)"""
    if isinstance(date_input, datetime):
        return date_input
    
    if isinstance(date_input, str):
        try:
            return datetime.strptime(date_input, "%Y-%m-%d")
        except ValueError:
            raise ParameterValidationError(
                f"Invalid date format '{date_input}'. Expected: 'YYYY-MM-DD'"
            )
    
    raise ParameterValidationError(
        f"Date must be string or datetime, got {type(date_input)}"
    )


def validate_date_range(date: datetime, scenario: str) -> None:
    """Validate date falls within scenario's valid time range"""
    time_info = config.TIME_RANGE[scenario]
    start_year = time_info["start_year"]
    end_year = time_info["end_year"]
    
    if not (start_year <= date.year <= end_year):
        raise ParameterValidationError(
            f"Date year {date.year} out of range for '{scenario}'. Valid: {start_year}-{end_year}"
        )


def validate_all_parameters(variable: str, model: str, scenario: str, 
                           date: datetime, resolution: str) -> None:
    """Validate all parameters at once"""
    validate_variable(variable)
    validate_model(model)
    validate_scenario(scenario)
    validate_resolution(resolution)
    validate_date_range(date, scenario)


def date_to_timestep_index(date: datetime) -> int:
    """
    Convert datetime to OpenVisus timestep index.
    
    Formula: timestep = year * days_in_year + day_of_year
    Accounts for leap years.
    """
    day_of_year = (date - datetime(date.year, 1, 1)).days
    
    # Check leap year
    is_leap = (date.year % 4 == 0 and date.year % 100 != 0) or (date.year % 400 == 0)
    days_in_year = 366 if is_leap else 365
    
    return date.year * days_in_year + day_of_year


def timestep_index_to_date(timestep: int) -> datetime:
    """Convert OpenVisus timestep index back to datetime"""
    days_counted = 0
    year = 1950  # Dataset starts at 1950
    
    while True:
        is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
        days_in_year = 366 if is_leap else 365
        
        if days_counted + days_in_year > timestep:
            break
        
        days_counted += days_in_year
        year += 1
    
    day_of_year = timestep - days_counted
    return datetime(year, 1, 1) + __import__('datetime').timedelta(days=day_of_year)


def get_run_id(model: str) -> str:
    """Get ensemble member ID for a climate model"""
    return config.MODEL_RUN_IDS.get(model, config.DEFAULT_RUN_ID)


def generate_field_name(variable: str, model: str, scenario: str) -> str:
    """
    Generate OpenVisus field name.
    
    Format: {variable}_day_{model}_{scenario}_{run}_gn
    Example: tas_day_ACCESS-CM2_historical_r1i1p1f1_gn
    """
    run = get_run_id(model)
    return f"{variable}_day_{model}_{scenario}_{run}_gn"


def resolution_to_quality(resolution: str) -> int:
    """Convert resolution level to OpenVisus quality parameter"""
    return config.RESOLUTION_QUALITY_MAP.get(resolution, -2)


def infer_scenario_from_date(date: datetime, provided_scenario: str = None) -> str:
    """
    Infer scenario from date.
    
    - If year < 2015: must use 'historical'
    - If year >= 2015: use provided scenario or default to 'ssp585'
    """
    if date.year < config.SCENARIO_SWITCH_YEAR:
        if provided_scenario and provided_scenario != "historical":
            raise ParameterValidationError(
                f"For date {date.strftime('%Y-%m-%d')} (before {config.SCENARIO_SWITCH_YEAR}), "
                f"only 'historical' is available. Got '{provided_scenario}'."
            )
        return "historical"
    else:
        if provided_scenario is None:
            print(f"Warning: No scenario for {date.year}. Using 'ssp585'.")
            return "ssp585"
        return provided_scenario


# -----------------------------------------------------------------------------
# Cache helpers
# -----------------------------------------------------------------------------

_cache_initialized = False
_cache_init_lock = threading.Lock()
_disk_cache_lock = threading.Lock()


def ensure_cache_environment():
    """Prepare cache directories and VISUS cache environment variable."""
    global _cache_initialized
    if _cache_initialized:
        return

    with _cache_init_lock:
        if _cache_initialized:
            return

        Path(config.VISUS_CACHE_DIR).mkdir(parents=True, exist_ok=True)
        if "VISUS_CACHE" not in os.environ:
            os.environ["VISUS_CACHE"] = config.VISUS_CACHE_DIR

        if config.DISK_CACHE_ENABLED:
            Path(config.DATA_CACHE_DIR).mkdir(parents=True, exist_ok=True)

        _cache_initialized = True


def disk_cache_path(field: str, timestep_idx: int, quality: int) -> Path:
    """Return deterministic cache path for numpy blobs."""
    raw_key = f"{field}|{timestep_idx}|{quality}"
    digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()
    return Path(config.DATA_CACHE_DIR) / f"{digest}.npy"


def read_from_disk_cache(field: str, timestep_idx: int, quality: int):
    """Return cached numpy array (memmap) if available."""
    if not config.DISK_CACHE_ENABLED:
        return None

    path = disk_cache_path(field, timestep_idx, quality)
    if not path.exists():
        return None

    try:
        data = np.load(path, mmap_mode='r', allow_pickle=False)
        data.setflags(write=False)
        return data
    except Exception:
        try:
            path.unlink()
        except OSError:
            pass
        return None


def write_to_disk_cache(field: str, timestep_idx: int, quality: int, data: np.ndarray):
    """Persist numpy array to disk cache if enabled."""
    if not config.DISK_CACHE_ENABLED:
        return

    path = disk_cache_path(field, timestep_idx, quality)
    if path.exists():
        return

    tmp_path = path.with_suffix('.tmp.npy')
    with _disk_cache_lock:
        try:
            np.save(tmp_path, data)
            os.replace(tmp_path, path)
        except Exception:
            for candidate in (tmp_path, path):
                try:
                    if candidate.exists():
                        candidate.unlink()
                except OSError:
                    pass
