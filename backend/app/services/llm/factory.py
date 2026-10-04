"""Выбор LLM-провайдера по settings (ТЗ-Meili §4).

Смена провайдера = смена LLM_PROVIDER в env, без правок кода.
LLM_MODEL_* в settings переопределяют pinned-ID провайдера (обычно не нужны).
"""
from app.core.config import settings
from app.services.llm import deepseek, mistral
from app.services.llm.base import LLMClient, LLMNotConfigured


def _fallbacks(default: tuple[str, ...]) -> list[str]:
    """LLM_MODEL_FALLBACKS="a,b" переопределяет цепочку провайдера; "" — без запасных."""
    if settings.LLM_MODEL_FALLBACKS is None:
        return list(default)
    return [m.strip() for m in settings.LLM_MODEL_FALLBACKS.split(",") if m.strip()]


def get_client() -> LLMClient:
    if not settings.LLM_API_KEY:
        raise LLMNotConfigured("LLM_API_KEY не задан")

    common = dict(
        api_key=settings.LLM_API_KEY,
        base_url=settings.LLM_BASE_URL,
        proxy=settings.LLM_HTTP_PROXY,
    )
    if settings.LLM_PROVIDER == "deepseek":
        return deepseek.DeepSeekClient(
            model_loop=settings.LLM_MODEL_LOOP or deepseek.MODEL_LOOP,
            model_summary=settings.LLM_MODEL_SUMMARY or deepseek.MODEL_SUMMARY,
            fallbacks=_fallbacks(deepseek.MODEL_FALLBACKS),
            **common,
        )
    if settings.LLM_PROVIDER == "mistral":
        return mistral.MistralClient(
            model_loop=settings.LLM_MODEL_LOOP or mistral.MODEL_LOOP,
            model_summary=settings.LLM_MODEL_SUMMARY or mistral.MODEL_SUMMARY,
            fallbacks=_fallbacks(mistral.MODEL_FALLBACKS),
            **common,
        )
    raise ValueError(f"Неизвестный LLM_PROVIDER: {settings.LLM_PROVIDER}")
