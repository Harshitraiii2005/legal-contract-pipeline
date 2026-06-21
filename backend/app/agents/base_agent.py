"""Base agent with shared prompt construction, retry logic, and audit logging."""

from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from typing import Any

import structlog
from anthropic import Anthropic, APIError, RateLimitError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: Anthropic | None = None


def get_anthropic_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


class BaseAgent(ABC):
    """Abstract base for all pipeline agents."""

    agent_name: str = "base_agent"
    model: str = "claude-opus-4-6"
    max_tokens: int = 4096

    def __init__(self) -> None:
        self.log = get_logger(self.__class__.__name__)
        self.client = get_anthropic_client()

    # ------------------------------------------------------------------ #
    # Public interface                                                      #
    # ------------------------------------------------------------------ #

    def run(self, state: dict[str, Any]) -> dict[str, Any]:
        """Entry point called by LangGraph. Returns updated state slice."""
        run_id = str(uuid.uuid4())
        start = time.perf_counter()
        self.log.info("agent_start", agent=self.agent_name, run_id=run_id)

        try:
            result = self._execute(state)
            elapsed = time.perf_counter() - start
            self.log.info(
                "agent_complete",
                agent=self.agent_name,
                run_id=run_id,
                elapsed_ms=round(elapsed * 1000),
            )
            return result
        except Exception as exc:
            self.log.error(
                "agent_error",
                agent=self.agent_name,
                run_id=run_id,
                error=str(exc),
            )
            raise

    # ------------------------------------------------------------------ #
    # Abstract / override in subclasses                                     #
    # ------------------------------------------------------------------ #

    @abstractmethod
    def _execute(self, state: dict[str, Any]) -> dict[str, Any]:
        """Subclasses implement the actual logic here."""
        ...

    def _system_prompt(self) -> str:
        return (
            "You are a senior legal AI assistant specialised in contract risk analysis. "
            "Be precise, cite clause text verbatim when relevant, and return structured JSON "
            "unless instructed otherwise. Never hallucinate citations."
        )

    # ------------------------------------------------------------------ #
    # LLM helpers                                                          #
    # ------------------------------------------------------------------ #

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((RateLimitError, APIError)),
        reraise=True,
    )
    def _call_llm(
        self,
        user_prompt: str,
        system_override: str | None = None,
        temperature: float = 0.0,
        max_tokens: int | None = None,
    ) -> str:
        """Call Claude with automatic retry on transient errors."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature,
            system=system_override or self._system_prompt(),
            messages=[{"role": "user", "content": user_prompt}],
        )
        return response.content[0].text

    def _call_llm_json(self, user_prompt: str, **kwargs) -> Any:
        """Call LLM and parse JSON response, stripping markdown fences."""
        import json
        import re

        raw = self._call_llm(user_prompt, **kwargs)
        # Strip ```json ... ``` fences if present
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
        return json.loads(cleaned)
