"""DeepSeek — запасной провайдер (OpenAI-совместимый API).

Pinned-ID взяты из официальной документации (api-docs.deepseek.com, июль 2026):
- agent loop: deepseek-v4-pro
- summary:    deepseek-v4-flash
(deepseek-chat / deepseek-reasoner объявлены deprecated с 2026-07-24.)
"""
from app.services.llm.base import OpenAICompatibleClient

MODEL_LOOP = "deepseek-v4-pro"
MODEL_SUMMARY = "deepseek-v4-flash"


class DeepSeekClient(OpenAICompatibleClient):
    base_url = "https://api.deepseek.com"
