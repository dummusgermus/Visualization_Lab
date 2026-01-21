"""LLM Chat integration for explaining climate data and configuration."""

from __future__ import annotations

import json
import os
from typing import List, Optional

import config
import requests
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single chat message."""
    role: str = Field(..., description="Role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    """Request for LLM chat completion."""
    message: str = Field(..., description="User's message")
    context: Optional[dict] = Field(None, description="Current application context")
    history: List[ChatMessage] = Field(default_factory=list, description="Chat history")


class ChatResponse(BaseModel):
    """Response from LLM chat."""
    message: str = Field(..., description="Assistant's response")
    new_state: Optional[dict] = Field(None, description="Updated application state if any")
    success: bool = Field(True, description="Whether the request succeeded")
    error: Optional[str] = Field(None, description="Error message if failed")


def _build_system_prompt(context: Optional[dict] = None) -> str:
    """Build system prompt with configuration and context information."""

    system_parts = [
        "Du bist ein hilfreicher Assistent für die Polyoracle Klimadatenvisualisierung.",
        "Du hilfst Nutzern dabei, Klimadaten zu verstehen und die Anwendung zu bedienen.",
        "",
        "# Verfügbare Klimavariablen:",
    ]

    # Add variable information
    for var, metadata in config.VARIABLE_METADATA.items():
        system_parts.append(
            f"- {var}: {metadata['name']} ({metadata['unit']}) - {metadata['description']}"
        )

    system_parts.extend([
        "",
        "# Verfügbare Klimamodelle:",
        ", ".join(config.VALID_MODELS),
        "",
        "# Verfügbare Szenarien:",
    ])

    # Add scenario information
    for scenario, metadata in config.SCENARIO_METADATA.items():
        system_parts.append(
            f"- {scenario} ({metadata['period']}): {metadata['description']}"
        )

    system_parts.extend([
        "",
        "# Anwendungsfunktionen:",
        "- Explore-Modus: Visualisierung einer einzelnen Variablen",
        "- Compare-Modus: Vergleich von Szenarien, Modellen oder Zeitpunkten",
        "- Karten-Ansicht: Globale räumliche Darstellung",
        "- Chart-Ansicht: Zeitreihenanalyse mit Single- und Range-Modus",
        "- Zeit-Slider: Navigation durch verschiedene Zeitpunkte",
        "- Einheitenkonvertierung: Umrechnung zwischen verschiedenen Einheiten",
        "- Standortsuche: Suche nach spezifischen geografischen Positionen",
        "",
        "# Wichtige Hinweise:",
        "- Antworte präzise und verständlich auf Deutsch",
        "- Erkläre wissenschaftliche Konzepte für ein allgemeines Publikum",
        "- Beziehe dich auf den aktuellen Kontext wenn verfügbar",
        "- Gib praktische Tipps zur Nutzung der Visualisierung",
        "- Wenn Datenstatistiken (min, max, mean) im Kontext vorhanden sind, nutze sie für konkrete Interpretationen",
        "- Bei Temperaturwerten: Konvertiere Kelvin zu Celsius für bessere Verständlichkeit (K - 273.15 = °C)",
    ])

    # Add current context if available
    if context:
        system_parts.extend([
            "",
            "# Aktueller Kontext:",
            json.dumps(context, indent=2, ensure_ascii=False)
        ])

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
                    "messages": messages,
                    "stream": False
                },
                timeout=self.timeout
            )
            response.raise_for_status()

            result = response.json()
            assistant_message = result.get("message", {}).get("content", "")

            if not assistant_message:
                return ChatResponse(
                    message="Entschuldigung, ich konnte keine Antwort generieren.",
                    success=False,
                    error="Empty response from Ollama"
                )

            return ChatResponse(
                message=assistant_message,
                success=True
            )

        except requests.exceptions.Timeout:
            return ChatResponse(
                message="Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.",
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
                message=f"Fehler bei der Kommunikation mit Ollama: {error_detail}",
                success=False,
                error=error_detail
            )
        except Exception as e:
            return ChatResponse(
                message=f"Ein unerwarteter Fehler ist aufgetreten: {str(e)}",
                success=False,
                error=str(e)
            )


# OpenAI and Mock clients removed - only Ollama is supported


# Global client instance
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
