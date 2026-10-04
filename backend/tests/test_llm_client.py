"""LLM-абстракция (ТЗ-Meili §4): SSE-парсер wire-формата и фабрика провайдеров.

Парсер — граница с внешним миром: провайдер подменён httpx.MockTransport,
проверяем нормализацию потока в LLMEvent (токены, сборка tool_call из дельт).
"""
import json

import httpx
import pytest

from app.core.config import settings
from app.services.llm import deepseek, mistral
from app.services.llm.base import LLMNotConfigured
from app.services.llm.factory import get_client


def sse_body(*chunks: dict | str) -> str:
    lines = []
    for c in chunks:
        payload = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
        lines.append(f"data: {payload}\n\n")
    return "".join(lines)


def make_client(body: str, status: int = 200) -> mistral.MistralClient:
    """Клиент с подменённым транспортом: запросы не уходят в сеть."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(status, text=body,
                              headers={"content-type": "text/event-stream"})

    client = mistral.MistralClient("test-key", "m-loop", "m-sum")
    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client


async def collect(client, tools=None):
    events = [e async for e in client.stream(
        [{"role": "user", "content": "hi"}], tools=tools, model="m-loop",
    )]
    await client.aclose()
    return events


async def test_stream_yields_tokens_then_end():
    body = sse_body(
        {"choices": [{"delta": {"content": "Прив"}}]},
        {"choices": [{"delta": {"content": "ет"}}]},
        "[DONE]",
    )
    events = await collect(make_client(body))
    assert [(e.type, e.text) for e in events] == [
        ("token", "Прив"), ("token", "ет"), ("end", ""),
    ]


async def test_tool_call_arguments_assembled_from_deltas():
    """Аргументы tool_call приходят кусками — парсер обязан их склеить."""
    args = json.dumps({"query": "музей"}, ensure_ascii=False)
    body = sse_body(
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "id": "c1",
             "function": {"name": "search_places", "arguments": args[:6]}}]}}]},
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": args[6:]}}]}}]},
        "[DONE]",
    )
    events = await collect(make_client(body), tools=[{"type": "function"}])
    calls = [e for e in events if e.type == "tool_call"]
    assert len(calls) == 1
    assert calls[0].id == "c1"
    assert calls[0].name == "search_places"
    assert calls[0].arguments == {"query": "музей"}
    assert events[-1].type == "end"


async def test_broken_tool_arguments_dont_crash():
    body = sse_body(
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "id": "c1",
             "function": {"name": "x", "arguments": "{кривой json"}}]}}]},
        "[DONE]",
    )
    events = await collect(make_client(body))
    call = [e for e in events if e.type == "tool_call"][0]
    assert call.arguments == {}  # мягкая деградация, не исключение


async def test_http_error_raises():
    client = make_client("nope", status=401)
    with pytest.raises(httpx.HTTPStatusError):
        await collect(client)


async def test_empty_choices_and_garbage_lines_skipped():
    body = ": comment\n\n" + sse_body({"choices": []}, {"no_choices": 1}, "[DONE]")
    events = await collect(make_client(body))
    assert [e.type for e in events] == ["end"]


# --- фабрика (M1.3): смена провайдера — одна env-переменная ---


def test_factory_selects_provider_and_pinned_models(monkeypatch):
    monkeypatch.setattr(settings, "LLM_API_KEY", "k")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "mistral")
    # Ревью: тест ПРО pinned-дефолты, значит override'ы обязан гасить сам.
    # Раньше он читал живой settings и падал, если в .env стоял LLM_MODEL_LOOP.
    monkeypatch.setattr(settings, "LLM_MODEL_LOOP", None)
    monkeypatch.setattr(settings, "LLM_MODEL_SUMMARY", None)
    c = get_client()
    assert isinstance(c, mistral.MistralClient)
    assert c.model_loop == mistral.MODEL_LOOP
    assert c.model_summary == mistral.MODEL_SUMMARY

    monkeypatch.setattr(settings, "LLM_PROVIDER", "deepseek")
    c = get_client()
    assert isinstance(c, deepseek.DeepSeekClient)
    assert c.model_loop == deepseek.MODEL_LOOP


def test_factory_model_override_and_errors(monkeypatch):
    monkeypatch.setattr(settings, "LLM_API_KEY", "k")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "mistral")
    monkeypatch.setattr(settings, "LLM_MODEL_LOOP", "custom-model")
    assert get_client().model_loop == "custom-model"

    monkeypatch.setattr(settings, "LLM_PROVIDER", "нет-такого")
    with pytest.raises(ValueError):
        get_client()

    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    with pytest.raises(LLMNotConfigured):
        get_client()


# --- QA: цепочка запасных моделей --------------------------------------------

def make_routed_client(responses: dict, fallbacks=("m-b", "m-c")):
    """Ответ провайдера по имени модели: {model: (status, headers, body)}."""
    from app.services.llm import base as llm_base

    llm_base._unavailable.clear()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        seen.append(model)
        status, headers, body = responses[model]
        return httpx.Response(status, text=body, headers={"content-type": "text/event-stream", **headers})

    client = mistral.MistralClient("test-key", "m-loop", "m-sum", fallbacks=fallbacks)
    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client, seen


OK_BODY = sse_body({"choices": [{"delta": {"content": "ок"}}]}, "[DONE]")
TIER_403 = (403, {}, '{"type":"tier_not_allowed"}')
ZERO_429 = (429, {"x-ratelimit-limit-req-minute": "0"}, '{"type":"rate_limited"}')


async def test_fallback_on_tier_and_zero_limit_then_cached():
    """403 «не в тарифе» и 429 с лимитом 0 — про модель, а не про нагрузку:
    клиент уходит к следующей, а отказ кэширует (второй ход сразу на рабочую)."""
    client, seen = make_routed_client({"m-loop": TIER_403, "m-b": ZERO_429, "m-c": (200, {}, OK_BODY)})
    events = [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    assert [e.text for e in events if e.type == "token"] == ["ок"]
    assert seen == ["m-loop", "m-b", "m-c"]
    assert client.last_model == "m-c"

    seen.clear()
    [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    assert seen == ["m-c"]  # заведомо недоступные не дёргаем
    await client.aclose()


async def test_transient_429_falls_back_without_caching():
    busy = (429, {"x-ratelimit-limit-req-minute": "60"}, "{}")
    client, seen = make_routed_client({"m-loop": busy, "m-b": (200, {}, OK_BODY), "m-c": (200, {}, OK_BODY)})
    [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    seen.clear()
    [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    assert seen[0] == "m-loop"  # временный 429 не помечает модель мёртвой
    await client.aclose()


async def test_bad_key_does_not_fall_back():
    """401 — про ключ: перебирать модели бессмысленно, ошибка уходит наверх."""
    client, seen = make_routed_client({"m-loop": (401, {}, "{}"), "m-b": (200, {}, OK_BODY), "m-c": (200, {}, OK_BODY)})
    with pytest.raises(httpx.HTTPStatusError) as e:
        [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    assert e.value.response.status_code == 401
    assert seen == ["m-loop"]
    await client.aclose()


async def test_all_models_unavailable_raises_last_status():
    client, seen = make_routed_client({"m-loop": TIER_403, "m-b": TIER_403, "m-c": ZERO_429})
    with pytest.raises(httpx.HTTPStatusError) as e:
        [e async for e in client.stream([{"role": "user", "content": "hi"}], None, "m-loop")]
    assert e.value.response.status_code == 429
    await client.aclose()


def test_factory_passes_fallbacks_base_url_and_proxy(monkeypatch):
    monkeypatch.setattr(settings, "LLM_API_KEY", "k")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "mistral")
    monkeypatch.setattr(settings, "LLM_MODEL_FALLBACKS", "x-1, x-2")
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://kz.example/mistral/v1/")
    monkeypatch.setattr(settings, "LLM_HTTP_PROXY", "socks5://127.0.0.1:1080")
    client = get_client()
    assert client.fallbacks == ["x-1", "x-2"]
    assert client.base_url == "https://kz.example/mistral/v1"
    assert client.proxy == "socks5://127.0.0.1:1080"
    monkeypatch.setattr(settings, "LLM_MODEL_FALLBACKS", None)
    assert get_client().fallbacks == list(mistral.MODEL_FALLBACKS)
    # «без запасных» теперь явное слово: пустая строка в .env = «не задано»
    monkeypatch.setattr(settings, "LLM_MODEL_FALLBACKS", "none")
    assert get_client().fallbacks == []


def test_settings_single_env_ignores_foreign_and_empty_keys(tmp_path, monkeypatch):
    """Единый .env: ключи compose/Vite не валят бэкенд, «KEY=» — не задано."""
    from app.core.config import Settings

    env = tmp_path / ".env"
    env.write_text(
        "POSTGRES_USER=u\nVITE_API_URL=http://x\nSECRET_KEY=s\n"
        "DATABASE_URL=postgresql+asyncpg://u:p@h/db\nREDIS_URL=redis://r\nVALHALLA_URL=http://v\n"
        "LLM_MODEL_LOOP=\nSMTP_PORT=\nLLM_MODEL_FALLBACKS=\n"
    )
    for key in ("SECRET_KEY", "DATABASE_URL", "REDIS_URL", "VALHALLA_URL",
                "LLM_MODEL_LOOP", "SMTP_PORT", "LLM_MODEL_FALLBACKS"):
        monkeypatch.delenv(key, raising=False)
    s = Settings(_env_file=env)
    assert s.SECRET_KEY == "s"
    assert s.LLM_MODEL_LOOP is None and s.LLM_MODEL_FALLBACKS is None
    assert s.SMTP_PORT == 587
