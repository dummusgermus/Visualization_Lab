
import ast
from enum import Enum

import config
from utils import validate_date_for_scenario


def update_variable(**kwargs) -> dict:
    """Update variable from keyword arguments."""
    variable = kwargs.get('variable')
    if not variable or variable in ('None', 'null', None):
        raise ValueError("Variable is required")
    
    if variable not in config.VALID_VARIABLES:
        raise ValueError(f"Invalid variable: {variable}")

    unit = kwargs.get('unit')
    if unit not in config.VARIABLE_UNIT_MAP.get(variable, []):
        return {
            "variable": variable,
            "selectedUnit": config.VARIABLE_UNIT_MAP.get(variable)[0]  # Default to first unit if invalid
        }
    
    return {
        "variable": variable
    }

def update_unit(**kwargs) -> dict:
    """Update unit from keyword arguments."""
    unit = kwargs.get('selectedUnit')
    if not unit or unit in ('None', 'null', None):
        raise ValueError("Unit is required")
    
    return {
        "selectedUnit": unit
    }

def update_masks(**kwargs) -> dict:
    """Update value masks from keyword arguments."""
    current_state = kwargs.get('_current_state', {})
    curr_masks = current_state.get('masks', [])

    masks_str = kwargs.get('masks')
    if not masks_str or masks_str in ('None', 'null', None):
        raise ValueError("Masks are required")
    
    mask_index = {m.get("id"): i for i, m in enumerate(curr_masks)}
    for mask in masks_str:
        mask_id = mask.get("id")
        if mask_id in mask_index:
            curr_masks[mask_index[mask_id]] = mask
        else:
            curr_masks.append(mask)
            mask_index[mask_id] = len(curr_masks) - 1

    return {
        "masks": curr_masks 
    }

def update_color_palette(**kwargs) -> dict:
    """Update color palette from keyword arguments."""
    color_palette = kwargs.get('color_palette')
    if not color_palette or color_palette in ('None', 'null', None):
        raise ValueError("Color palette is required")
    
    return {
        "colorPalette": color_palette
    }

def update_unit(**kwargs) -> dict:
    """Update unit from keyword arguments."""
    unit = kwargs.get('selectedUnit')
    if not unit or unit in ('None', 'null', None):
        raise ValueError("Unit is required")
    
    return {
        "selectedUnit": unit
    }

def switch_to_ensemble_mode(**kwargs) -> dict:
    """Switch to ensemble mode from keyword arguments."""
    current_state = kwargs.get('_current_state', {})
    scenarios = kwargs.get('scenarios')
    models = kwargs.get('models')
    unit = kwargs.get('unit')
    date = kwargs.get('date')
    variable = kwargs.get('variable')

    scenarios = None if scenarios in ('None', 'null', None) else scenarios
    models = None if models in ('None', 'null', None) else models
    date = None if date in ('None', 'null', None) else date
    unit = None if unit in ('None', 'null', None) else unit
    variable = None if variable in ('None', 'null', None) else variable

    if not scenarios:
        scenarios = current_state.get('selectedScenarios') or current_state.get('scenarios')
    if not models:
        models = current_state.get('selectedModels') or current_state.get('models')
    if not date:
        date = current_state.get('selectedDate') or current_state.get('date')
    if not unit:
        unit = current_state.get('selectedUnit') or current_state.get('unit')
    if not variable:
        variable = current_state.get('variable') or current_state.get('variable')
    if not scenarios:
        raise ValueError("At least one scenario is required for ensemble mode")
    if not models:
        raise ValueError("At least one model is required for ensemble mode")
    if not date:
        raise ValueError("Date is required for ensemble mode")
    
    print("Ensemble scenarios before normalization:", scenarios)
    scenarios = [s.lower() for s in scenarios]
    if parseDateToYear(date) < 2015:
        scenarios = ['historical']
    else:
        scenarios = [s for s in scenarios if s.lower() != 'historical']
    print("Ensemble scenarios after normalization:", scenarios)
    print("Ensemble date:", date)
    for scenario in scenarios:
        validate_date_for_scenario(date, scenario)


    return {
        "canvasView": "map",
        "mode": "Ensemble",
        "selectedScenarios": scenarios,
        "selectedModels": models,
        "selectedDate": date,
        "selectedUnit": unit,
        "variable": variable
    }

class CompareMode(Enum):
    MODEL = "Models"
    SCENARIO = "Scenarios"
    DATE = "Dates"


def _validate_compare_mode_parameters(
    compare_mode: str,
    scenario_a: str = None,
    scenario_b: str = None,
    model_a: str = None,
    model_b: str = None,
    date_a: str = None,
    date_b: str = None,
    date: str = None
) -> None:
    """Validate parameters for the specified compare mode."""

    # Normalize scenarios to lowercase (LLM returns "Historical", config uses "historical")
    if scenario_a:
        scenario_a = scenario_a.lower()
    if scenario_b:
        scenario_b = scenario_b.lower()

    compare_mode_enum = CompareMode(compare_mode)
    
    match compare_mode_enum:
        case CompareMode.SCENARIO:
            # Validate scenarios
            if scenario_a and scenario_a not in config.SCENARIO_METADATA:
                raise ValueError(f"Invalid scenario_a: {scenario_a}")
            if scenario_b and scenario_b not in config.SCENARIO_METADATA:
                raise ValueError(f"Invalid scenario_b: {scenario_b}")
            
            # Validate date if provided
            if date and scenario_a:
                validate_date_for_scenario(date, scenario_a)
        
        case CompareMode.MODEL:
            # Validate models
            if model_a and model_a not in config.VALID_MODELS:
                raise ValueError(f"Invalid model_a: {model_a}")
            if model_b and model_b not in config.VALID_MODELS:
                raise ValueError(f"Invalid model_b: {model_b}")
        
        case CompareMode.DATE:
            # Validate dates
            if date_a:
                year_a = int(date_a.split("-")[0])
                scenario = "historical" if year_a < 2015 else "ssp245"
                validate_date_for_scenario(date_a, scenario)
            
            if date_b:
                year_b = int(date_b.split("-")[0])
                scenario = "historical" if year_b < 2015 else "ssp245"
                validate_date_for_scenario(date_b, scenario)


def switch_to_compare_mode(**kwargs) -> dict:
    """Switch to compare mode with validation from keyword arguments."""
    current_state = kwargs.get('_current_state', {})

    compare_mode = kwargs.get('compare_mode')
    scenario_a = kwargs.get('scenario_a')
    scenario_b = kwargs.get('scenario_b')
    model_a = kwargs.get('model_a')
    model_b = kwargs.get('model_b')
    date_a = kwargs.get('date_a')
    date_b = kwargs.get('date_b')
    date = kwargs.get('date')
    
    scenario_a = None if scenario_a in ('None', 'null', None) else scenario_a
    scenario_b = None if scenario_b in ('None', 'null', None) else scenario_b
    model_a = None if model_a in ('None', 'null', None) else model_a
    model_b = None if model_b in ('None', 'null', None) else model_b
    date_a = None if date_a in ('None', 'null', None) else date_a
    date_b = None if date_b in ('None', 'null', None) else date_b
    date = None if date in ('None', 'null', None) else date
    
    if not date:
        date = current_state.get('selectedDate') or current_state.get('date')
    
    # Fill in missing model values from current state if in MODEL compare mode
    if compare_mode == 'Models':
        if not model_a:
            model_a = current_state.get('selectedModel') or current_state.get('model')
    
    # Fill in missing scenario values from current state if in SCENARIO compare mode  
    if compare_mode == 'Scenarios':
        if not scenario_a:
            scenario_a = current_state.get('selectedScenario') or current_state.get('scenario')

    # Normalize scenarios to lowercase (LLM returns "Historical", config uses "historical")
    if scenario_a:
        scenario_a = scenario_a.lower()
    if scenario_b:
        scenario_b = scenario_b.lower()

    if not compare_mode or compare_mode not in CompareMode._value2member_map_:
        raise ValueError(f"Invalid compare_mode: {compare_mode}. Valid: {[m.value for m in CompareMode]}")
    
    _validate_compare_mode_parameters(
        compare_mode, scenario_a, scenario_b, model_a, model_b, date_a, date_b, date
    )
    
    result = {
        "canvasView": "map",
        "mode": "Compare",
        "compareMode": compare_mode
    }
    
    compare_mode_enum = CompareMode(compare_mode)
    
    match compare_mode_enum:
        case CompareMode.SCENARIO:
            result["scenario1"] = scenario_a 
            result["scenario2"] = scenario_b
            if date:
                result["selectedDate"] = date
        
        case CompareMode.MODEL:
            result["model1"] = model_a
            result["model2"] = model_b
            if date:
                result["selectedDate"] = date
        
        case CompareMode.DATE:
            if date_a:
                result["date1"] = date_a
            if date_b:
                result["date2"] = date_b
    
    return result

def switch_to_explore_mode(**kwargs) -> dict:
    """Switch to explore mode from keyword arguments."""
    current_state = kwargs.get('_current_state', {})
    
    model = kwargs.get('model')
    scenario = kwargs.get('scenario')
    date = kwargs.get('date')
    
    # Convert string 'None'/'null' to actual None
    model = None if model in ('None', 'null', None) else model
    scenario = None if scenario in ('None', 'null', None) else scenario
    date = None if date in ('None', 'null', None) else date
    
    # Fill in missing parameters from current state
    if not model:
        model = current_state.get('selectedModel') or current_state.get('model')
    if not scenario:
        scenario = current_state.get('selectedScenario') or current_state.get('scenario')
    if not date:
        date = current_state.get('selectedDate') or current_state.get('date')
    
    # Validate after filling from current state
    if not model:
        raise ValueError("Model is required")
    if not scenario:
        raise ValueError("Scenario is required")
    if not date:
        raise ValueError("Date is required")

    # Normalize scenario to lowercase (LLM returns "Historical", config uses "historical")
    scenario = scenario.lower()

    if model not in config.VALID_MODELS:
        raise ValueError(f"Invalid model: {model}")
    if scenario not in config.SCENARIO_METADATA.keys():
        raise ValueError(f"Invalid scenario: {scenario}")

    validate_date_for_scenario(date, scenario)
    
    return {
        "canvasView": "map",
        "mode": "Explore",
        "selectedModel": model,
        "selectedScenario": scenario,
        "selectedDate": date
    }   

def switch_to_chart_view(**kwargs) -> dict:
    """Switch to chart view mode from keyword arguments."""
    current_state = kwargs.get('_current_state', {})

    location = kwargs.get('location')
    chart_mode = kwargs.get('chart_mode')
    chart_date = kwargs.get('date')
    start_date = kwargs.get('start_date')
    models = kwargs.get('models')
    end_date = kwargs.get('end_date')
    scenarios = kwargs.get('scenarios')
    
    # Convert string 'None'/'null' to actual None
    location = None if location in ('None', 'null', None) else location
    chart_mode = None if chart_mode in ('None', 'null', None) else chart_mode
    chart_date = None if chart_date in ('None', 'null', None) else chart_date
    scenarios = None if scenarios in ('None', 'null', None) else scenarios
    models = None if models in ('None', 'null', None) else models
    start_date = None if start_date in ('None', 'null', None) else start_date
    end_date = None if end_date in ('None', 'null', None) else end_date
    
    if not chart_mode:
        raise ValueError("chart_mode is required")
    if not location:
        raise ValueError("location is required")
    if chart_mode not in config.VALID_CHART_MODES:
        raise ValueError(f"Invalid chart_mode: {chart_mode}")
    if location not in config.VALID_CHART_LOCATIONS:
        raise ValueError(f"Invalid location: {location}")

    if not chart_date:
        chart_date = current_state.get('selectedDate') or current_state.get('date')

    if parseDateToYear(chart_date) < 2015:
        scenarios = ['historical']
    else:
        scenarios = [s for s in scenarios if s.lower() != 'historical']


    result = {
        "canvasView": "Chart",
        "chartMode": chart_mode,
        "location": location,
        "models": models,
        "scenarios": scenarios,
        "chartDate": chart_date,
        "date": None,
        "scenario": None,
        "model": None, 
        "mode": None,
    }
    
    if start_date:
        result["startDate"] = start_date
    if end_date:
        result["endDate"] = end_date
    
    return result

def parseDateToYear(date_str: str) -> int:
    """Parse date string to extract the year as an integer."""
    try:
        year = int(date_str.split("-")[0])
        return year
    except Exception as e:
        raise ValueError(f"Invalid date format: {date_str}") from e
