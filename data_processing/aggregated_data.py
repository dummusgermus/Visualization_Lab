import h5py
import json
import math
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import config


class AggregatedDataError(Exception):
    """Aggregated data operation error"""
    pass


class AggregatedDataManager:
    def __init__(self, filepath: str = "aggregated_data.h5"):
        self.filepath = Path(filepath)
        self.date_start_hist = datetime(1950, 1, 1)
        self.date_start_proj = datetime(2015, 1, 1)

    def _date_to_idx(
        self,
        date_str: str,
        start_date: datetime,
        step_days: int,
        use_ceil: bool,
    ) -> int:
        """Convert date to array index based on sampling interval."""
        date = datetime.strptime(date_str, "%Y-%m-%d")
        delta_days = (date - start_date).days
        if use_ceil:
            return math.ceil(delta_days / step_days)
        return math.floor(delta_days / step_days)
    
    def create_file(
        self,
        regions: Dict[str, Optional[np.ndarray]],
        data_dict: Dict[str, Dict[str, Dict[str, np.ndarray]]],
        models: List[str],
        scenario_start_dates: Optional[Dict[str, str]] = None,
        sample_every_n_days: int = 1,
    ) -> None:
        """
        Create HDF5 file with aggregated data.
        """
        with h5py.File(str(self.filepath), "w") as f:
            # Store metadata
            meta = f.create_group("metadata")
            meta.attrs["version"] = "1.0"
            meta.attrs["created_date"] = datetime.now().isoformat()
            meta.attrs["models"] = json.dumps(models)
            meta.attrs["regions"] = json.dumps(list(regions.keys()))
            meta.attrs["sample_every_n_days"] = int(sample_every_n_days)
            if scenario_start_dates:
                meta.attrs["scenario_start_dates"] = json.dumps(
                    scenario_start_dates
                )
            
            # Store data
            for region, variables in data_dict.items():
                region_group = f.create_group(region)
                
                for variable, scenarios in variables.items():
                    var_group = region_group.create_group(variable)
                    
                    for scenario, data in scenarios.items():
                        # data shape: (timesteps, n_models)
                        if data.ndim == 1:
                            data = data.reshape(-1, 1)
                        dset = var_group.create_dataset(
                            scenario,
                            data=data,
                            compression="gzip",
                            compression_opts=4,
                            chunks=True,
                        )
                        dset.attrs["models"] = json.dumps(models)
                        dset.attrs["units"] = config.VARIABLE_METADATA.get(
                            variable, {}
                        ).get("unit", "unknown")
                        start_date = None
                        if scenario_start_dates:
                            start_date = scenario_start_dates.get(scenario)
                        if start_date is None:
                            start_date = (
                                self.date_start_hist.strftime("%Y-%m-%d")
                                if scenario == "historical"
                                else self.date_start_proj.strftime("%Y-%m-%d")
                            )
                        dset.attrs["start_date"] = start_date
                        dset.attrs["step_days"] = int(sample_every_n_days)
    
    def get_data(self,
                region: str,
                variable: str,
                scenario: str,
                start_date: Optional[str] = None,
                end_date: Optional[str] = None) -> Dict[str, List[float]]:
        """
        Retrieve aggregated data for region.
        
        Returns: {model_name: [values...]}
        """
        if not self.filepath.exists():
            raise AggregatedDataError(
                f"Aggregated data file not found: {self.filepath}"
            )
        
        try:
            with h5py.File(str(self.filepath), "r") as f:
                key = f"{region}/{variable}/{scenario}"
                if key not in f:
                    raise AggregatedDataError(
                        f"Data not found: region={region}, variable={variable}, scenario={scenario}"
                    )
                
                dataset = f[key]
                models = json.loads(dataset.attrs.get("models", "[]"))
                step_days = int(dataset.attrs.get("step_days", 1))
                start_attr = dataset.attrs.get("start_date")
                if isinstance(start_attr, bytes):
                    start_attr = start_attr.decode("utf-8")
                if not start_attr:
                    start_attr = (
                        self.date_start_hist.strftime("%Y-%m-%d")
                        if scenario == "historical"
                        else self.date_start_proj.strftime("%Y-%m-%d")
                    )
                start_dt = datetime.strptime(start_attr, "%Y-%m-%d")

                if start_date and end_date:
                    idx_start = self._date_to_idx(
                        start_date, start_dt, step_days, True
                    )
                    idx_end = self._date_to_idx(
                        end_date, start_dt, step_days, False
                    )
                    idx_start = max(0, idx_start)
                    idx_end = min(dataset.shape[0] - 1, idx_end)
                    if idx_start > idx_end:
                        data = dataset[:0]
                    else:
                        data = dataset[idx_start:idx_end + 1, :]
                else:
                    data = dataset[:]

                if data.ndim == 1:
                    data = data.reshape(-1, 1)

                # Convert to list of lists for JSON serialization
                return {
                    models[i]: data[:, i].tolist()
                    for i in range(len(models))
                    if i < data.shape[1]
                }
        
        except AggregatedDataError:
            raise
        except Exception as e:
            raise AggregatedDataError(f"Failed to read aggregated data: {e}")
    
    def exists(self) -> bool:
        """Check if aggregated data file exists"""
        return self.filepath.exists()


def apply_global_mean(data: np.ndarray, variable: str) -> float:
    """Compute global mean, handling NaN values"""
    valid = data[np.isfinite(data)]
    if len(valid) == 0:
        return np.nan
    return float(np.mean(valid))


def apply_region_mask(data: np.ndarray, mask: np.ndarray, variable: str) -> float:
    """Apply mask and compute regional mean"""
    masked = data[mask]
    valid = masked[np.isfinite(masked)]
    if len(valid) == 0:
        return np.nan
    return float(np.mean(valid))


def precompute_from_data(
    data_dict: Dict[str, Dict[str, Dict[str, np.ndarray]]],
    models: List[str],
    output_file: str = "aggregated_data.h5",
) -> None:
    """
    Create aggregated HDF5 file from pre-loaded data dictionary.
    
    Args:
        data_dict: {region: {variable: {scenario: ndarray}}}
        models: list of model names
        output_file: output filename
    """
    manager = AggregatedDataManager(output_file)
    regions = {region: None for region in data_dict.keys()}
    
    print("\nWriting HDF5 file...", end="", flush=True)
    manager.create_file(regions, data_dict, models)
    print(" ✓")
    print(f"Aggregated data saved to {output_file}")
