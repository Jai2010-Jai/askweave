"""The AI client: one model (GLM or Gemini, set by WEAVE_AI_PROVIDER) for chat, apps and repairs, with structured
output. There is no fallback to another model: a busy model is retried, then the call fails."""

from __future__ import annotations

import json
import logging
import threading
import time
from types import SimpleNamespace

from pydantic import BaseModel, ValidationError as PydanticValidationError

from ..config import Settings
from . import prompts
from .schemas import AppManifest, RepairPatch

log = logging.getLogger("weave.gemini")

# GEMINI_MODEL=auto picks the first of these the key can use (once, at start-up).
PREFERRED_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest"]
# Pauses (seconds) before asking a busy Gemini model again. GLM and Groq retry busy answers themselves (core/glm.py).
RETRY_PAUSES = (2, 5)


def thinking_config(model: str, level: str | None):
    """The cheapest thinking setting each model family accepts: 2.5 models take a token budget, newer ones a level."""
    from google.genai import types

    if not level:
        return None
    if model.startswith("gemini-2.5-flash"):
        return types.ThinkingConfig(thinking_budget=0)
    if hasattr(types.ThinkingConfig, "model_fields") and "thinking_level" in types.ThinkingConfig.model_fields:
        return types.ThinkingConfig(thinking_level=level)
    return types.ThinkingConfig(thinking_budget=0 if level == "minimal" else 128)


class GeminiError(RuntimeError):
    """A Gemini call failed. The message is safe to show to the user (never contains the key)."""


class GeminiClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self._client = None
        self._model: str | None = None
        self._available_models: set[str] | None = None
        self._lock = threading.RLock()
        self._no_thinking: set[str] = set()  # models that rejected a thinking setting

    @property
    def configured(self) -> bool:
        return bool(self.s.ai_key)

    def _get_client(self):
        if not self.configured:
            raise GeminiError(f"No AI key is set for WEAVE_AI_PROVIDER={self.s.ai_provider}: add it to .env and restart.")
        if self._client is None:
            if (api := self.s.compat_api) is not None:
                from .glm import ChatCompletionsModels

                self._client = SimpleNamespace(models=ChatCompletionsModels(
                    api["key"], api["base_url"], [api["model"]], extra=api["extra"]))
            else:
                from google import genai  # imported lazily so tests run without network

                # Keep the Client itself: when it is garbage-collected it closes the connection `.models` uses.
                self._genai = genai.Client(api_key=self.s.gemini_api_key)
                self._client = self._genai
        return self._client

    def model_name(self) -> str:
        with self._lock:
            if self._model:
                return self._model
            if (api := self.s.compat_api) is not None:
                self._model = api["model"]
                return self._model
            requested = self.s.gemini_model
            available = self.list_models()
            if requested and requested != "auto":
                if requested not in available:
                    raise GeminiError(f"GEMINI_MODEL={requested!r} is not available to this API key. "
                                      f"Available: {', '.join(sorted(available)[:15])}")
                self._model = requested
            else:
                self._model = next((m for m in PREFERRED_MODELS if m in available), None)
                if not self._model:
                    raise GeminiError("No suitable Gemini text model is available to this API key.")
            log.info("Using Gemini model %s", self._model)
            return self._model

    def list_models(self, force_refresh: bool = False) -> set[str]:
        with self._lock:
            if self._available_models is not None and not force_refresh:
                return self._available_models
            client = self._get_client()
            try:
                names = set()
                for m in client.models.list(config={"page_size": 200}):
                    actions = getattr(m, "supported_actions", None) or []
                    if "generateContent" in actions:
                        names.add(m.name.removeprefix("models/"))
                self._available_models = names
                return names
            except Exception as e:  # noqa: BLE001 - surface a safe message
                raise GeminiError(f"Could not list Gemini models: {_safe_error(e)}") from e

    # ---------- calls ----------
    def generate_app(self, prompt: str, app_name: str | None) -> tuple[AppManifest, dict]:
        return self._structured(prompts.SYSTEM, prompts.generation_prompt(prompt, app_name), AppManifest)

    def modify_app(self, change: str, files: dict[str, str], manifest: AppManifest) -> tuple[AppManifest, dict]:
        return self._structured(prompts.SYSTEM, prompts.modification_prompt(change, files, manifest), AppManifest)

    def repair(self, diagnostics: str, files: dict[str, str], manifest: AppManifest) -> tuple[RepairPatch, dict]:
        return self._structured(prompts.SYSTEM, prompts.repair_prompt(diagnostics, files, manifest), RepairPatch)

    def ask(self, system: str, user: str, schema: type[BaseModel], title: str = "", timeout: int | None = None):
        """One structured request with a custom system prompt (the chat brain, translation, NLG), on WEAVE_CHAT_MODEL
        with Gemini or the GLM model with GLM. Minimal thinking: a chat reply has to arrive in seconds."""
        model = self.s.chat_model or self.model_name()
        # Chat decisions are a few hundred tokens: a small cap keeps a runaway answer from adding seconds.
        return self._structured(system, user, schema, model=model, timeout=timeout, thinking="minimal",
                                max_tokens=2048)

    def _structured(self, system: str, user: str, schema: type[BaseModel], attempts: int = 2,
                    model: str | None = None, timeout: int | None = None, thinking: str | None = None,
                    max_tokens: int = 60000):
        from google.genai import types

        client = self._get_client()
        model = model or self.model_name()
        last_err = ""
        for attempt in range(1, attempts + 1):
            contents = user if attempt == 1 else (
                f"{user}\n\nYour previous reply was rejected: {last_err}\nReturn ONLY valid JSON matching the schema.")
            started = time.monotonic()
            schema_arg = (
                {"response_json_schema": schema.model_json_schema()}
                if "response_json_schema" in types.GenerateContentConfig.model_fields
                else {"response_schema": schema}
            )
            config = types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                temperature=0.4,
                max_output_tokens=max_tokens,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                thinking_config=thinking_config(model, thinking),
                **schema_arg,
            )
            resp = self._call_with_retry(client, model, contents, config)
            meta = {
                "model": model,
                "seconds": round(time.monotonic() - started, 1),
                "attempt": attempt,
            }
            usage = getattr(resp, "usage_metadata", None)
            if usage is not None:
                meta["input_tokens"] = getattr(usage, "prompt_token_count", None)
                meta["output_tokens"] = getattr(usage, "candidates_token_count", None)
            text = (resp.text or "").strip()
            if not text:
                reason = ""
                if resp.candidates:
                    reason = str(getattr(resp.candidates[0], "finish_reason", ""))
                last_err = f"empty response {reason}".strip()
                continue
            try:
                return schema.model_validate_json(_strip_fences(text)), meta
            except PydanticValidationError as e:
                last_err = _compact_validation_error(e)
                log.warning("Gemini output failed schema validation: %s", last_err)
            except json.JSONDecodeError as e:
                last_err = f"invalid JSON: {e}"
        raise GeminiError(f"Gemini did not return a valid {schema.__name__}: {last_err}")

    def _call_with_retry(self, client, model: str, contents: str, config):
        """Ask `model`; a busy answer is asked again after RETRY_PAUSES, then fails. Never switches models."""
        last: Exception | None = None
        # GLM and Groq already wait out busy answers inside ChatCompletionsModels, so they are asked once here.
        pauses = (0,) if self.s.compat_api is not None else (0, *RETRY_PAUSES)
        for pause in pauses:
            if pause:
                log.warning("AI model %s busy; asking again in %ss", model, pause)
                time.sleep(pause)
            cfg = config
            if model in self._no_thinking and getattr(config, "thinking_config", None) is not None:
                cfg = config.model_copy(update={"thinking_config": None})
            try:
                return client.models.generate_content(model=model, contents=contents, config=cfg)
            except Exception as e:  # noqa: BLE001
                last = e
                if cfg.thinking_config is not None and "think" in str(e).lower() and not _is_transient(e):
                    # This model takes no thinking setting: ask again without one.
                    self._no_thinking.add(model)
                    try:
                        return client.models.generate_content(
                            model=model, contents=contents, config=config.model_copy(update={"thinking_config": None}))
                    except Exception as e2:  # noqa: BLE001
                        last = e = e2
                if not (_is_transient(e) or _is_quota(e)):
                    raise GeminiError(f"AI request failed: {_safe_error(e)}") from e
        raise GeminiError(f"The AI ({model}) is busy right now, please retry: {_safe_error(last)}") from last


def _is_transient(e: Exception) -> bool:
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if isinstance(code, int) and code in (500, 502, 503, 504):
        return True
    text = str(e).upper()
    return any(t in text for t in ("503", "UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "TIMED OUT"))


def _is_quota(e: Exception) -> bool:
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    return code == 429 or "RESOURCE_EXHAUSTED" in str(e).upper()


def _strip_fences(text: str) -> str:
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    return text.strip()


def _compact_validation_error(e: PydanticValidationError) -> str:
    parts = []
    for err in e.errors()[:6]:
        loc = ".".join(str(x) for x in err["loc"])
        parts.append(f"{loc}: {err['msg']}")
    return "; ".join(parts)


def _safe_error(e: Exception) -> str:
    msg = str(e)
    # Defensive: never echo anything that looks like a credential.
    for marker in ("key=", "x-goog-api-key"):
        if marker in msg:
            msg = msg.split(marker)[0] + "[redacted]"
    hint = ""
    low = msg.lower()
    if "permission" in low or "api key not valid" in low or "401" in low or "403" in low:
        hint = " (check that GEMINI_API_KEY is valid and the Generative Language API is enabled)"
    elif "429" in low or "quota" in low or "resource_exhausted" in low:
        hint = " (quota exhausted: free-tier limits apply unless billing is enabled on the Google Cloud project)"
    return msg[:600] + hint


def make_ai_client(settings: Settings) -> GeminiClient:
    """The AI client for WEAVE_AI_PROVIDER: Gemini, GLM or Groq, one model, no fallback."""
    return GeminiClient(settings)
