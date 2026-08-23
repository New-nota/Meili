"""Выбор LLM-провайдера по settings (ТЗ-Meili §4).

Смена провайдера = смена LLM_PROVIDER в env, без правок кода.
LLM_MODEL_* в settings переопределяют pinned-ID провайдера (обычно не нужны).
"""
from app.core.config import settings
from app.services.llm import deepseek, mistral
from app.services.llm.base import LLMClient, LLMNotConfigured


def get_client() -> LLMClient:
    if not settings.LLM_API_KEY:
        raise LLMNotConfigured("LLM_API_KEY не задан")

    if settings.LLM_PROVIDER == "deepseek":
        return deepseek.DeepSeekClient(
            api_key=settings.LLM_API_KEY,
            model_loop=settings.LLM_MODEL_LOOP or deepseek.MODEL_LOOP,
            model_summary=settings.LLM_MODEL_SUMMARY or deepseek.MODEL_SUMMARY,
        )
    if settings.LLM_PROVIDER == "mistral":
        return mistral.MistralClient(
            api_key=settings.LLM_API_KEY,
            model_loop=settings.LLM_MODEL_LOOP or mistral.MODEL_LOOP,
            model_summary=settings.LLM_MODEL_SUMMARY or mistral.MODEL_SUMMARY,
        )
    raise ValueError(f"Неизвестный LLM_PROVIDER: {settings.LLM_PROVIDER}")
