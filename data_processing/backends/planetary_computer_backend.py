"""
Microsoft Planetary Computer / Azure Blob Storage backend.

Reads NEX-GDDP-CMIP6 data from Azure Blob Storage via the Planetary
Computer STAC API.  Each year's data for a given model/variable/scenario
lives in a single NetCDF file (~135 GB total per scenario) that is read
lazily over HTTPS using h5netcdf/fsspec.

Access is **publicly signed** — no API key is required.

Dependencies (install once):
    pip install planetary-computer pystac-client fsspec zarr h5netcdf aiohttp

Limitations vs. OpenVisus:
  - ssp370 is NOT available on Planetary Computer (only historical / ssp245 / ssp585)
  - The dataset may not include all 35 CMIP6 models for every scenario; check
    ``SUPPORTED_SCENARIOS`` below against your model list.
  - Single-pixel time-series reads are slow because the NetCDF files are
    chunked as full daily global grids — every time step requires a separate
    HTTP range request for the compressed chunk.
  - Full-grid (global map) reads are fast: one HTTP request per day.
"""

from __future__ import annotations

import os
import sys
import threading
from collections import OrderedDict
from datetime import datetime
from functools import lru_cache
from typing import Dict, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Ensure parent directory is importable (for config / utils).
# ---------------------------------------------------------------------------
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
for _d in (_current_dir, _parent_dir):
    if _d not in sys.path:
        sys.path.insert(0, _d)

from backends.base import DataBackend

# Scenarios available on Planetary Computer (ssp370 is absent).
SUPPORTED_SCENARIOS = frozenset({"historical", "ssp245", "ssp585"})

# Quality code → spatial downsampling factor
# quality=0  (high)   600×1440 → factor 1
# quality=-2 (medium) 300×720  → factor 2
# quality=-6 (low)     75×180  → factor 8
_QUALITY_TO_FACTOR: Dict[int, int] = {0: 1, -2: 2, -6: 8}
_DEFAULT_FACTOR = 2  # medium if quality code is unrecognised

STAC_ENDPOINT = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION_ID = "nasa-nex-gddp-cmip6"


# ---------------------------------------------------------------------------
# Module-level STAC catalog singleton (shared across all instances).
# ---------------------------------------------------------------------------
_catalog = None
_catalog_lock = threading.Lock()


def _get_catalog():
    global _catalog
    if _catalog is None:
        with _catalog_lock:
            if _catalog is None:
                import pystac_client
                import planetary_computer
                _catalog = pystac_client.Client.open(
                    STAC_ENDPOINT,
                    modifier=planetary_computer.sign_inplace,
                )
    return _catalog


# ---------------------------------------------------------------------------
# Helper: parse an OpenVisus-style field name
# ---------------------------------------------------------------------------

def _parse_field(field: str) -> Tuple[str, str, str]:
    """
    Decompose ``"tas_day_ACCESS-CM2_historical_r1i1p1f1_gn"`` into
    ``(variable, model, scenario)``.

    Raises ``ValueError`` when any component cannot be identified.
    """
    import config as _cfg

    # Split on '_day_' to isolate the variable prefix.
    if "_day_" not in field:
        raise ValueError(f"Cannot parse field name (no '_day_'): {field!r}")
    variable, rest = field.split("_day_", 1)

    if variable not in _cfg.VALID_VARIABLES:
        raise ValueError(f"Unknown variable {variable!r} in field {field!r}")

    # Find the scenario token embedded in the remainder.
    scenario = None
    for sc in sorted(_cfg.VALID_SCENARIOS, key=len, reverse=True):
        if f"_{sc}_" in rest:
            scenario = sc
            model = rest.split(f"_{sc}_")[0]
            break

    if scenario is None or not model:
        raise ValueError(
            f"Cannot identify model/scenario in field {field!r}"
        )

    return variable, model, scenario


# ---------------------------------------------------------------------------
# LRU cache for open xarray datasets
# ---------------------------------------------------------------------------

class _DatasetCache:
    """
    Thread-safe LRU cache for open xarray Datasets, keyed by
    ``(variable, model, scenario, year)``.

    Keeping datasets open avoids the ~4 s metadata-parse overhead every time
    the same year file is accessed.
    """

    def __init__(self, maxsize: int = 12):
        self._maxsize = maxsize
        self._cache: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._cache:
                return None
            self._cache.move_to_end(key)
            return self._cache[key]

    def put(self, key, dataset):
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            else:
                self._cache[key] = dataset
                if len(self._cache) > self._maxsize:
                    oldest_key, oldest_ds = self._cache.popitem(last=False)
                    try:
                        oldest_ds.close()
                    except Exception:
                        pass

    def clear(self):
        with self._lock:
            for ds in self._cache.values():
                try:
                    ds.close()
                except Exception:
                    pass
            self._cache.clear()


class PlanetaryComputerBackend(DataBackend):
    """
    Read NEX-GDDP-CMIP6 data from Microsoft Planetary Computer / Azure Blob.
    """

    def __init__(self, dataset_cache_size: int = 12):
        self._ds_cache = _DatasetCache(maxsize=dataset_cache_size)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _open_year_dataset(
        self, variable: str, model: str, scenario: str, year: int
    ):
        """
        Open (or return cached) xarray.Dataset for one year of data.

        The dataset is opened lazily; actual HTTP reads only happen when
        ``.values`` / ``.load()`` is called on a DataArray.
        """
        import fsspec
        import xarray as xr
        import planetary_computer

        cache_key = (variable, model, scenario, year)
        ds = self._ds_cache.get(cache_key)
        if ds is not None:
            return ds

        catalog = _get_catalog()
        search = catalog.search(
            collections=[COLLECTION_ID],
            datetime=f"{year}-01-01/{year}-12-31",
            query={
                "cmip6:model": {"eq": model},
                "cmip6:scenario": {"eq": scenario},
            },
        )
        items = list(search.items())
        if not items:
            raise RuntimeError(
                f"[PlanetaryComputerBackend] No STAC item found for "
                f"{model}/{scenario}/{year}"
            )

        item = items[0]
        if variable not in item.assets:
            raise RuntimeError(
                f"[PlanetaryComputerBackend] Variable {variable!r} not in "
                f"STAC item {item.id!r}. Available: {list(item.assets)}"
            )

        href = item.assets[variable].href
        ds = xr.open_dataset(
            fsspec.open(href).open(),
            engine="h5netcdf",
        )
        self._ds_cache.put(cache_key, ds)
        return ds

    @staticmethod
    def _downsample(data: np.ndarray, factor: int) -> np.ndarray:
        """
        Reduce spatial resolution by averaging over non-overlapping blocks.

        ``factor`` must divide both dimensions evenly.  If the source array's
        shape is not divisible, it is cropped before averaging.
        """
        if factor <= 1:
            return data.astype(np.float32)

        rows, cols = data.shape
        rows_out = rows // factor
        cols_out = cols // factor

        cropped = data[: rows_out * factor, : cols_out * factor]
        result = (
            cropped
            .reshape(rows_out, factor, cols_out, factor)
            .mean(axis=(1, 3))
            .astype(np.float32)
        )
        return result

    # ------------------------------------------------------------------
    # DataBackend interface
    # ------------------------------------------------------------------

    def read_global_grid(
        self,
        field: str,
        date: datetime,
        quality: int,
    ) -> np.ndarray:
        """
        Return the full global grid for ``field`` on ``date`` at the
        requested quality level.

        Steps:
          1. Parse field → (variable, model, scenario)
          2. Open (or retrieve cached) year NetCDF from Azure Blob
          3. Select the correct day by index within the year
          4. Downsample to the requested quality
          5. Return as a read-only float32 array
        """
        variable, model, scenario = _parse_field(field)

        if scenario not in SUPPORTED_SCENARIOS:
            raise RuntimeError(
                f"[PlanetaryComputerBackend] Scenario {scenario!r} is not "
                f"available on Planetary Computer. "
                f"Supported: {sorted(SUPPORTED_SCENARIOS)}"
            )

        ds = self._open_year_dataset(variable, model, scenario, date.year)

        # Day-of-year index (0-based: Jan 1 → 0)
        day_idx = (date - datetime(date.year, 1, 1)).days
        n_times = ds.dims.get("time", 0)
        if day_idx >= n_times:
            raise RuntimeError(
                f"[PlanetaryComputerBackend] day_idx={day_idx} out of range "
                f"(file has {n_times} time steps) for {date.isoformat()}"
            )

        raw: np.ndarray = ds[variable].isel(time=day_idx).values.astype(np.float32)

        factor = _QUALITY_TO_FACTOR.get(quality, _DEFAULT_FACTOR)
        data = self._downsample(raw, factor)
        data.setflags(write=False)
        return data

    def read_pixel_window(
        self,
        field: str,
        date: datetime,
        quality: int,
        window_box: Tuple[int, int, int, int],
    ) -> np.ndarray:
        """
        Return a spatial window by reading the full global grid then slicing.

        ``window_box`` is specified in *full-resolution* pixel coordinates
        ``(x0, x1, y0, y1)``.  If ``quality`` implies downsampling the
        coordinates are scaled accordingly.

        Note: the Planetary Computer NetCDF files are chunked as full daily
        grids, so reading a window is no cheaper than reading the full day.
        The full-grid result is NOT cached here; use the disk-cache layer
        in ``data_loader.py`` to avoid repeat downloads.
        """
        full = self.read_global_grid(field, date, quality)

        factor = _QUALITY_TO_FACTOR.get(quality, _DEFAULT_FACTOR)
        x0, x1, y0, y1 = window_box
        # Scale window bounds from full-res to the downsampled grid
        sx0 = x0 // factor
        sx1 = x1 // factor
        sy0 = y0 // factor
        sy1 = y1 // factor

        window = full[sy0 : sy1 + 1, sx0 : sx1 + 1].copy()
        window.setflags(write=False)
        return window

    def close(self) -> None:
        self._ds_cache.clear()
