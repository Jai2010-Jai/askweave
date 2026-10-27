"""OpenAI-style chat-completions providers (GLM from Z.ai, Groq) behind the same `client.models` calls GeminiClient
makes with google-genai.

With WEAVE_AI_PROVIDER=glm or groq, GeminiClient talks to this instead of google-genai, so its schema checks work
unchanged. The system prompt becomes a system message, a JSON schema is spelled out in it (JSON mode takes no schema
here), and each provider's own fields (`extra`: GLM's thinking switch, Groq's reasoning effort) keep replies fast."""

from __future__ import annotations

import json
import time
import types

import httpx

# GLM error codes that mean "busy, try again" (the HTTP status is 429 for all of them).
BUSY_CODES = {"1302", "1303", "1305", "1312"}
MAX_TOKENS = 32768
# Short pauses first: a busy model often frees up within a second, and a quick retry is what keeps chat fast.
BUSY_RETRIES = (0.5, 0.5, 1, 1, 1.5, 2, 2, 3, 3, 4, 5, 6, 8)


class GlmError(RuntimeError):
    def __init__(self, status: int, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.code = status
        self.retry_after = retry_after


class ChatCompletionsModels:
    def __init__(self, api_key: str, base_url: str, models: list[str], timeout: float = 600, extra: dict | None = None):
        self.models = models
        self.extra = extra or {}
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout,
                                  headers={"Authorization": f"Bearer {api_key}"})

    def list(self, config=None):
        return [types.SimpleNamespace(name=f"models/{m}", supported_actions=["generateContent"]) for m in self.models]

    def generate_content(self, model: str, contents: str, config):
        system = getattr(config, "system_instruction", None) or ""
        schema = getattr(config, "response_json_schema", None)
        if schema:
            system += ("\n\nReply with one JSON object only (no markdown fences) that matches this JSON schema:\n"
                       + json.dumps(schema))
        body = {
            "model": model,
            "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": contents}],
            "max_tokens": min(getattr(config, "max_output_tokens", None) or MAX_TOKENS, MAX_TOKENS),
            **self.extra,
        }
        if getattr(config, "temperature", None) is not None:
            body["temperature"] = config.temperature
        if schema or getattr(config, "response_mime_type", None) == "application/json":
            body["response_format"] = {"type": "json_object"}
        for pause in (*BUSY_RETRIES, None):
            try:
                r = self._http.post("/chat/completions", json=body)
            except httpx.HTTPError as e:
                raise GlmError(503, f"UNAVAILABLE: AI request failed: {type(e).__name__}") from e
            if r.status_code == 200:
                break
            err = _error(r)
            if err.code != 503 or pause is None:
                raise err
            time.sleep(max(pause, min(err.retry_after or 0, 10)))
        data = r.json()
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage") or {}
        return types.SimpleNamespace(
            text=(choice.get("message") or {}).get("content") or "",
            usage_metadata=types.SimpleNamespace(prompt_token_count=usage.get("prompt_tokens"),
                                                 candidates_token_count=usage.get("completion_tokens")),
            candidates=[types.SimpleNamespace(finish_reason=choice.get("finish_reason"))])


GlmModels = ChatCompletionsModels  # older name


def _error(r: httpx.Response) -> GlmError:
    try:
        err = r.json().get("error") or {}
    except ValueError:
        err = {}
    code, message = str(err.get("code", "")), str(err.get("message") or r.text)[:300]
    try:
        retry_after = float(r.headers.get("retry-after", ""))
    except ValueError:
        retry_after = None
    if code in BUSY_CODES or r.status_code >= 500:
        return GlmError(503, f"UNAVAILABLE: the AI is overloaded ({code or r.status_code}): {message}")
    if r.status_code == 429:
        # Groq: a per-minute limit clears in seconds (asked again); a per-day limit doesn't (fails with the reason).
        low = message.lower()
        if "per day" in low or "(rpd)" in low or "(tpd)" in low:
            return GlmError(429, f"RESOURCE_EXHAUSTED: daily AI limit reached ({code}): {message}")
        if code == "rate_limit_exceeded" or retry_after is not None:
            return GlmError(503, f"UNAVAILABLE: AI rate limit, retrying ({code}): {message}", retry_after)
        return GlmError(429, f"RESOURCE_EXHAUSTED: AI quota or balance ({code}): {message}")
    return GlmError(r.status_code, f"AI request failed ({r.status_code} {code}): {message}")
