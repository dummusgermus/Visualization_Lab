"""
backends/__init__.py — active data-source selection.

To switch data sources, change exactly ONE import line below and restart
the API server.  Everything else (disk cache, LRU, time-series fanout, …)
is shared and requires no changes.

────────────────────────────────────────────────────────────────────────
  SWAP THIS ONE LINE to change the data source:
────────────────────────────────────────────────────────────────────────
"""

# ── ACTIVE BACKEND (swap this import to switch data source) ────────────────
from backends.openvisus_backend import OpenVisusBackend as _BackendClass
# from backends.planetary_computer_backend import PlanetaryComputerBackend as _BackendClass
# ──────────────────────────────────────────────────────────────────────────

from backends.base import DataBackend  # noqa: F401  (re-export for type hints)

# Singleton instance — created once on first import.
ACTIVE: DataBackend = _BackendClass()
