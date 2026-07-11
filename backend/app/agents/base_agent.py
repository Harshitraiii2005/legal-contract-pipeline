import hashlib
import sqlite3
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any

import structlog
from groq import Groq
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type

from app.core.config import settings
from app.core.logging import get_logger
from app.graph.state import ContractReviewState

logger = get_logger(__name__)

_client: Groq | None = None

# FIX (stale-cache bug): every entry in the LLM response cache is keyed
# partly on this version string. Bumping it invalidates all previously
# cached completions. Without this, a fix to a prompt's *wording* changes the
# cache key naturally (since the prompt text itself is part of the hash) —
# but a fix to code that runs *around* the LLM call (e.g. calibrate_score,
# a grounding check, a flag-cleaning regex) does NOT change the prompt text
# at all, so the exact same cached completion keeps getting served forever
# even after the surrounding bug is fixed. Several rounds of this project's
# testing produced byte-identical "re-runs" of a known-bad report — that
# was this cache, not the model, and simply re-generating never actually
# re-ran anything. Bump CACHE_SCHEMA_VERSION whenever a fix could plausibly
# change how a cached completion should be used, or wire this to a real
# code/deploy version at build time.
CACHE_SCHEMA_VERSION = "2"


def get_groq_client() -> Groq:
    """Returns the Groq client."""
    global _client
    if _client is None:
        _client = Groq(api_key=settings.GROQ_API_KEY)
    return _client


def _get_cached_response(prompt_hash: str) -> str | None:
    try:
        conn = sqlite3.connect("evals/.llm_cache.db")
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS cache (hash TEXT PRIMARY KEY, response TEXT)")
        cursor.execute("SELECT response FROM cache WHERE hash = ?", (prompt_hash,))
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


def _set_cached_response(prompt_hash: str, response: str) -> None:
    try:
        conn = sqlite3.connect("evals/.llm_cache.db")
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS cache (hash TEXT PRIMARY KEY, response TEXT)")
        cursor.execute("INSERT OR REPLACE INTO cache (hash, response) VALUES (?, ?)", (prompt_hash, response))
        conn.commit()
        conn.close()
    except Exception:
        pass


class BaseAgent(ABC):
    """Abstract base for all pipeline agents."""

    agent_name: str = "base_agent"
    model: str = settings.GROQ_MODEL
    max_tokens: int = 4096

    def __init__(self) -> None:
        self.log = get_logger(self.__class__.__name__)
        self.client = get_groq_client()
        self.model = settings.GROQ_MODEL

    # ------------------------------------------------------------------ #
    # Public interface                                                      #
    # ------------------------------------------------------------------ #

    def run(self, state: Any) -> dict[str, Any]:
        """Entry point called by LangGraph. Returns updated state slice."""
        run_id = str(uuid.uuid4())
        start = time.perf_counter()

        # Enforce strict input validation
        if isinstance(state, dict):
            try:
                state_obj = ContractReviewState(**state)
            except Exception as e:
                raise ValueError(f"State validation failed at agent entry for {self.agent_name}: {e}") from e
        elif isinstance(state, ContractReviewState):
            state_obj = state
        else:
            raise TypeError(f"Expected dict or ContractReviewState, got {type(state)}")

        self.log.info("agent_start", agent=self.agent_name, run_id=run_id)

        try:
            result = self._execute(state_obj)

            # Enforce strict output validation
            if not isinstance(result, dict):
                raise TypeError(f"Agent {self.agent_name} output must be a dict representing a state slice, got {type(result)}")

            fields = getattr(ContractReviewState, "model_fields", getattr(ContractReviewState, "__fields__", {}))
            for key in result.keys():
                if key not in fields:
                    raise ValueError(f"Agent {self.agent_name} output contains invalid field '{key}' not in ContractReviewState")

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
    def _execute(self, state: ContractReviewState) -> dict[str, Any]:
        """Subclasses implement the actual logic here."""
        ...

    def _system_prompt(self) -> str:
        return (
            "You are a senior legal AI assistant specialised in contract risk analysis. "
            "Be precise, cite clause text verbatim when relevant, and return structured JSON "
            "unless instructed otherwise. Never hallucinate citations, figures, or dollar "
            "amounts that do not appear in the source text. Never include conversational "
            "preambles (e.g. 'here is a summary'), meta-commentary about your own output, "
            "or raw JSON/code fences in a response that is supposed to be plain text."
        )

    # ------------------------------------------------------------------ #
    # LLM helpers                                                          #
    # ------------------------------------------------------------------ #

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_random_exponential(multiplier=1, max=30),
        retry=retry_if_exception_type(Exception),
        reraise=True,
    )
    def _call_llm(
        self,
        user_prompt: str,
        system_override: str | None = None,
        temperature: float = 0.0,
        max_tokens: int | None = None,
    ) -> str:
        """Call Groq LLM with automatic retry and caching."""
        sys_prompt = system_override or self._system_prompt()

        # Dynamically scale max_tokens to avoid Groq's TPM limits (e.g. 6000 TPM for 8b models)
        estimated_input = len(sys_prompt + user_prompt) // 4
        tpm_limit = 6000 if "8b" in self.model else 12000
        safe_max_tokens = max(100, tpm_limit - estimated_input - 300)
        final_max_tokens = min(max_tokens or self.max_tokens, safe_max_tokens)

        # Calculate prompt hash for local caching. CACHE_SCHEMA_VERSION is
        # included so that fixes to code around the LLM call (not just the
        # prompt text itself) can be forced to bypass stale cached results.
        prompt_input = (
            f"{CACHE_SCHEMA_VERSION}:{self.model}:{sys_prompt}:{user_prompt}:"
            f"{temperature}:{final_max_tokens}"
        )
        prompt_hash = hashlib.sha256(prompt_input.encode("utf-8")).hexdigest()

        # Check cache
        cached = _get_cached_response(prompt_hash)
        if cached:
            self.log.info("llm_cache_hit", agent=self.agent_name, model=self.model)
            return cached

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=final_max_tokens,
        )
        content = response.choices[0].message.content

        self.log.info(
            "llm_call_trace",
            agent=self.agent_name,
            model=self.model,
            prompt=user_prompt[:500] + "..." if len(user_prompt) > 500 else user_prompt,
            response=content[:500] + "..." if len(content) > 500 else content,
        )
        _set_cached_response(prompt_hash, content)
        return content

    def _call_llm_json(self, user_prompt: str, max_retries: int = 2, **kwargs) -> Any:
        """Call LLM and parse the first valid JSON value from the response.

        FIX: previously a JSON-decode failure raised immediately with no
        retry at all (the @retry decorator on `_call_llm` only covers
        network/API-level exceptions, not "the model didn't return valid
        JSON"). A single malformed response would hard-fail the whole agent.
        This now gives the model a bounded number of extra attempts,
        explicitly telling it what went wrong, before giving up.
        """
        import json

        prompt = user_prompt
        last_error: Exception | None = None

        for attempt in range(max_retries + 1):
            raw = self._call_llm(prompt, **kwargs)
            text = raw.strip()

            for i, ch in enumerate(text):
                if ch in ('[', '{'):
                    try:
                        value, _ = json.JSONDecoder().raw_decode(text, i)
                        return value
                    except json.JSONDecodeError:
                        continue

            last_error = ValueError(f"No valid JSON found in LLM response: {raw[:300]}")
            self.log.warning(
                "llm_json_parse_failed_retrying",
                agent=self.agent_name,
                attempt=attempt + 1,
            )
            prompt = (
                user_prompt
                + "\n\nCRITICAL: Your previous response did not contain valid, parseable "
                "JSON. Return ONLY a single valid JSON object or array — no prose, no "
                "markdown fences, no commentary before or after it."
            )

        raise last_error