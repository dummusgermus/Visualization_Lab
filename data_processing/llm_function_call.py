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
    "switch_to_compare_mode": ui_state_updater.switch_to_compare_mode,
    "switch_to_explore_mode": ui_state_updater.switch_to_explore_mode,
    "switch_to_chart_view": ui_state_updater.switch_to_chart_view,
    "update_color_palette": ui_state_updater.update_color_palette,
}


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
            # Merge the result into updated state
            updated_state.update(result)
            
        except (ValueError, utils.ParameterValidationError) as e:
            error_msg = f"{func_name}: {str(e)}"
            print(f"ERROR - {error_msg}")
            errors.append(error_msg)
        except TypeError as e:
            error_msg = f"{func_name}: Invalid arguments - {str(e)}"
            print(f"ERROR - {error_msg}")
            errors.append(error_msg)
        except Exception as e:
            error_msg = f"{func_name}: Unexpected error - {str(e)}"
            print(f"ERROR - {error_msg}")
            errors.append(error_msg)
    
    return updated_state, errors


def _build_system_prompt(context: Optional[dict] = None) -> str:
    """
    Controller prompt: decide whether to call tools (change UI/data) or explain current view.
    If tools are called, an explainer LLM will run afterwards with updated frontend state.
    """

    system_parts = [
        "You are the controller for PolyOracle, a climate visualization web app.",
        "Your job is to either (A) call tools to update the app state, OR (B) explain the CURRENT view.",
        "Reply in English only.",
        "",
        "CRITICAL: Do NOT output internal reasoning (no 'THOUGHT', no hidden steps).",
        "",
        "== MODE SELECTION ==",
        "1) If the user's request would CHANGE the displayed data or view, you MUST call the appropriate tool(s).",
        "2) If the user's request is ONLY asking to interpret/understand what is currently shown, you MUST NOT call tools and should answer normally.",
        "",
        "A request counts as a DATA/VIEW CHANGE if it asks to change ANY of:",
        "- variable (e.g., tas -> pr, tasmax, etc.)",
        "- date/year/time range",
        "- scenario (historical/ssp245/ssp370/ssp585)",
        "- model selection",
        "- switching Explore vs Compare vs Chart view",
        "- location (city/coordinates/point) or 'at/in <place>'",
        "- palette (viridis/thermal/magma/cividis)",
        "",
        "If the request can be answered without changing any of those, explain only using the context (the current state of the application) (no tools).",
        "If youre explaining pay attention to the variable, model, scenario, date, location and values such as min/max/average shown.",
        "If the 'canvasView' is 'chart', pay attention to the chart mode (single/range) and if a state variable has 'chart' as prefix, ignore similar ones without the prefix. IGNORE 'mode'",
        "If the 'canvasView' is 'map', look at 'mode' (Explore/Compare) to determine which view youre in.",
        "== VIEW SELECTION RULES (when tools ARE needed) ==",
        "Use exactly ONE view switch tool per request:",
        "- If a specific LOCATION is mentioned -> switch_to_chart_view",
        "- If a TIME RANGE is requested (from X to Y) -> switch_to_chart_view(chart_mode='range')",
        "- If comparing exactly TWO scenarios/models/dates side-by-side on the MAP -> switch_to_compare_mode",
        "- Otherwise use switch_to_explore_mode for a single map view",
        "",
        "You may additionally call update_variable and/or update_color_palette together with the one view switch.",
        "Never call two different switch_to_* tools in the same request.",
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
        "User: 'Compare ssp245 vs ssp585 for 2050' -> tool call switch_to_compare_mode(compare_mode='Scenarios', scenario_a='ssp245', scenario_b='ssp585', date='2050-01-01').",
        "User: 'In Berlin, show temperature from 2020 to 2050' -> tool call switch_to_chart_view(location='Berlin', chart_mode='range', start_date='2020-01-01', end_date='2050-01-01', models=[...], scenarios=[...]).",
    ]

    if context:
        system_parts.extend(["", "Current State (JSON):", json.dumps(context, indent=2)])

    return "\n".join(system_parts)

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

        # Make request to Ollama
        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "tools": _get_state_control_functions(),
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
            if tool_calls:
                if(errors):
                    return ChatResponse(
                        message="; ".join(errors),
                        success=False,
                        error="Function call errors"
                    )
                    
                    assistant_message = "Function calls executed."
                
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

def get_llm_client():
    """Get or create the global LLM client instance (Ollama only)."""
    global _llm_client
    if _llm_client is None:
        # Always use Ollama
        base_url = os.environ.get("OLLAMA_URL", "http://ollama.warhol.informatik.rwth-aachen.de")
        model = os.environ.get("OLLAMA_MODEL", "llama3.3:70b")
        _llm_client = OllamaClient(base_url=base_url, model=model)
        print(f"Using Ollama at {base_url} with model {model}")

    return _llm_client

def process_chat_message(
    message: str,
    context: Optional[dict] = None,
    history: Optional[List[ChatMessage]] = None
) -> ChatResponse:
    """Process a chat message and return a response."""
    client = get_llm_client()
    return client.chat(message, context, history)

def _get_state_control_functions():
    """Define available functions for state manipulation."""
    return [
        {
            "type": "function",
            "function": {
                "name": "update_color_palette",
                "description": "Update the color palette used for visualization. Only use variables: viridis, thermal, magma, cividis.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "palette": {
                            "type": "string",
                            "enum": ["viridis", "thermal", "magma", "cividis"],
                            "description": "The color palette to use",
                        }
                    },
                    "required": ["palette"]
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
                "name": "switch_to_compare_mode",
                "description": "Switch to comparison mode to compare TWO specific scenarios, models, or dates side-by-side on the MAP. Use this for visual comparison of two specific items WITHOUT aggregation. DO NOT use if location is mentioned or if comparing MORE than 2 items or if aggregating multiple models/scenarios.",
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
                            "description": "Date in YYYY-MM-DD format (REQUIRED for Scenarios and Models mode). Examples: 2020-01-01, 2050-01-01, 1995-01-01. Use 4-digit year!"
                        },
                        "date_a": {
                            "type": "string",
                            "description": "First date in YYYY-MM-DD format (REQUIRED for Dates mode). Examples: 2020-01-01, 2050-01-01. Use 4-digit year!"
                        },
                        "date_b": {
                            "type": "string",
                            "description": "Second date in YYYY-MM-DD format (REQUIRED for Dates mode). Examples: 2030-01-01, 2060-01-01. Use 4-digit year!"
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
                "description": "Switch to explore mode to view a SINGLE model/scenario/date combination on the MAP. Whenever possible use this view. DO NOT use if location is mentioned. IMPORTANT: When date is 2015 or later, scenario MUST be ssp245/ssp370/ssp585. When date is before 2015, scenario MUST be historical. Date format is YYYY-MM-DD (e.g., 2020-01-01 NOT 20-20-01).",
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
                            "description": "Date in YYYY-MM-DD format. Examples: 2020-01-01 (year 2020), 2050-01-01 (year 2050), 1995-01-01 (year 1995). ALWAYS use 4-digit year, 2-digit month, 2-digit day with hyphens. Year 2015+ requires ssp245/ssp370/ssp585 scenario, before 2015 requires historical scenario."
                        }
                    },
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "switch_to_chart_view",
                "description": """Switch to CHART VIEW for time series and aggregations. Use this ONLY when:
1. A specific LOCATION is mentioned (e.g., 'in Berlin', 'at Search location', 'in Aachen')
2. User wants to compare/aggregate MULTIPLE models or scenarios (e.g., 'compare all scenarios', 'average of models')
3. User wants to see trends OVER TIME (e.g., 'from 2020 to 2050', 'temperature change over decades')

You NEED to specify a location and models in this function call.
If no location is specified and no location is set in the current state, set it to "World".
You CANNOT use historical with other scenarios in chart view. If historical is selected, it MUST be the ONLY scenario.
Same applies to scenarios: if multiple scenarios are selected, historical CANNOT be one of them.
DO NOT use for:
- Simple map viewing (use switch_to_explore_mode)
- Comparing only 2 specific items side-by-side on map (use switch_to_compare_mode)

Chart modes:
- 'single': Show data for a specific date with multiple models/scenarios
- 'range': Show data over a time range (requires start_date and end_date)""",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "enum": config.VALID_CHART_LOCATIONS,
                            "description": "Location for the chart (required if user mentions a location)"
                        },
                        "chart_mode": {
                            "type": "string",
                            "enum": config.VALID_CHART_MODES,
                            "description": "Chart mode: 'single' for one date, 'range' for time period"
                        },
                        "date": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format (for Single mode). Examples: 2020-01-01, 2050-01-01. Use 4-digit year!"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Start date in YYYY-MM-DD format (for Range mode). Examples: 2020-01-01, 1990-01-01. Use 4-digit year!"
                        },
                        "end_date": {
                            "type": "string",
                            "description": "End date in YYYY-MM-DD format (for Range mode). Examples: 2050-01-01, 2099-01-01. Use 4-digit year!"
                        },
                        "models": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": config.VALID_MODELS
                            },
                            "description": "List of models to include in chart. Use all models if user wants to see aggregation/comparison."
                        },
                        "scenarios": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": list(config.SCENARIO_METADATA.keys())
                            },
                            "description": "List of scenarios to include in chart. Historical can ONLY be selected by itself"
                        }
                    },
                    "required": ["chart_mode","models","scenarios","location"]
                }
            }
        }
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
