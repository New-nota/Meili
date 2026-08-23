"""Абстракция LLM-провайдера (ТЗ-Meili §4).

Наверх (в agent loop) провайдер-специфика не протекает: обе реализации
нормализуют поток в LLMEvent. Mistral и DeepSeek говорят одним wire-форматом
(OpenAI-совместимые chat completions + SSE), поэтому парсер общий и живёт
здесь — константы провайдеров (base URL, pinned-ID моделей) в их модулях.
"""
import json
from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol

import httpx


class LLMNotConfigured(Exception):
    """LLM_API_KEY не задан — эндпоинты ассистента отвечают 501 (паттерн R2/OAuth)."""


@dataclass
class LLMEvent:
    """Унифицированное событие потока: token | tool_call | end."""
    type: str                      # 'token' | 'tool_call' | 'end'
    text: str = ""                 # для token
    name: str = ""                 # для tool_call
    arguments: dict = field(default_factory=dict)  # для tool_call
    id: str = ""                   # для tool_call


class LLMClient(Protocol):
    model_loop: str      # модель agent-цикла (pinned-ID или override из settings)
    model_summary: str   # модель суммаризации

    async def stream(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
    ) -> AsyncIterator[LLMEvent]:
        ...


class OpenAICompatibleClient:
    """База для провайдеров с OpenAI-совместимым SSE-стримингом."""

    base_url: str  # задаёт наследник

    def __init__(self, api_key: str, model_loop: str, model_summary: str):
        self.api_key = api_key
        self.model_loop = model_loop
        self.model_summary = model_summary
        self._http: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        """Один keep-alive клиент на инстанс: шаги agent loop в одном ходе не
        платят TCP+TLS-хендшейк заново. Вызывающий закрывает через aclose()."""
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
        return self._http

    async def aclose(self) -> None:
        if self._http is not None and not self._http.is_closed:
            await self._http.aclose()

    async def stream(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
    ) -> AsyncIterator[LLMEvent]:
        payload: dict = {"model": model, "messages": messages, "stream": True}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        # tool-call'ы приходят кусками (index + дельты arguments) — копим до конца
        pending_calls: dict[int, dict] = {}

        async with self._http_client().stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: "):]
                    if data.strip() == "[DONE]":
                        break
                    chunk = json.loads(data)
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}

                    if delta.get("content"):
                        yield LLMEvent(type="token", text=delta["content"])

                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        slot = pending_calls.setdefault(
                            idx, {"id": "", "name": "", "arguments": ""}
                        )
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]

        for slot in pending_calls.values():
            try:
                arguments = json.loads(slot["arguments"]) if slot["arguments"] else {}
            except json.JSONDecodeError:
                arguments = {}
            yield LLMEvent(
                type="tool_call", name=slot["name"], arguments=arguments, id=slot["id"]
            )
        yield LLMEvent(type="end")
