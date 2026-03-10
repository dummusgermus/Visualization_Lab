"""
OpenVisus data backend.

Wraps the existing OpenVisus ``LoadDataset`` / ``db.read()`` calls.
Windowed reads use ``logic_box`` so that per-pixel time-series queries
only download the requested pixels rather than the entire global grid.
"""

import threading
from datetime import datetime
from typing import Tuple

import numpy as np

from backends.base import DataBackend


class OpenVisusBackend(DataBackend):
    """Read NEX-GDDP-CMIP6 data from the OpenVisus server."""

    FALLBACK_URL = (
        "https://us-east-1.gw.future-tech-holdings.com/nasa-t0/"
        "nex-gddp-cmip6/nex-gddp-cmip6.idx"
    )

    def __init__(self, dataset_url: str = None):
        # Import here so that the module can be imported even when
        # OpenVisus is not installed (e.g. during unit tests that
        # exercise the Planetary Computer backend).
        import sys, os
        _current_dir = os.path.dirname(os.path.abspath(__file__))
        _parent_dir = os.path.dirname(_current_dir)
        for d in (_current_dir, _parent_dir):
            if d not in sys.path:
                sys.path.insert(0, d)

        import config as _cfg
        self._dataset_url = dataset_url or _cfg.DATASET_URL
        self._db = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_db(self):
        """Return a live OpenVisus database connection (lazy, thread-safe).

        Tries the primary URL first; if that fails it retries once with
        ``FALLBACK_URL`` before raising.
        """
        if self._db is None:
            with self._lock:
                if self._db is None:
                    import OpenVisus as ov
                    urls = [self._dataset_url, self.FALLBACK_URL]
                    last_exc: BaseException | None = None
                    for url in urls:
                        db = None
                        try:
                            db = ov.LoadDataset(url)
                        except BaseException as exc:  # catches SWIG C++ exceptions too
                            last_exc = exc
                            continue
                        # LoadDataset may return None / falsy on failure
                        # without raising a Python exception
                        if not db:
                            last_exc = RuntimeError(
                                f"LoadDataset returned empty/invalid dataset for: {url}"
                            )
                            continue
                        # Success
                        self._db = db
                        if url != self._dataset_url:
                            import warnings
                            warnings.warn(
                                f"[OpenVisusBackend] Primary URL unavailable; "
                                f"using fallback: {url}",
                                RuntimeWarning,
                                stacklevel=2,
                            )
                        break
                    if self._db is None:
                        raise RuntimeError(
                            f"[OpenVisusBackend] Failed to connect to all URLs. "
                            f"Last error: {last_exc}"
                        ) from (last_exc if isinstance(last_exc, Exception) else None)
        return self._db

    def _reset_db(self):
        """Drop the cached connection so the next call forces a reconnect."""
        with self._lock:
            self._db = None

    # ------------------------------------------------------------------
    # DataBackend interface
    # ------------------------------------------------------------------

    def read_global_grid(
        self,
        field: str,
        date: datetime,
        quality: int,
    ) -> np.ndarray:
        """Read a full global grid via OpenVisus db.read()."""
        import sys, os
        _parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _parent_dir not in sys.path:
            sys.path.insert(0, _parent_dir)
        import utils

        timestep_idx = utils.date_to_timestep_index(date)
        db = self._get_db()
        try:
            data = db.read(time=timestep_idx, field=field, quality=quality)
        except Exception as exc:
            self._reset_db()
            raise RuntimeError(
                f"[OpenVisusBackend] read_global_grid failed: {exc}"
            ) from exc

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
        Read only the requested pixel window via OpenVisus ``logic_box``.

        This avoids downloading the entire global grid when the caller only
        needs a small spatial region (e.g. the pixel-data / chart endpoints).
        """
        import sys, os
        _parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _parent_dir not in sys.path:
            sys.path.insert(0, _parent_dir)
        import utils

        timestep_idx = utils.date_to_timestep_index(date)
        x0, x1, y0, y1 = window_box
        db = self._get_db()
        try:
            data = db.read(
                time=timestep_idx,
                field=field,
                logic_box=([x0, y0], [x1 + 1, y1 + 1]),  # upper bound exclusive
            )
        except Exception as exc:
            self._reset_db()
            raise RuntimeError(
                f"[OpenVisusBackend] read_pixel_window failed: {exc}"
            ) from exc

        data.setflags(write=False)
        return data

    def close(self) -> None:
        self._reset_db()
