"""Абстракция LLM-провайдера (ТЗ-Meili §4).

Наверх (в agent loop) провайдер-специфика не протекает: обе реализации
нормализуют поток в LLMEvent. Mistral и DeepSeek говорят одним wire-форматом
(OpenAI-совместимые chat completions + SSE), поэтому парсер общий и живёт
здесь — константы провайдеров (base URL, pinned-ID моделей) в их модулях.
"""
import json
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol

import httpx

logger = logging.getLogger("meili.llm")

# QA: модель «недоступна структурно» — запоминаем на это время и сразу идём
# к следующей в цепочке, не тратя на каждом шаге запрос на заведомый отказ
UNAVAILABLE_TTL_S = 600
_unavailable: dict[tuple[str, str], float] = {}


class ModelUnavailable(Exception):
    """Провайдер отказал именно ЭТОЙ модели (не ключу и не сети).

    QA: живой разбор Mistral — ключ рабочий, но из региона, откуда идут
    запросы, тариф не пускает к large («not available in your subscription
    tier», 403) и даёт small/medium лимит 0 запросов в минуту (429 с
    x-ratelimit-limit-req-minute: 0), а ministral-* отвечают. Раньше ход
    падал целиком; теперь клиент переходит к следующей модели цепочки.
    """

    def __init__(self, error: httpx.HTTPStatusError, structural: bool):
        super().__init__(str(error))
        self.error = error
        self.structural = structural   # True — кэшируем отказ на UNAVAILABLE_TTL_S


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

    def __init__(
        self,
        api_key: str,
        model_loop: str,
        model_summary: str,
        fallbacks: tuple[str, ...] | list[str] = (),
        base_url: str | None = None,
        proxy: str | None = None,
    ):
        self.api_key = api_key
        self.model_loop = model_loop
        self.model_summary = model_summary
        # QA: запасные модели — по порядку, после запрошенной
        self.fallbacks = [m for m in fallbacks if m]
        # QA: свой base URL (обратный прокси) и/или HTTP(S)/SOCKS-прокси только
        # для LLM — чтобы ходить к провайдеру через сервер в другом регионе
        if base_url:
            self.base_url = base_url.rstrip("/")
        self.proxy = proxy or None
        self.last_model: str | None = None   # какая модель реально ответила
        self._http: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        """Один keep-alive клиент на инстанс: шаги agent loop в одном ходе не
        платят TCP+TLS-хендшейк заново. Вызывающий закрывает через aclose()."""
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(60.0), proxy=self.proxy)
        return self._http

    def _chain(self, model: str) -> list[str]:
        """Запрошенная модель + запасные, без дублей; заведомо недоступные
        (кэш отказов) — в конец, а не выкидываем: вдруг тариф уже поменяли."""
        chain = list(dict.fromkeys([model, *self.fallbacks]))
        now = time.monotonic()
        live = [m for m in chain if _unavailable.get((self.base_url, m), 0) <= now]
        dead = [m for m in chain if m not in live]
        return live + dead

    async def aclose(self) -> None:
        if self._http is not None and not self._http.is_closed:
            await self._http.aclose()

    async def stream(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
    ) -> AsyncIterator[LLMEvent]:
        """Ответ модели событиями.

        Ревью: одна повторная попытка, если соединение оборвалось ДО первого
        события. Провайдер под нагрузкой закрывает коннект молча
        (RemoteProtocolError «Server disconnected without sending a response»),
        и весь ход падал «ассистент недоступен» на ровном месте. Повторяем
        только пока ничего не отдали наверх: после первого токена ретрай
        напечатал бы ответ дважды.
        """
        last_unavailable: ModelUnavailable | None = None
        for candidate in self._chain(model):
            try:
                async for event in self._stream_with_retry(messages, tools, candidate):
                    yield event
                if candidate != model:
                    logger.warning("llm_model_fallback requested=%s used=%s", model, candidate)
                self.last_model = candidate
                return
            except ModelUnavailable as e:
                # отказ приходит ДО первого события — наверх ещё ничего не ушло
                last_unavailable = e
                if e.structural:
                    _unavailable[(self.base_url, candidate)] = time.monotonic() + UNAVAILABLE_TTL_S
                logger.warning(
                    "llm_model_unavailable model=%s status=%s structural=%s",
                    candidate, e.error.response.status_code, e.structural,
                )
        assert last_unavailable is not None
        raise last_unavailable.error

    async def _stream_with_retry(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
    ) -> AsyncIterator[LLMEvent]:
        last_error: Exception | None = None
        for attempt in range(2):
            started = False
            try:
                async for event in self._stream_once(messages, tools, model):
                    started = True
                    yield event
                return
            except httpx.TransportError as e:
                if started:
                    raise
                last_error = e
        raise last_error  # pragma: no cover — второй проход всегда что-то даёт

    async def _stream_once(
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
                if response.status_code in (403, 404, 429):
                    await response.aread()
                    error = httpx.HTTPStatusError(
                        f"{response.status_code} for model {model}",
                        request=response.request, response=response,
                    )
                    limit = response.headers.get("x-ratelimit-limit-req-minute")
                    # 403 «не в тарифе»/404 «нет модели»/429 с лимитом 0 — это
                    # про модель, а не про нагрузку: кэшируем отказ. Обычный 429
                    # тоже уводит к запасной модели, но без кэша.
                    raise ModelUnavailable(
                        error, structural=response.status_code != 429 or limit == "0",
                    )
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
