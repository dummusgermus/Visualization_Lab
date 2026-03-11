import configparser
import json
import os
from typing import Dict, List, Optional

import config
import requests
import ui_state_updater
import utils
from llm_chat import ChatMessage, ChatResponse

FUNCTION_REGISTRY: Dict[str, callable] = {
    "update_variable": ui_state_updater.update_variable,
    "update_unit": ui_state_updater.update_unit,
    "update_color_palette": ui_state_updater.update_color_palette,
    "update_masks": ui_state_updater.update_masks,
    "switch_to_compare_mode": ui_state_updater.switch_to_compare_mode,
    "switch_to_explore_mode": ui_state_updater.switch_to_explore_mode,
    "switch_to_chart_view": ui_state_updater.switch_to_chart_view,
    "switch_to_ensemble_mode": ui_state_updater.switch_to_ensemble_mode,
    "toggle_split_view": ui_state_updater.toggle_split_view,
    "set_map_location": ui_state_updater.set_map_location,
}


def _format_user_friendly_error(func_name: str, error_msg: str) -> str:
    """Convert technical error messages to user-friendly messages with valid options."""
    error_lower = error_msg.lower()

    # Invalid location
    if "invalid location" in error_lower:
        valid_locations = ", ".join(config.VALID_CHART_LOCATIONS)
        return (
            f"The location you specified is not available. "
            f"Valid options are: {valid_locations}. "
            f"Use 'Search' to find a specific city or 'Point' to select on the map."
        )

    # Invalid variable
    if "invalid variable" in error_lower:
        valid_vars = []
        for var, meta in config.VARIABLE_METADATA.items():
            valid_vars.append(f"{var} ({meta['name']})")
        return (
            f"The variable you specified is not available. "
            f"Valid options are: {', '.join(valid_vars)}"
        )

    # Invalid scenario
    if "invalid scenario" in error_lower:
        valid_scenarios = []
        for scenario, meta in config.SCENARIO_METADATA.items():
            valid_scenarios.append(f"{scenario} ({meta['period']})")
        return (
            f"The scenario you specified is not available. "
            f"Valid options are: {', '.join(valid_scenarios)}"
        )

    # Invalid model
    if "invalid model" in error_lower:
        return (
            f"The model you specified is not available. "
            f"Valid models are: {', '.join(config.VALID_MODELS)}"
        )

    # Invalid chart mode
    if "invalid chart_mode" in error_lower:
        return (
            f"The chart mode you specified is not available. "
            f"Valid options are: 'single' (for one date) or 'range' (for a time period)"
        )

    # Invalid palette
    if "invalid" in error_lower and "palette" in error_lower:
        return (
            f"The color palette you specified is not available. "
            f"Valid options are: viridis, thermal, magma, cividis"
        )

    # Date/scenario mismatch
    if "historical" in error_lower and ("2015" in error_lower or "scenario" in error_lower):
        return (
            f"Date and scenario don't match. "
            f"For dates before 2015, use 'historical'. "
            f"For dates 2015 and later, use 'ssp245', 'ssp370', or 'ssp585'."
        )

    # Default: return original but remove function name prefix
    if ": " in error_msg:
        return error_msg.split(": ", 1)[1]
    return error_msg


def execute_function_calls(tool_calls: list, current_state: dict) -> tuple[dict, list[str]]:
    """
    Execute multiple function calls from the LLM and merge results into state.
    
    Args:
        tool_calls: List of tool calls from LLM with function name and arguments
        current_state: Current application state
    
    Returns:
        (updated_state, errors) tuple with merged state and any error messages
    """
    updated_state = current_state.copy()
    errors = []
    
    for tool_call in tool_calls:
        func_name = tool_call["function"]["name"]
        arguments = tool_call["function"]["arguments"]
        arguments = json.loads(arguments) if isinstance(arguments, str) else arguments
        
        if func_name not in FUNCTION_REGISTRY:
            errors.append(f"Unknown function: {func_name}")
            continue
        
        try:
            func = FUNCTION_REGISTRY[func_name]
            print(f"Executing {func_name} with arguments {arguments}")
            # Special handling for update_date which needs current scenario
            if func_name == "update_date":
                arguments["scenario"] = updated_state.get("scenario", "historical")
            
            # Pass current state to all functions via _current_state
            arguments["_current_state"] = updated_state
            
            # Call the function from ui_state_updater
            result = func(**arguments)
            print(f"Result from {func_name}: {result}")
            # Deep-merge 'window2' so multiple function calls don't overwrite each other's W2 fields
            if "window2" in result and isinstance(result.get("window2"), dict) and isinstance(updated_state.get("window2"), dict):
                merged_w2 = {**updated_state["window2"], **result["window2"]}
                updated_state.update({k: v for k, v in result.items() if k != "window2"})
                updated_state["window2"] = merged_w2
            else:
                updated_state.update(result)
            
        except (ValueError, utils.ParameterValidationError) as e:
            error_msg = str(e)
            print(f"ERROR - {func_name}: {error_msg}")
            user_friendly_msg = _format_user_friendly_error(func_name, error_msg)
            errors.append(user_friendly_msg)
        except TypeError as e:
            error_msg = f"Invalid arguments - {str(e)}"
            print(f"ERROR - {func_name}: {error_msg}")
            user_friendly_msg = _format_user_friendly_error(func_name, error_msg)
            errors.append(user_friendly_msg)
        except Exception as e:
            error_msg = f"Unexpected error - {str(e)}"
            print(f"ERROR - {func_name}: {error_msg}")
            user_friendly_msg = _format_user_friendly_error(func_name, error_msg)
            errors.append(user_friendly_msg)
    
    return updated_state, errors


def _build_system_prompt(context: Optional[dict] = None) -> str:
    """
    Controller prompt: decide whether to call tools (change UI/data) or explain current view.
    If tools are called, an explainer LLM will run afterwards with updated frontend state.
    """

    system_parts = [
        "You are the controller for Polyoracle, a climate visualization web app.",
        "Polyoracle uses the nex-gddp-cmip6 dataset to show climate model data.",
        "Your job is to either (A) call tools to update the app state, OR (B) explain the CURRENT view.",
        "IMPORTANT: You have FULL capability to switch scenarios, activate ensemble mode, change variables, compute probabilities, and more. NEVER tell the user you cannot do something that the tools support.",
        "If you're explaining, use the current mode and data shown to answer the user, so if you're currently in ensemble mode use the state variables for that.",
        "States without prefixes are usually for explore or compare. All other states have the prefix of the view they belong to (e.g., ensembleVariable is for ensemble view).",
        "Reply in the language of the user message.",
        "",
        "CRITICAL: Do NOT output internal reasoning (no 'THOUGHT', no hidden steps).",
        "",
        "== MODE SELECTION ==",
        "1) If the user's request would CHANGE the displayed data or view, you MUST call the appropriate tool(s). Do NOT explain instead of acting.",
        "2) If the user's request is ONLY asking to interpret/understand what is currently shown, answer normally without tools.",
        "3) If unsure whether to act or explain: DEFAULT TO ACTING with tools — never refuse a data change request.",
        "",
        "A request counts as a DATA/VIEW CHANGE if it asks to change ANY of:",
        "- variable (e.g., tas -> pr, tasmax, etc.)",
        "- unit (e.g., K -> °C/°F for temperature)",
        "- date/year/time range",
        "- scenario (historical/ssp245/ssp370/ssp585)",
        "- model selection",
        "- switching Explore vs Compare vs Ensemble vs Chart view",
        "- location (city/coordinates/point) or 'at/in <place>'",
        "- color_palette (viridis/thermal/magma/cividis)",
        "- applying or changing value masks",
        "- probability/likelihood/uncertainty queries",
        "- opening a range/time-series panel for a location ON THE MAP (set_map_location)",
        "If the request can be answered without changing any of those, explain using the context only.",
        "If you're explaining, pay attention to the variable, model, scenario, date, location and values such as min/max/average shown.",
        "If the 'canvasView' is 'chart', pay attention to the chart mode (single/range) and if a state variable has 'chart' as prefix, ignore similar ones without the prefix. IGNORE 'mode'.",
        "If the 'canvasView' is 'map', look at 'mode' (Explore/Compare/Ensemble) to determine which view you're in.",
        "",
        "== VIEW SELECTION RULES (when tools ARE needed) ==",
        "Use exactly ONE view switch tool per request:",
        "- If the user wants a FULL CHART VIEW for a location (canvasView switches to 'Chart') -> switch_to_chart_view. Use when: 'show chart', 'chart view', 'plot for <city>', 'timeseries for <city>'. This CHANGES the entire canvas to chart mode.",
        "- If a TIME RANGE is requested (from X to Y) and chart/plot view is needed (not just a map overlay) -> switch_to_chart_view(chart_mode='range').",
        "- If the user is in MAP VIEW and mentions a city/location they want to SELECT on the map (to see its info panel or range overlay WITHOUT leaving map view) -> set_map_location. Use when: 'show me Aachen', 'select Berlin', 'show the range/variation at Aachen', 'show data for Paris on the map'. If split view is active and the location should be set in both windows, use windows=[1,2].",
        "- If the user wants a TIME RANGE panel for a location on the MAP -> set_map_location(show_range_view=True, range_start=..., range_end=...). This keeps the map view and adds a range chart overlay.",
        "- If the user asks about PROBABILITY, LIKELIHOOD, CHANCE, or HOW LIKELY a certain value is (e.g., 'where is there a 30% chance of temperatures above 30°C?') -> call switch_to_ensemble_mode and pass the masks DIRECTLY via the 'masks' parameter of that same call. Do NOT call update_masks separately for probability queries.",
        "- If multiple models or scenarios should be shown TOGETHER on the MAP (e.g., 'all models', 'all scenarios', 'average of models', 'model agreement') -> switch_to_ensemble_mode",
        "  * Use the 'statistic' parameter: 'mean' (default/average), 'std' (uncertainty/spread), 'median', 'iqr', 'percentile', 'extremes'.",
        "- If the user wants TWO INDEPENDENT maps visible AT THE SAME TIME (side by side, next to each other, split screen, dual view, two windows, two maps), showing each map in FULL without subtracting one from the other -> toggle_split_view(enable=True, ...)",
        "  * Trigger phrases: 'side by side', 'next to each other', 'both at the same time', 'simultaneously', 'split screen', 'two maps', 'dual view', 'show both', 'compare [X] with [Y] on the map', 'show [X] and [Y] at the same time'.",
        "  * Window 1 keeps all current settings. Only specify parameters for Window 2 (the thing that differs).",
        "- If comparing TWO scenarios/models/dates as a DIFFERENCE map (one single map showing what changed, e.g. 'how much warmer', 'anomaly', 'difference') -> switch_to_compare_mode",
        "  * compare_mode is NOT a split view — it produces a single blended/difference map, not two separate windows.",
        "- If a SINGLE model/scenario/date is requested (no location, no ensemble) -> switch_to_explore_mode",
        "- To close the split view -> toggle_split_view(enable=False)",
        "",
        "You may additionally call update_variable and/or update_color_palette and/or update_unit and/or update_masks together with the one view switch.",
        "Do not ignore the user's request to change variable or palette or unit if mentioned. Execute each of these functions as needed.",
        "COLOR PALETTES IN SPLIT VIEW: When the user asks for an 'appropriate' or 'suitable' color map/palette and split view is active (or being activated), you MUST call update_color_palette TWICE — once with window=1 and once with window=2 — using a palette that semantically fits each variable. Suggested defaults: temperature variables (tas/tasmin/tasmax) -> thermal or magma; precipitation (pr) -> viridis; wind (sfcWind) -> cividis; humidity (hurs) -> viridis. Never skip the color palette calls when the user explicitly requests them.",
        "Never call two different switch_to_* tools in the same request.",
        "",
        "== MASK RULES ==",
        "- For probability masks in ENSEMBLE mode: pass masks DIRECTLY in the 'masks' parameter of switch_to_ensemble_mode. Do NOT call update_masks separately.",
        "- To add/change masks in an already-active view (Explore, Compare, or binary masks): call update_masks.",
        "- Each mask must have a unique ID. If updating an existing mask, use its current ID; otherwise assign a new unique ID.",
        "- 'kind'='binary' (default): hides pixels whose value is outside [lowerBound, upperBound]. Use a very small number for no lower bound, a very large number for no upper bound.",
        "- 'kind'='probability' (ENSEMBLE MODE ONLY): shows how likely a condition is across models.",
        "  * lowerBound/upperBound define the VALUE CONDITION (e.g., temperature > 10°C → lowerBound=10, upperBound=1e9).",
        "  * probabilityThreshold (0.0-1.0) is the MINIMUM FRACTION of ensemble members that must satisfy the condition for the pixel to be shown. E.g. 0.2 = at least 20% of models.",
        "  * MULTIPLE probability masks with DIFFERENT variables are supported — each is checked independently, a pixel is shown only if ALL pass their threshold (AND logic).",
        "- Use values that make sense for the variable. IMPORTANT unit hints:",
        "  * tas/tasmin/tasmax: use 'Celsius (°C)', typical range -40 to +50 °C.",
        "  * pr (precipitation): use 'mm/day', typical range 0 to 20 mm/day. NEVER use 'kg', 'kg/m2', 'kg m-2 s-1' or 'mm/day' variants with spaces.",
        "  * sfcWind: use 'm/s', typical range 0 to 20 m/s.",
        "  * hurs: use 'Percent (%)', range 0 to 100.",
        "",
        "== DATE & SCENARIO RULES (when setting/choosing dates) ==",
        "- Dates must be YYYY-MM-DD.",
        "- If user gives only a year, convert to YYYY-01-01 (e.g., 2050 -> 2050-01-01).",
        "- If date/year < 2015: scenario MUST be historical.",
        "- If date/year >= 2015: scenario MUST be ssp245/ssp370/ssp585 (default to ssp245 if not specified).",
        "",
        "== OUTPUT RULES ==",
        "- If you call tools: keep your normal text content minimal, e.g. 'Updating the view.' Summarize in the message what you did (DO NOT MENTION FUNCTION NAMES)",
        "- If you do NOT call tools: give a direct explanation answering the user.",
        "- Only call tools that exist and only use allowed values (see tool parameter enums).",
        "",
        "== EXAMPLES ==",
        "User: 'What am I looking at?' -> explain only (no tools).",
        "User: 'Switch to tasmax' -> tool call update_variable(variable='tasmax') (+ view switch only if needed).",
        "User: 'Show 2050' -> tool call switch_to_explore_mode(date='2050-01-01', scenario='ssp245').",
        "User: 'Show me Aachen / select Aachen' (in map view) -> set_map_location(location_name='Aachen', windows=[1]).",
        "User: 'Show the yearly variation of temp/precip in Aachen (side by side)' -> toggle_split_view(enable=True, variable='pr') + update_variable(variable='tas') + set_map_location(location_name='Aachen', windows=[1,2], show_range_view=True).",
        "User: 'Show temp and precip side by side with appropriate color maps' -> toggle_split_view(enable=True, variable='pr') + update_variable(variable='tas') + update_color_palette(color_palette='thermal', window=1) + update_color_palette(color_palette='viridis', window=2).",
        "User: 'Show a range view for Paris on the map' -> set_map_location(location_name='Paris', windows=[1], show_range_view=True).",
        "User: 'In Berlin, show temperature from 2020 to 2050' (chart) -> switch_to_chart_view(location='Berlin', chart_mode='range', start_date='2020-01-01', end_date='2050-01-01', ...).",
        "User: 'Compare ssp245 vs ssp585 for 2050' -> tool call switch_to_compare_mode(compare_mode='Scenarios', scenario_a='ssp245', scenario_b='ssp585', date='2050-01-01').",
        "User: 'Show the difference between ssp245 and ssp585' -> switch_to_compare_mode (single difference map).",
        "User: 'Show ssp245 and ssp585 side by side' -> toggle_split_view(enable=True, scenario='ssp585') (two independent maps, NOT compare mode).",
        "User: 'Show tas and pr simultaneously' -> toggle_split_view(enable=True, variable='pr') (Window 1 keeps current variable, Window 2 shows pr).",
        "User: 'Compare temperature in 2030 and 2060 next to each other' -> toggle_split_view(enable=True, date='2060-01-01') (two maps, each showing their date).",
        "User: 'Give me a split screen with historical and ssp585' -> toggle_split_view(enable=True, scenario='ssp585').",
        "User: 'Close the split view' -> tool call toggle_split_view(enable=False).",
        "User: 'In Berlin, show temperature from 2020 to 2050' -> tool call switch_to_chart_view(location='Berlin', chart_mode='range', start_date='2020-01-01', end_date='2050-01-01', models=[...], scenarios=[...]).",
        "User: 'Where is there a 30% chance of temperature above 35°C in 2060?' -> switch_to_ensemble_mode(models=[all], scenarios=['ssp585'], date='2060-01-01', variable='tas', unit='Celsius (°C)', masks=[{id:1, kind:'probability', variable:'tas', unit:'Celsius (°C)', lowerBound:35, upperBound:1000000, probabilityThreshold:0.3}]).",
        "User: 'Find areas where potatoes can grow in 30 years, worst-case, 20% probability, temperature and precipitation' -> switch_to_ensemble_mode(models=[all], scenarios=['ssp585'], date='2055-07-01', variable='tas', unit='°C', masks=[{id:1, kind:'probability', variable:'tas', unit:'°C', lowerBound:10, upperBound:25, probabilityThreshold:0.2}, {id:2, kind:'probability', variable:'pr', unit:'mm/day', lowerBound:1.4, upperBound:6.0, probabilityThreshold:0.2}]). NOTE: for precipitation use 'mm/day' (typical range 0–20 mm/day), NOT 'kg m⁻² s⁻¹'.",
        "User: 'Show uncertainty in precipitation for 2050' -> switch_to_ensemble_mode(statistic='std', variable='pr', ...) (std deviation = uncertainty, no masks needed).",
    ]

    if context:
        system_parts.extend(["", "Current State (JSON):", json.dumps(context, indent=2)])

    return "\n".join(system_parts)


class OpenAICompatibleClient:
    """Client for OpenAI-compatible endpoints (e.g. KIconnect, Azure, OpenRouter)."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: int = 120
    ):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(
        self,
        message: str,
        context: Optional[dict] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> ChatResponse:
        """Send a chat message and get a response from an OpenAI-compatible endpoint."""

        if history is None:
            history = []

        messages = [
            {"role": "system", "content": _build_system_prompt(context)}
        ]
        for hist_msg in history:
            messages.append({"role": hist_msg.role, "content": hist_msg.content})

        # Build user message – with screenshot if provided
        screenshot_b64 = context.pop("screenshot", None) if context else None

        if screenshot_b64:
            user_content = [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{screenshot_b64}",  # ← jpeg statt png
                        "detail": "low"
                    }
                },
                {
                    "type": "text",
                    "text": message
                }
            ]
        else:
            user_content = message

        messages.append({"role": "user", "content": user_content})

        tools = _get_state_control_functions(context)

        # Debug: validate tool schema before sending
        try:
            tools_json = json.dumps(tools)
        except Exception as e:
            print(f"[ERROR] Tool schema serialization failed: {e}")
            tools = []

        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": False
        }

        print(f"[DEBUG] Sending request to {self.base_url}/chat/completions")
        print(f"[DEBUG] Payload size: {len(json.dumps(payload))} bytes")

        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.timeout
            )

            # Log response details before raising
            print(f"[DEBUG] Response status: {response.status_code}")
            if not response.ok:
                print(f"[DEBUG] Error response body: {response.text[:1000]}")

            response.raise_for_status()

            result = response.json()
            choice = result["choices"][0]
            assistant_message = choice["message"].get("content", "") or ""
            tool_calls_raw = choice["message"].get("tool_calls") or []

            tool_calls = [
                {
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"]
                    }
                }
                for tc in tool_calls_raw
            ]

            new_state, errors = execute_function_calls(tool_calls, context)

            if tool_calls:
                if errors:
                    # Return partial new_state even on errors so successful calls still apply
                    error_text = "; ".join(errors)
                    print(f"[WARN] Tool call errors (partial state still applied): {error_text}")
                    return ChatResponse(
                        message=assistant_message or error_text,
                        new_state=new_state if new_state != context else None,
                        success=bool(new_state and new_state != context),
                        error=error_text
                    )
                if not assistant_message:
                    assistant_message = "Changes applied."
                return ChatResponse(
                    message=assistant_message,
                    new_state=new_state,
                    success=True
                )

            if assistant_message:
                return ChatResponse(message=assistant_message, success=True)

            return ChatResponse(
                message="Sorry, I couldn't generate a response.",
                success=False,
                error="Empty response from API"
            )

        except requests.exceptions.Timeout:
            return ChatResponse(
                message="The request took too long. Please try again.",
                success=False,
                error="Request timeout"
            )
        except requests.exceptions.RequestException as e:
            error_detail = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_json = e.response.json()
                    raw_error = error_json.get('error', str(e))
                    # error field may be a dict instead of a string
                    error_detail = raw_error if isinstance(raw_error, str) else json.dumps(raw_error)
                    print(f"[DEBUG] API error response: {json.dumps(error_json, indent=2)}")
                except Exception:
                    error_detail = e.response.text[:500]
            return ChatResponse(
                message=f"Error communicating with API: {error_detail}",
                success=False,
                error=error_detail
            )
        except Exception as e:
            return ChatResponse(
                message=f"An unexpected error occurred: {str(e)}",
                success=False,
                error=str(e)
            )


class OllamaClient:
    """Client for RWTH Ollama server."""

    def __init__(
        self,
        base_url: str = "http://ollama.warhol.informatik.rwth-aachen.de",
        model: str = "llama3.3:70b",
        timeout: int = 60
    ):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def chat(
        self,
        message: str,
        context: Optional[dict] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> ChatResponse:
        """Send a chat message and get a response from Ollama."""

        if history is None:
            history = []

        # Build messages array
        messages = [
            {"role": "system", "content": _build_system_prompt(context)}
        ]

        # Add conversation history
        for hist_msg in history:
            messages.append({
                "role": hist_msg.role,
                "content": hist_msg.content
            })

        # Add current user message
        messages.append({
            "role": "user",
            "content": message
        })
        print(context)
        # Make request to Ollama
        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "tools": _get_state_control_functions(context),
                    "messages": messages,
                    "stream": False
                },
                timeout=200
            )
            response.raise_for_status()

            result = response.json()
            assistant_message = result.get("message", {}).get("content", "")
            message_result = result.get("message", {})
            tool_calls = message_result.get("tool_calls", [])
            new_state, errors = execute_function_calls(tool_calls, context)
            if tool_calls and tool_calls != []:
                if(errors):
                    return ChatResponse(
                        message="; ".join(errors),
                        success=False,
                        error="Function call errors"
                    )

                # Generate action message if LLM didn't provide one
                if not assistant_message:
                    assistant_message = "Changes applied."

                return ChatResponse(
                    message=assistant_message,
                    new_state=new_state,
                    success=True
                )
            
            if assistant_message: 
                return ChatResponse(
                    message=assistant_message,
                    success=True
                )
            
            return ChatResponse(
                message="Sorry, I couldn't generate a response.",
                success=False,
                error="Empty response from Ollama"
            )


        except requests.exceptions.Timeout:
            return ChatResponse(
                message="The request took too long. Please try again.",
                success=False,
                error="Request timeout"
            )
        except requests.exceptions.RequestException as e:
            error_detail = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_json = e.response.json()
                    error_detail = error_json.get('error', str(e))
                except:
                    pass

            return ChatResponse(
                message=f"Error communicating with Ollama: {error_detail}",
                success=False,
                error=error_detail
            )
        except Exception as e:
            return ChatResponse(
                message=f"An unexpected error occurred: {str(e)}",
                success=False,
                error=str(e)
            )

_llm_client = None

def _load_api_config(config_path: str = ".//data_processing//endpoint_config.ini") -> Optional[configparser.ConfigParser]:
    """Load API configuration from ini file. Returns None if file does not exist."""
    if not os.path.exists(config_path):
        print(f"No config file found at {config_path}. Skipping API config loading.")
        return None
    cfg = configparser.ConfigParser()
    cfg.read(config_path)
    print(f"Loaded API config from {config_path}: sections={cfg.sections()}")
    return cfg


def get_llm_client():
    """
    Get or create the global LLM client instance.
    
    Provider selection (in order of priority):
    1. LLM_PROVIDER env var ("openai" or "ollama")
    2. endpoint_config.ini present -> use OpenAI-compatible client
    3. Fallback -> Ollama
    """

    global _llm_client
    if _llm_client is not None:
        return _llm_client

    # Determine provider
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    provider = "kiconnect"

    print(f"LLM_PROVIDER env var: '{provider}'")

    # Try to load config file if no explicit provider set
    api_config = _load_api_config()

    if provider == "kiconnect" or (provider == "" and api_config is not None):
        # Use OpenAI-compatible client
        if api_config:
            base_url = api_config.get("api", "endpoint_url", fallback=None)
            api_key  = api_config.get("api", "api_key",      fallback=None)
            model    = api_config.get("api", "model",        fallback=None)

            print(f"Loaded API config from endpoint_config.ini: endpoint_url={base_url}, model={model}")
        else:
            base_url = None
            api_key  = None
            model    = None

        # Env vars override config file values
        base_url = os.environ.get("OPENAI_BASE_URL", base_url)
        api_key  = os.environ.get("OPENAI_API_KEY",  api_key)
        model    = os.environ.get("OPENAI_MODEL",    model)

        if not base_url or not api_key or not model:
            raise ValueError(
                "OpenAI-compatible client requires endpoint_url, api_key and model. "
                "Set them in endpoint_config.ini or via OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL env vars."
            )

        _llm_client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, model=model)
        print(f"Using OpenAI-compatible endpoint at {base_url} with model {model}")

    else:
        # Fallback: Ollama
        base_url = os.environ.get("OLLAMA_URL", "http://ollama.warhol.informatik.rwth-aachen.de")
        model    = os.environ.get("OLLAMA_MODEL", "llama3.3:70b")
        _llm_client = OllamaClient(base_url=base_url, model=model)
        print(f"Using Ollama at {base_url} with model {model}")

    return _llm_client


def set_model(new_model: str) -> None:
    """Hot-swap the model used by the global LLM client."""
    global _llm_client
    client = get_llm_client()
    if hasattr(client, "model"):
        print(f"[INFO] Switching model from '{client.model}' to '{new_model}'")
        client.model = new_model
    else:
        print("[WARN] Current client does not support model switching.")


def process_chat_message(
    message: str,
    context: Optional[dict] = None,
    history: Optional[List[ChatMessage]] = None
) -> ChatResponse:
    """Process a chat message and return a response."""
    client = get_llm_client()
    #print(call_gpt_with_parallel_tool_calling(client, model=client.model, messages=message, available_tools=_get_state_control_functions))
    return client.chat(message, context, history)

def _get_state_control_functions(context: Optional[dict] = None) -> List[dict]:
    current_variable = context.get("selectedVariable") if context else None  # fix: context uses 'selectedVariable' not 'variable'
    current_state = context if context else None

    # Safe unit list helper (units for the currently selected variable)
    def _unit_enum() -> List[str]:
        units = config.VARIABLE_UNIT_MAP.get(current_variable, [])
        if isinstance(units, list) and len(units) > 0:
            return units
        if isinstance(units, str) and units:
            return [units]
        return ["K"]

    # All units across every variable (for tools that also accept a variable parameter)
    def _all_units_enum() -> List[str]:
        seen = []
        for units in config.VARIABLE_UNIT_MAP.values():
            items = units if isinstance(units, list) else [units]
            for u in items:
                if u not in seen:
                    seen.append(u)
        return seen

    """Define available functions for state manipulation."""
    return [
        {
            "type": "function",
            "function": {
                "name": "update_color_palette",
                "description": (
                    "Update the color palette used for visualization. "
                    "Use window=1 (default) for the main/Window 1 map, window=2 for Window 2 in split view. "
                    "Call twice with different window values to set different palettes in each window."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "color_palette": {
                            "type": "string",
                            "enum": ["viridis", "thermal", "magma", "cividis"],
                            "description": "The color palette to use",
                        },
                        "window": {
                            "type": "integer",
                            "enum": [1, 2],
                            "description": "Which window to apply the palette to. 1 = main view (default), 2 = second window in split view."
                        }
                    },
                    "required": ["color_palette"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_variable",
                "description": "Change the climate variable being displayed",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "variable": {
                            "type": "string",
                            "enum": list(config.VARIABLE_METADATA.keys()),
                            "description": "The variable to display"
                        }
                    },
                    "required": ["variable"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_unit",
                "description": "Change the unit of the climate variable being displayed",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selectedUnit": {
                            "type": "string",
                            "enum": _unit_enum(),
                            "description": "The unit to display"
                        }
                    },
                    "required": ["selectedUnit"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "switch_to_compare_mode",
                "description": "Switch to comparison mode to compare TWO specific scenarios, models, or dates side-by-side on the MAP.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "compare_mode": {
                            "type": "string",
                            "enum": ["Scenarios", "Models", "Dates"],
                            "description": "What to compare"
                        },
                        "scenario_a": {
                            "type": "string",
                            "enum": list(config.SCENARIO_METADATA.keys()),
                            "description": "First scenario (for Scenarios mode)"
                        },
                        "scenario_b": {
                            "type": "string",
                            "enum": list(config.SCENARIO_METADATA.keys()),
                            "description": "Second scenario (for Scenarios mode)"
                        },
                        "model_a": {
                            "type": "string",
                            "enum": config.VALID_MODELS,
                            "description": "First model (for Models mode)"
                        },
                        "model_b": {
                            "type": "string",
                            "enum": config.VALID_MODELS,
                            "description": "Second model (for Models mode)"
                        },
                        "date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format (REQUIRED for Scenarios and Models mode)."
                        },
                        "date_a": {
                            "type": "string",
                            "description": "First date in YYYY-MM-DD format (REQUIRED for Dates mode)."
                        },
                        "date_b": {
                            "type": "string",
                            "description": "Second date in YYYY-MM-DD format (REQUIRED for Dates mode)."
                        }
                    },
                    "required": ["compare_mode"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "switch_to_explore_mode",
                "description": "Switch to explore mode to view a SINGLE model/scenario/date combination on the MAP.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "model": {
                            "type": "string",
                            "enum": config.VALID_MODELS,
                            "description": "The model to use"
                        },
                        "scenario": {
                            "type": "string",
                            "enum": list(config.SCENARIO_METADATA.keys()),
                            "description": "The scenario to use"
                        },
                        "date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format."
                        }
                    },
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "switch_to_ensemble_mode",
                "description": "Switch to ensemble mode to view a combination of MULTIPLE models and/or scenarios on the MAP. Also accepts optional 'masks' to apply probability or binary filters in the same call — ALWAYS pass masks here instead of calling update_masks separately.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "models": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": config.VALID_MODELS
                            },
                            "description": "The models to use"
                        },
                        "scenarios": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": list(config.SCENARIO_METADATA.keys())
                            },
                            "description": "The scenarios to use."
                        },
                        "unit": {
                            "type": "string",
                            "enum": _all_units_enum(),
                            "description": "The unit of measurement for the variable"
                        },
                        "date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format."
                        },
                        "variable": {
                            "type": "string",
                            "enum": list(config.VARIABLE_METADATA.keys()),
                            "description": "The climate variable to display"
                        },
                        "statistic": {
                            "type": "string",
                            "enum": ["mean", "std", "median", "iqr", "percentile", "extremes"],
                            "description": "The ensemble statistic to display. 'mean' = average across ensemble members (default), 'std' = standard deviation (spread/uncertainty), 'median' = median value, 'iqr' = interquartile range, 'percentile' = specific percentile, 'extremes' = min/max range."
                        },
                        "masks": {
                            "type": "array",
                            "description": "Optional masks to apply. For probability queries, ALWAYS pass masks here instead of calling update_masks separately.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "number", "description": "Unique mask identifier." },
                                    "lowerBound": { "type": "number", "description": "Lower bound for the value condition." },
                                    "upperBound": { "type": "number", "description": "Upper bound for the value condition." },
                                    "variable": { "type": "string", "enum": list(config.VARIABLE_METADATA.keys()), "description": "Variable this mask applies to." },
                                    "unit": { "type": "string", "enum": _all_units_enum(), "description": "Unit for the mask bounds." },
                                    "kind": { "type": "string", "enum": ["binary", "probability"], "description": "'binary': hide pixels outside bounds. 'probability': show pixels where enough ensemble members satisfy the condition." },
                                    "probabilityThreshold": { "type": "number", "description": "For kind='probability': minimum fraction (0.0–1.0) of ensemble members that must satisfy the condition. E.g. 0.2 = at least 20%." }
                                },
                                "required": ["id", "lowerBound", "upperBound", "variable", "unit"]
                            }
                        }
                    },
                    "required": ["models", "scenarios", "date", "variable", "unit"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_masks",
                "description": "Update the masks applied to the visualization to highlight specific value ranges.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "masks": {
                            "type": "array",
                            "description": "List of masks to apply.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {
                                        "type": "number",
                                        "description": "Unique identifier for the mask."
                                    },
                                    "lowerBound": {
                                        "type": "number",  # ← kein ["number","null"] - manche Endpoints mögen das nicht
                                        "description": "The lower bound value. Use a very small number for no lower bound."
                                    },
                                    "upperBound": {
                                        "type": "number",
                                        "description": "The upper bound value. Use a very large number for no upper bound."
                                    },
                                    "variable": {
                                        "type": "string",
                                        "enum": list(config.VARIABLE_METADATA.keys()),
                                        "description": "The climate variable this mask applies to."
                                    },
                                    "unit": {
                                        "type": "string",
                                        "enum": _all_units_enum(),
                                        "description": "The unit of measurement for the mask values."
                                    },
                                    "kind": {
                                        "type": "string",
                                        "enum": ["binary", "probability"],
                                        "description": "Mask type: 'binary' (default) hides pixels whose value is outside lowerBound..upperBound; 'probability' (Ensemble mode only) shows pixels where at least probabilityThreshold of ensemble members satisfy the value condition."
                                    },
                                    "statistic": {
                                        "type": "string",
                                        "enum": ["mean", "std", "median", "iqr", "percentile", "extremes"],
                                        "description": "Which ensemble statistic this mask is applied to. Only relevant when kind='probability' in Ensemble mode."
                                    },
                                    "probabilityThreshold": {
                                        "type": "number",
                                        "description": "Only for kind='probability': minimum fraction (0.0-1.0) of ensemble members that must satisfy the value condition for the pixel to be shown. E.g. 0.2 = at least 20% of models must predict the value within the bounds. Default: 0.5."
                                    }
                                },
                                "required": ["id", "lowerBound", "upperBound", "unit", "variable"]
                            }
                        }
                    },
                    "required": ["masks"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "toggle_split_view",
                "description": (
                    "Open or close a split map view that shows two FULL maps side by side in separate windows. "
                    "Use this whenever the user wants to see two maps at the same time — "
                    "trigger phrases include: 'side by side', 'next to each other', 'simultaneously', "
                    "'split screen', 'two maps', 'dual view', 'show both', 'both at the same time', "
                    "'open a second window', 'compare [X] with [Y] on the map'. "
                    "IMPORTANT: This is NOT the same as switch_to_compare_mode. "
                    "split view = two separate full maps each showing their own data. "
                    "compare mode = one single difference/anomaly map. "
                    "Window 1 always keeps the current main view settings unchanged. "
                    "Window 2 is independently configured via the parameters below — "
                    "only specify what should be DIFFERENT in Window 2. "
                    "To close the split view, call with enable=false."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "enable": {
                            "type": "boolean",
                            "description": "True to open split view, False to close it."
                        },
                        "scenario": {
                            "type": "string",
                            "enum": config.VALID_SCENARIOS,
                            "description": "Scenario for Window 2 (e.g. ssp585). If omitted, Window 2 inherits the current scenario."
                        },
                        "model": {
                            "type": "string",
                            "enum": config.VALID_MODELS,
                            "description": "Climate model for Window 2. If omitted, Window 2 inherits the current model."
                        },
                        "variable": {
                            "type": "string",
                            "enum": list(config.VARIABLE_METADATA.keys()),
                            "description": "Climate variable for Window 2. If omitted, Window 2 inherits the current variable."
                        },
                        "date": {
                            "type": "string",
                            "description": "Date for Window 2 in YYYY-MM-DD format. If omitted, Window 2 inherits the current date."
                        }
                    },
                    "required": ["enable"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_map_location",
                "description": (
                    "Geocode a place name and set it as the selected location on the map, "
                    "optionally opening the range view (time series chart) for that location. "
                    "Use this when the user mentions a city, region, or place name and wants to "
                    "see data at that location, e.g. 'show me Aachen', 'select Berlin', "
                    "'show the range view for Paris', 'show yearly variation in Tokyo'. "
                    "Can target Window 1, Window 2, or both. "
                    "To show a range/time-series chart: set show_range_view=true and supply "
                    "range_start/range_end dates."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location_name": {
                            "type": "string",
                            "description": "The name of the city, region, or place to geocode and select."
                        },
                        "windows": {
                            "type": "array",
                            "items": {"type": "integer", "enum": [1, 2]},
                            "description": "Which map windows to set the location in. Use [1] for Window 1 only, [2] for Window 2 only, [1,2] for both. Defaults to [1]."
                        },
                        "show_range_view": {
                            "type": "boolean",
                            "description": "Whether to open the time-series range chart overlay for the location. Defaults to true."
                        },
                        "range_start": {
                            "type": "string",
                            "description": "Start date for the range view in YYYY-MM-DD format. Omit unless the user explicitly requests a specific date range — the frontend will automatically use a sensible window around the current date."
                        },
                        "range_end": {
                            "type": "string",
                            "description": "End date for the range view in YYYY-MM-DD format. Omit unless the user explicitly requests a specific date range."
                        }
                    },
                    "required": ["location_name"]
                }
            }
        },
    ]


def test_function_calling():
    """Test the function calling with a sample query."""
    
    current_state = {
        "mode": "Explore",
        "scenario": "Historical",
        "variable": "tas",
        "model": "ACCESS-CM2",
        "date": "2000-01-01"
    }
    
    test_messages = [
        "Show me future temperature predictions",
        "Switch to precipitation data",
        "Can you show me the difference of each scenarios prediction between the years 2050 and 2060",
        "Hey, can you show me what the temperature will look like in 2050 under different scenarios?",
        "Hey, can you show me what the temperature will look like in 2050 for ssp370?",
        "Can you show the precipitation and with a fitting color?"
    ]
    
    client = get_llm_client()
    
    for msg in test_messages:
        print(f"\n{'='*60}")
        print(f"User: {msg}")
        print(f"{'='*60}")
        
        messages = [
            {"role": "system", "content": _build_system_prompt(current_state)},
            {"role": "user", "content": msg}
        ]
        
        try:
            response = requests.post(
                f"{client.base_url}/api/chat",
                json={
                    "model": client.model,
                    "messages": messages,
                    "tools": _get_state_control_functions(),
                    "stream": False
                },
                timeout=60
            )
            response.raise_for_status()
            result = response.json()
            
            # Debug: print full response
            print(f"\nFull response:")
            print(json.dumps(result, indent=2))
            
            message_result = result.get("message", {})
            tool_calls = message_result.get("tool_calls", [])
            
            if tool_calls:
                print(f"\nFunction calls:")
                for tool_call in tool_calls:
                    func_name = tool_call["function"]["name"]
                    func_args = tool_call["function"]["arguments"]
                    print(f"  - {func_name}({json.dumps(func_args, indent=2)})")
            else:
                print(f"\nNo function calls - Response: {message_result.get('content', 'N/A')}")
                
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    test_function_calling()
