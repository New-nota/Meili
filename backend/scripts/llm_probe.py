"""Проба живого LLM-провайдера (ТЗ-Meili M1.3 DoD).

Запуск (нужен LLM_API_KEY в backend/.env):
    docker compose exec backend python -m scripts.llm_probe
Смена движка без правок кода: LLM_PROVIDER=deepseek в env.
"""
import asyncio

from app.core.config import settings
from app.services.llm.factory import get_client


async def main() -> None:
    client = get_client()
    print(f"provider={settings.LLM_PROVIDER} model={client.model_loop}")
    async for event in client.stream(
        [{"role": "user", "content": "ping"}], tools=None, model=client.model_loop
    ):
        if event.type == "token":
            print(event.text, end="", flush=True)
    print()


if __name__ == "__main__":
    asyncio.run(main())
