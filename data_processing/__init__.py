"""
NEX-GDDP-CMIP6 Data Preprocessing Module
Main entry point for the data preprocessing pipeline
"""

import os
import sys

# Ensure current directory is in path
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

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
    date_to_timestep_index,
    timestep_index_to_date,
)

__all__ = [
    'load_data',
    'load_data_batch',
    'load_time_series',
    'load_variables',
    'get_available_metadata',
    'ParameterValidationError',
    'DataLoadingError',
    'date_to_timestep_index',
    'timestep_index_to_date',
]
