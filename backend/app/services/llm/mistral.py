"""Mistral — дефолтный провайдер (ЕС-хостинг, GDPR — решение зафиксировано).

Pinned-ID взяты из официальной документации (docs.mistral.ai, июль 2026):
- agent loop: mistral-large-2512  (Mistral Large 3, алиас mistral-large-latest)
- summary:    mistral-small-2603  (Mistral Small 4, алиас mistral-small-latest)
"""
from app.services.llm.base import OpenAICompatibleClient

MODEL_LOOP = "mistral-large-2512"
MODEL_SUMMARY = "mistral-small-2603"
# QA: запасная цепочка, если тариф/регион не пускает к основным моделям
# (живой разбор 2026-10-02: large — 403 tier_not_allowed, small — лимит 0,
# ministral-14b/8b с tool calling отвечают). Порядок — от умной к быстрой.
MODEL_FALLBACKS = ("ministral-14b-2512", "ministral-8b-2512")


class MistralClient(OpenAICompatibleClient):
    base_url = "https://api.mistral.ai/v1"
