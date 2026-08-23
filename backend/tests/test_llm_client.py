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
