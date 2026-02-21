import os

# Climate variables
VALID_VARIABLES = [
    "hurs",      # Near-Surface Relative Humidity (%)
    "huss",      # Near-Surface Specific Humidity (%)
    "pr",        # Precipitation (kg m-2 s-1)
    "rlds",      # Surface Downwelling Longwave Radiation (W/m²)
    "rsds",      # Surface Downwelling Shortwave Radiation (W/m²)
    "sfcWind",   # Daily-Mean Near-Surface Wind Speed (m s-1)
    "tas",       # Daily Near-Surface Air Temperature (K)
    "tasmax",    # Daily Maximum Near-Surface Air Temperature (K)
    "tasmin",    # Daily Minimum Near-Surface Air Temperature (K)
]

VARIABLE_UNIT_MAP = {
    "hurs": "%",
    "huss": "%",
    "pr": ["g m-2 s-1", "kg m-2 s-1"],
    "rlds": ["W/m²", "kW/m²"],
    "rsds": ["W/m²", "kW/m²"],
    "sfcWind": ["m s-1", "km h-1", "mph"],
    "tas": ["K", "°C", "°F"],
    "tasmax": ["K", "°C", "°F"],
    "tasmin": ["K", "°C", "°F"],
}


VALID_CHART_MODES = [
    "single",
    "range",
]

VALID_CHART_LOCATIONS = ["World","Draw", "Point"]

# Climate models
VALID_MODELS = [
    "ACCESS-CM2",
    "CanESM5",
    "CESM2",
    "CMCC-CM2-SR5",
    "EC-Earth3",
    "GFDL-ESM4",
    "INM-CM5-0",
    "IPSL-CM6A-LR",
    "MIROC6",
    "MPI-ESM1-2-HR",
    "MRI-ESM2-0",
]

# Scenarios
VALID_SCENARIOS = [
    "historical",  # Historical period (1950-2014)
    "ssp245",      # SSP 2-4.5 scenario (2015-2100)
    "ssp370",      # SSP 3-7.0 scenario (2015-2100)
    "ssp585",      # SSP 5-8.5 scenario (2015-2100)
]

# Resolution levels
VALID_RESOLUTIONS = [
    "low",         # quality=-6, ~50 KB
    "medium",      # quality=-2, ~200 KB
    "high",        # quality=0, ~3.5 MB
]

# Variable metadata
VARIABLE_METADATA = {
    "tas": {
        "name": "Daily Near-Surface Air Temperature",
        "unit": "K",
        "description": "Daily mean temperature at 2 meters height",
    },
    "tasmin": {
        "name": "Daily Minimum Near-Surface Air Temperature",
        "unit": "K",
        "description": "Daily minimum temperature at 2 meters height",
    },
    "tasmax": {
        "name": "Daily Maximum Near-Surface Air Temperature",
        "unit": "K",
        "description": "Daily maximum temperature at 2 meters height",
    },
    "pr": {
        "name": "Precipitation",
        "unit": "kg m-2 s-1",
        "description": "Daily accumulated precipitation",
    },
    "hurs": {
        "name": "Near-Surface Relative Humidity",
        "unit": "%",
        "description": "Daily mean relative humidity at 2 meters height",
    },
    "huss": {
        "name": "Near-Surface Specific Humidity",
        "unit": "%",
        "description": "Daily mean specific humidity at 2 meters height",
    },
    "rsds": {
        "name": "Surface Downwelling Shortwave Radiation",
        "unit": "W/m²",
        "description": "Daily mean downwelling shortwave radiation at the surface",
    },
    "rlds": {
        "name": "Surface Downwelling Longwave Radiation",
        "unit": "W/m²",
        "description": "Daily mean downwelling longwave radiation at the surface",
    },
    "sfcWind": {
        "name": "Daily-Mean Near-Surface Wind Speed",
        "unit": "m s-1",
        "description": "Daily mean wind speed at 10 meters height",
    },
}

# Scenario metadata
SCENARIO_METADATA = {
    "historical": {
        "period": "1950-2014",
        "type": "observation-based",
        "description": "Historical simulations and observations",
    },
    "ssp245": {
        "period": "2015-2100",
        "type": "projection",
        "description": "SSP 2-4.5 (moderate emissions)",
    },
    "ssp370": {
        "period": "2015-2100",
        "type": "projection",
        "description": "SSP 3-7.0 (medium-high emissions)",
    },
    "ssp585": {
        "period": "2015-2100",
        "type": "projection",
        "description": "SSP 5-8.5 (high emissions)",
    },
}

# Model ensemble member IDs (CESM2 is special)
MODEL_RUN_IDS = {
    "CESM2": "r4i1p1f1",
}
DEFAULT_RUN_ID = "r1i1p1f1"

# Resolution to quality parameter mapping
RESOLUTION_QUALITY_MAP = {
    "low": -6,
    "medium": -2,
    "high": 0,
}

# Dataset URL
DATASET_URL = "http://atlantis.sci.utah.edu/mod_visus?dataset=nex-gddp-cmip6&cached=arco"

# Valid time ranges for each scenario
TIME_RANGE = {
    "historical": {"start_year": 1950, "end_year": 2014},
    "ssp245": {"start_year": 2015, "end_year": 2100},
    "ssp370": {"start_year": 2015, "end_year": 2100},
    "ssp585": {"start_year": 2015, "end_year": 2100},
}

# Scenario switching year
SCENARIO_SWITCH_YEAR = 2015

# Grid specifications
GRID_SHAPE = (600, 1440)  # (latitude, longitude)
GRID_RESOLUTION = 0.25    # degrees


# Caching configuration
# Base cache directory
DEFAULT_CACHE_DIR = os.environ.get(
    "NEX_GDDP_CACHE_DIR",
    os.path.join(os.path.expanduser("~"), ".nex_gddp_cache"),
)

# OpenVisus cache directory
VISUS_CACHE_DIR = os.path.join(DEFAULT_CACHE_DIR, "visus_cache")

# Local data cache directory for numpy arrays
DATA_CACHE_DIR = os.path.join(DEFAULT_CACHE_DIR, "data_cache")

# In-memory cache size (number of unique field/time/quality combos)
MEMORY_CACHE_MAXSIZE = int(os.environ.get("NEX_GDDP_MEMORY_CACHE", "32"))

# Toggle disk caching (set env NEX_GDDP_DISABLE_DISK_CACHE=1 to disable)
DISK_CACHE_ENABLED = os.environ.get("NEX_GDDP_DISABLE_DISK_CACHE", "0") != "1"

# Maximum concurrent workers for high-level loaders.
# Keep default conservative to prevent CPU saturation on local machines.
MAX_WORKERS = int(os.environ.get("NEX_GDDP_MAX_WORKERS", "3"))

# Hard cap for sampled timesteps returned by time-series style endpoints.
# If the requested range has more timesteps, the loader subsamples evenly.
MAX_TIME_SERIES_POINTS = int(
    os.environ.get("NEX_GDDP_MAX_TIME_SERIES_POINTS", "600")
)
