import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

import config
from data_loader import load_data
from aggregated_data import AggregatedDataManager


# Configuration
SAMPLE_EVERY_N_DAYS = 30  # Sample every N days (for speed)
OUTPUT_FILE = "aggregated_data.h5"


def apply_global_mean(data: np.ndarray, variable: str) -> float:
    """Compute global mean, handling NaN values"""
    valid = data[np.isfinite(data)]
    if len(valid) == 0:
        return np.nan
    return float(np.mean(valid))


def precompute_global_aggregates():
    """Precompute and save global aggregated data"""
    
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
    
    manager = AggregatedDataManager(OUTPUT_FILE)
    data_dict = {}
    scenario_start_dates = {
        "historical": "1950-01-01",
        "ssp245": "2015-01-01",
        "ssp370": "2015-01-01",
        "ssp585": "2015-01-01",
    }
    
    # Define regions (for now, just global)
    regions = {"global": None}
    data_dict["global"] = {}
    
    print("=" * 70)
    print("Precomputing aggregated climate data")
    print(f"  Models: {len(models)}")
    print(f"  Variables: {len(variables)}")
    print(f"  Scenarios: {len(scenarios)}")
    print(f"  Sampling: every {SAMPLE_EVERY_N_DAYS} days")
    print("=" * 70)
    
    for variable in variables:
        print(f"\n[{variable}]")
        data_dict["global"][variable] = {}
        
        for scenario in scenarios:
            print(f"  {scenario:12s}...", end="", flush=True)
            
            # Determine date range for scenario
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
                        result = load_data(
                            variable=variable,
                            time=current_date.strftime("%Y-%m-%d"),
                            model=model,
                            scenario=scenario,
                            resolution="low",
                        )
                        agg_value = apply_global_mean(result["data"], variable)
                        row.append(agg_value)
                    except Exception as e:
                        if errors == 0:
                            print()
                        print(
                            f"    Error at {current_date} ({model}): {str(e)[:50]}"
                        )
                        errors += 1
                        row.append(np.nan)

                timesteps.append(row)
                count += 1
                current_date += timedelta(days=SAMPLE_EVERY_N_DAYS)
            
            data_dict["global"][variable][scenario] = np.array(
                timesteps, dtype=float
            )
            status = f"ok ({count} timesteps"
            if errors > 0:
                status += f", {errors} errors"
            status += ")"
            print(f" {status}")
    
    # Create HDF5 file
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
        precompute_global_aggregates()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
