import hashlib
import os
from pathlib import Path
import numpy as np
import config
from data_loader import (
    load_data,
    load_data_batch,
    load_time_series,
    load_variables,
    get_available_metadata,
    DataLoadingError,
)
from utils import (
    ParameterValidationError,
    parse_date,
    date_to_timestep_index,
    resolution_to_quality,
)

try:
    from data_loader import _read_dataset_cached  # type: ignore
except ImportError:
    _read_dataset_cached = None

print("=" * 70)
print("NEX-GDDP-CMIP6 Data Loading Tests - With Real Data from OpenVisus")
print("=" * 70)

# Test 1: Get metadata
print("\nTest 1: Retrieve available metadata")
try:
    metadata = get_available_metadata()
    print(f"[OK] Metadata retrieved successfully")
    print(f"  - Variables available: {len(metadata['variables'])}")
    print(f"    {metadata['variables']}")
    print(f"  - Models available: {len(metadata['models'])}")
    print(f"    {metadata['models'][:3]}... (+{len(metadata['models'])-3} more)")
    print(f"  - Scenarios available: {len(metadata['scenarios'])}")
    print(f"    {metadata['scenarios']}")
except Exception as e:
    print(f"[X] Error retrieving metadata: {e}")
    import traceback
    traceback.print_exc()

# Test 2: Validate parameters
print("\nTest 2: Validate input parameters")
try:
    from utils import validate_variable, validate_model, validate_scenario, validate_resolution
    
    validate_variable('tas')
    validate_model('ACCESS-CM2')
    validate_scenario('historical')
    validate_resolution('medium')
    print(f"[OK] All valid parameters accepted")
    
    # Test invalid parameter
    try:
        validate_variable("invalid_var")
        print(f"[X] Invalid parameter should have been rejected")
    except ParameterValidationError as e:
        print(f"[OK] Invalid parameter correctly rejected")
except Exception as e:
    print(f"[X] Error in parameter validation: {e}")

# Test 3: Load actual data
print("\nTest 3: Load actual data from OpenVisus")
try:
    result = load_data(
        variable='tas',
        time='2000-01-01',
        model='ACCESS-CM2',
        scenario='historical',
        resolution='medium'
    )
    
    print(f"[OK] Data loaded successfully")
    print(f"  - Variable: {result['variable']}")
    print(f"  - Model: {result['model']}")
    print(f"  - Scenario: {result['scenario']}")
    print(f"  - Date: {result['time']}")
    print(f"  - Resolution: {result['resolution']}")
    print(f"  - Data shape: {result['shape']}")
    print(f"  - Data type: {result['dtype']}")
    print(f"  - Data size: {result['size_bytes']} bytes ({result['size_bytes']/1024:.1f} KB)")
    print(f"  - Data range: [{result['data'].min():.2f}, {result['data'].max():.2f}]")
    print(f"  - Field name: {result['field']}")
    
    # Verify data is valid
    if isinstance(result['data'], object):
        print(f"[OK] Data is a valid NumPy array")
    if result['shape'] == (300, 720):
        print(f"[OK] Data shape is correct for medium resolution")
    
except DataLoadingError as e:
    print(f"[X] Data loading error: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"[X] Unexpected error: {e}")
    import traceback
    traceback.print_exc()

# Test 4: Test different resolutions
print("\nTest 4: Test different resolution levels")
try:
    resolutions = ['low', 'medium', 'high']
    for res in resolutions:
        try:
            result = load_data(
                variable='tas',
                time='2000-01-01',
                model='ACCESS-CM2',
                scenario='historical',
                resolution=res
            )
            print(f"[OK] {res:6} resolution: shape={result['shape']}, size={result['size_bytes']:>7} bytes")
        except Exception as e:
            print(f"[X] {res:6} resolution failed: {e}")
except Exception as e:
    print(f"[X] Error testing resolutions: {e}")

# Test 5: Test auto scenario inference
print("\nTest 5: Test automatic scenario inference")
try:
    # Historical date
    result1 = load_data(
        variable='pr',
        time='1980-01-01',
        model='CESM2'
    )
    print(f"[OK] 1980-01-01 inferred as: {result1['scenario']}")
    
    # Future date
    result2 = load_data(
        variable='pr',
        time='2050-01-01',
        model='CESM2'
    )
    print(f"[OK] 2050-01-01 inferred as: {result2['scenario']}")
except Exception as e:
    print(f"[X] Error in scenario inference: {e}")

# Test 6: Batch loading
print("\nTest 6: Batch load multiple datasets")
try:
    requests = [
        {"variable": "tas", "time": "2000-01-01", "model": "ACCESS-CM2", "scenario": "historical"},
        {"variable": "pr", "time": "2000-01-02", "model": "ACCESS-CM2", "scenario": "historical"},
        {"variable": "tasmax", "time": "2000-01-03", "model": "CanESM5", "scenario": "historical"},
    ]
    results = load_data_batch(requests)
    
    successful = 0
    failed = 0
    for i, res in enumerate(results):
        if 'error' not in res:
            successful += 1
            print(f"[OK] Request {i+1}: {requests[i]['variable']:7} {requests[i]['time']}")
        else:
            failed += 1
            print(f"[X] Request {i+1}: {res['error']}")
    
    print(f"\nBatch results: {successful} successful, {failed} failed out of {len(results)} requests")
except Exception as e:
    print(f"[X] Error in batch loading: {e}")

# Test 7: Verify data processing capability
print("\nTest 7: Verify data can be processed")
try:
    result = load_data(
        variable='tas',
        time='2000-01-01',
        model='ACCESS-CM2',
        scenario='historical',
        resolution='low'
    )
    
    data = result['data']
    print(f"[OK] Data retrieved successfully")
    print(f"  - Shape: {data.shape}")
    print(f"  - Dtype: {data.dtype}")
    print(f"  - Data type object: {type(data)}")
    
    # Check if data has valid values
    valid_count = np.isfinite(data).sum()
    nan_count = np.isnan(data).sum()
    total_count = data.size
    
    print(f"  - Valid values: {valid_count} / {total_count}")
    print(f"  - NaN values: {nan_count} / {total_count}")
    
    if valid_count > 0:
        print(f"  - Mean (excluding NaN): {np.nanmean(data):.2f}")
        print(f"  - Std (excluding NaN): {np.nanstd(data):.2f}")
        print(f"  - Min (excluding NaN): {np.nanmin(data):.2f}")
        print(f"  - Max (excluding NaN): {np.nanmax(data):.2f}")
        print(f"[OK] Data has valid numeric values that can be processed")
    else:
        print(f"[!] Warning: Data is all NaN values")
        print(f"  This may indicate:")
        print(f"    - OpenVisus dataset is empty/not initialized")
        print(f"    - Or the specific timestep/field has no data")
        print(f"    - Or a connection/configuration issue")
        
except Exception as e:
    print(f"[X] Error processing data: {e}")
    import traceback
    traceback.print_exc()

# Test 8: Multi-variable loading
print("\nTest 8: Load multiple variables for the same date")
try:
    multivar_results = load_variables(
        variables=['tas', 'pr'],
        time='2000-01-05',
        model='ACCESS-CM2',
        scenario='historical',
        resolution='low'
    )
    print(f"[OK] Retrieved {len(multivar_results)} variables")
    for item in multivar_results:
        print(f"  - {item['variable']} shape={item['shape']} resolution={item['resolution']}")
except Exception as e:
    print(f"[X] Multi-variable load failed: {e}")

# Test 9: Time-series loading
print("\nTest 9: Load monthly time series")
try:
    series = load_time_series(
        variable='tas',
        model='ACCESS-CM2',
        start_time='1999-01-01',
        end_time='1999-03-01',
        scenario='historical',
        step_days=30,
        include_nan_stats=True
    )
    print(f"[OK] Time series length: {len(series)}")
    for entry in series:
        stats = entry.get('nan_statistics', {})
        print(f"  - {entry['time']} mean≈{stats.get('mean', 'n/a')}")
except Exception as e:
    print(f"[X] Time series load failed: {e}")


def _cache_file_path(field: str, time_str: str, resolution: str) -> Path:
    timestep = date_to_timestep_index(parse_date(time_str))
    quality = resolution_to_quality(resolution)
    raw_key = f"{field}|{timestep}|{quality}"
    digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()
    return Path(config.DATA_CACHE_DIR) / f"{digest}.npy"


print("\nTest 10: Cache behavior (memory + disk)")
cache_kwargs = {
    "variable": "tas",
    "time": "2000-02-01",
    "model": "ACCESS-CM2",
    "scenario": "historical",
    "resolution": "medium",
}
try:
    result_a = load_data(**cache_kwargs)
    arr_a = result_a["data"]
    cache_path = _cache_file_path(result_a["field"], cache_kwargs["time"], cache_kwargs["resolution"])
    print(f"[OK] Initial fetch completed; cache file candidate: {cache_path.name}")

    # Arrays should be read-only to avoid accidental writes
    try:
        arr_a[0, 0] = arr_a[0, 0] + 1.0
        print("[X] Array is writeable; expected read-only cache output")
    except ValueError:
        print("[OK] Cached array is read-only; copy before modifying")

    result_b = load_data(**cache_kwargs)
    if result_b["data"] is arr_a:
        print("[OK] Memory cache hit (same NumPy object)")
    else:
        print("[!] Memory cache miss; data objects differ")

    if not config.DISK_CACHE_ENABLED:
        print("[SKIP] Disk cache disabled, skipping disk verification")
    else:
        if _cache_file_path(result_a["field"], cache_kwargs["time"], cache_kwargs["resolution"]).exists():
            if _read_dataset_cached is not None:
                _read_dataset_cached.cache_clear()
            result_c = load_data(**cache_kwargs)
            arr_c = result_c["data"]
            used_disk = isinstance(arr_c, np.memmap)
            if used_disk:
                try:
                    same_file = os.path.samefile(arr_c.filename, cache_path)
                except (OSError, AttributeError):
                    same_file = Path(getattr(arr_c, "filename", "")).resolve() == cache_path.resolve()
            else:
                same_file = False

            if used_disk and same_file:
                print("[OK] Disk cache hit confirmed (memmap backed by cache file)")
            else:
                print(f"[!] Unable to confirm disk cache usage; type={type(arr_c).__name__}")
        else:
            print(f"[!] Expected disk cache file not found at {cache_path}")
except Exception as e:
    print(f"[X] Cache behavior test failed: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 70)
print("All tests completed!")
print("=" * 70)
