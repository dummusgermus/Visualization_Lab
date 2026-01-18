#!/usr/bin/env python
"""
Lightweight validation for aggregated_data.h5 using real data.

This script compares one aggregated value against a freshly computed
global mean from the source dataset.
"""

import sys
from datetime import datetime
from pathlib import Path

import h5py
import os
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import config
from aggregated_data import AggregatedDataManager, apply_global_mean
from data_loader import load_data


def main() -> int:
    manager = AggregatedDataManager("aggregated_data.h5")
    if not manager.exists():
        print("aggregated_data.h5 not found. Run precompute_aggregates.py first.")
        return 1

    region = os.environ.get("NEX_GDDP_AGG_VALIDATE_REGION", "global")
    variable = os.environ.get("NEX_GDDP_AGG_VALIDATE_VARIABLE", "tas")
    scenario = os.environ.get("NEX_GDDP_AGG_VALIDATE_SCENARIO", "ssp585")
    model = os.environ.get(
        "NEX_GDDP_AGG_VALIDATE_MODEL", config.VALID_MODELS[0]
    )

    data = manager.get_data(region, variable, scenario)
    if model not in data or not data[model]:
        print("Aggregated data missing expected model/values.")
        return 1

    with h5py.File(str(manager.filepath), "r") as f:
        dataset = f[f"{region}/{variable}/{scenario}"]
        start_date = dataset.attrs.get("start_date", "2015-01-01")
        if isinstance(start_date, bytes):
            start_date = start_date.decode("utf-8")

    # Use the first sampled date for validation
    raw = load_data(
        variable=variable,
        time=start_date,
        model=model,
        scenario=scenario,
        resolution="low",
    )
    mean_value = apply_global_mean(raw["data"], variable)
    agg_value = data[model][0]

    diff = float(abs(mean_value - agg_value))
    print(f"Model: {model}")
    print(f"Date: {start_date}")
    print(f"Aggregated: {agg_value:.6f}")
    print(f"Computed:   {mean_value:.6f}")
    print(f"Abs diff:   {diff:.6f}")

    if not np.isfinite(diff) or diff > 1e-3:
        print("Validation failed: difference too large.")
        return 1

    print("Validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
