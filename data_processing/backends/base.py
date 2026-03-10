"""
Abstract base class for data backends.

Each backend must implement two primitives:
  - read_global_grid(field, date, quality)   →  np.ndarray (lat, lon)
  - read_pixel_window(field, date, quality, window_box) → np.ndarray (rows, cols)

Everything else in data_loader.py (disk cache, LRU, time-series fanout, etc.)
sits above this interface and is shared by both backends.
"""

from abc import ABC, abstractmethod
from datetime import datetime

import numpy as np


class DataBackend(ABC):
    """Minimal interface that every data-source backend must satisfy."""

    # ------------------------------------------------------------------
    # Core primitives (must be overridden)
    # ------------------------------------------------------------------

    @abstractmethod
    def read_global_grid(
        self,
        field: str,
        date: datetime,
        quality: int,
    ) -> np.ndarray:
        """
        Return a full global grid (lat × lon) as a read-only float32 array
        for the requested field / date / quality level.

        Parameters
        ----------
        field:   OpenVisus-style field name,
                 e.g. ``"tas_day_ACCESS-CM2_historical_r1i1p1f1_gn"``
        date:    The calendar date whose daily value is requested.
        quality: Integer quality code that controls spatial resolution:
                   0  → full resolution (~600 × 1440)
                  -2  → medium resolution (~300 × 720)
                  -6  → low resolution    (~75  × 180)
        """
        raise NotImplementedError

    @abstractmethod
    def read_pixel_window(
        self,
        field: str,
        date: datetime,
        quality: int,
        window_box: tuple,
    ) -> np.ndarray:
        """
        Return a spatial window of the global grid as a read-only array.

        Parameters
        ----------
        window_box: ``(x0, x1, y0, y1)`` inclusive pixel bounds at the
                    *full-resolution* grid (600 × 1440).

        Backends that support native windowed reads (e.g. OpenVisus) should
        use them for efficiency.  Backends that don't (e.g. Planetary
        Computer) may implement this as ``read_global_grid`` followed by
        a NumPy slice.
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Optional lifecycle hooks
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Release any held resources (open files, network connections, …)."""
