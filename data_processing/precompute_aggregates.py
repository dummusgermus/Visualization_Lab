import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

import config
from aggregated_data import AggregatedDataManager
from data_loader import load_data, load_pixel_window

# Configuration
SAMPLE_EVERY_N_DAYS = 30  # Sample every N days (for speed)
OUTPUT_FILE = "aggregated_data.h5"
DEFAULT_MASK_DIR = Path(__file__).parent / "regions"
DEFAULT_REGION_CONFIG = DEFAULT_MASK_DIR / "regions.yaml"


def _load_mask_path(path: Path) -> np.ndarray:
    """Load a region mask (npy). Mask values: 1/0 or NaN; shape must match grid."""
    if not path.exists():
        raise FileNotFoundError(f"Mask file not found: {path}")
    mask = np.load(path)
    if mask.shape != config.GRID_SHAPE:
        raise ValueError(
            f"Mask shape {mask.shape} for mask {path} does not match grid {config.GRID_SHAPE}"
        )
    return mask


def _mask_bbox(mask: np.ndarray):
    """Return bounding box (x0,x1,y0,y1) covering nonzero/finite mask."""
    finite = np.isfinite(mask) & (mask != 0)
    if not finite.any():
        return None
    ys, xs = np.where(finite)
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def _masked_mean(data: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(data) & np.isfinite(mask) & (mask != 0)
    if not valid.any():
        return np.nan
    return float(np.mean(data[valid]))


def _apply_mean(data: np.ndarray, mask: np.ndarray | None) -> float:
    if mask is None:
        valid = data[np.isfinite(data)]
        if len(valid) == 0:
            return np.nan
        return float(np.mean(valid))
    return _masked_mean(data, mask)


def _select_regions(mask_dir: Path):
    """Return dict of region -> mask (None for global), using YAML config or env."""
    config_path = Path(os.environ.get("NEX_GDDP_REGIONS_CONFIG", DEFAULT_REGION_CONFIG))

    config_regions = {}
    if config_path.exists():
        try:
            import yaml  # type: ignore
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            if not isinstance(cfg, dict):
                raise ValueError("regions config must be a mapping")
            for name, path in cfg.items():
                if path is None:
                    config_regions[name] = None
                else:
                    mask_path = Path(path)
                    if not mask_path.is_absolute():
                        mask_path = config_path.parent / mask_path
                    config_regions[name] = mask_path
        except ImportError:
            print(f"[WARN] PyYAML not installed; ignore config file {config_path}")
        except Exception as exc:  # pragma: no cover - config optional
            print(f"[WARN] Failed to read regions config {config_path}: {exc}")

    env_regions = os.environ.get("NEX_GDDP_REGIONS")
    region_names = (
        [name.strip() for name in env_regions.split(",") if name.strip()]
        if env_regions
        else (list(config_regions.keys()) if config_regions else ["global"])
    )

    regions = {}
    for name in region_names:
        if name == "global":
            regions[name] = None
            continue
        if name in config_regions and config_regions[name] is not None:
            regions[name] = _load_mask_path(config_regions[name])
        else:
            regions[name] = _load_mask_path(mask_dir / f"{name}.npy")
    return regions


def precompute_aggregates():
    """Precompute and save aggregated data for configured regions/masks."""

    models = config.VALID_MODELS
    variables = config.VALID_VARIABLES
    scenarios = config.VALID_SCENARIOS
    quick_test = os.environ.get("NEX_GDDP_AGG_TEST") == "1"
    quick_range_days = int(os.environ.get("NEX_GDDP_AGG_TEST_RANGE_DAYS", "60"))
    quick_model_count = int(os.environ.get("NEX_GDDP_AGG_TEST_MODELS", "2"))
    quick_variable_count = int(os.environ.get("NEX_GDDP_AGG_TEST_VARIABLES", "2"))
    quick_scenario_count = int(os.environ.get("NEX_GDDP_AGG_TEST_SCENARIOS", "2"))
    if quick_test:
        models = models[:max(1, quick_model_count)]
        variables = variables[:max(1, quick_variable_count)]
        scenarios = scenarios[:max(1, quick_scenario_count)]

    mask_dir = Path(os.environ.get("NEX_GDDP_REGION_DIR", DEFAULT_MASK_DIR))
    regions = _select_regions(mask_dir)
    region_bboxes = {
        name: None if mask is None else _mask_bbox(mask)
        for name, mask in regions.items()
    }

    manager = AggregatedDataManager(OUTPUT_FILE)
    data_dict = {region: {} for region in regions}
    scenario_start_dates = {
        "historical": "1950-01-01",
        "ssp245": "2015-01-01",
        "ssp370": "2015-01-01",
        "ssp585": "2015-01-01",
    }

    print("=" * 70)
    print("Precomputing aggregated climate data (mask-aware)")
    print(f"  Regions: {list(regions.keys())}")
    print(f"  Models: {len(models)}")
    print(f"  Variables: {len(variables)}")
    print(f"  Scenarios: {len(scenarios)}")
    print(f"  Sampling: every {SAMPLE_EVERY_N_DAYS} days")
    print("=" * 70)

    for region_name, mask in regions.items():
        bbox = region_bboxes[region_name]
        if mask is not None and bbox is None:
            print(f"[WARN] Region '{region_name}' mask is empty; skipping.")
            continue
        print(f"\nRegion: {region_name} (bbox: {bbox if bbox else 'full'})")
        data_dict[region_name] = {}

        for variable in variables:
            print(f"  [{variable}]")
            data_dict[region_name][variable] = {}

            for scenario in scenarios:
                print(f"    {scenario:12s}...", end="", flush=True)

                if scenario == "historical":
                    start_date = datetime(1950, 1, 1)
                    end_date = datetime(2014, 12, 31)
                else:
                    start_date = datetime(2015, 1, 1)
                    end_date = datetime(2100, 12, 31)
                if quick_test:
                    end_date = min(end_date, start_date + timedelta(days=quick_range_days))

                timesteps = []
                current_date = start_date
                count = 0
                errors = 0

                while current_date <= end_date:
                    row = []
                    for model in models:
                        try:
                            if mask is None:
                                result = load_data(
                                    variable=variable,
                                    time=current_date.strftime("%Y-%m-%d"),
                                    model=model,
                                    scenario=scenario,
                                    resolution="low",
                                )
                                agg_value = _apply_mean(result["data"], None)
                            else:
                                x0, x1, y0, y1 = bbox
                                result = load_pixel_window(
                                    variable=variable,
                                    time=current_date.strftime("%Y-%m-%d"),
                                    model=model,
                                    scenario=scenario,
                                    resolution="low",
                                    window_box=(x0, x1, y0, y1),
                                )
                                window_data = np.asarray(result["data"])
                                mask_window = mask[y0 : y1 + 1, x0 : x1 + 1]
                                agg_value = _masked_mean(window_data, mask_window)
                            row.append(agg_value)
                        except Exception as e:
                            if errors == 0:
                                print()
                            print(
                                f"      Error at {current_date} ({model}): {str(e)[:80]}"
                            )
                            errors += 1
                            row.append(np.nan)

                    timesteps.append(row)
                    count += 1
                    current_date += timedelta(days=SAMPLE_EVERY_N_DAYS)

                data_dict[region_name][variable][scenario] = np.array(
                    timesteps, dtype=float
                )
                status = f"ok ({count} timesteps"
                if errors > 0:
                    status += f", {errors} errors"
                status += ")"
                print(f" {status}")

    print("\n" + "=" * 70)
    print("Writing HDF5 file...", end="", flush=True)
    manager.create_file(
        regions,
        data_dict,
        models,
        scenario_start_dates=scenario_start_dates,
        sample_every_n_days=SAMPLE_EVERY_N_DAYS,
    )
    print(" done.")

    file_size = Path(OUTPUT_FILE).stat().st_size / (1024 * 1024)
    print(f"Aggregated data saved to {OUTPUT_FILE} ({file_size:.1f} MB)")
    print("=" * 70)


if __name__ == "__main__":
    try:
        precompute_aggregates()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
