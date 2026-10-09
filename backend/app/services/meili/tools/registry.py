"""Реестр read-tools Meili (ТЗ-Meili M2.6): JSON-schema для LLM + диспетчер.

Все tools — только чтение. Запись в БД здесь запрещена архитектурно:
единственная точка записи — executor по кнопке «Применить» (M4).
"""
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.meili.tools.place_details import get_place_details
from app.services.meili.tools.search_places import search_places

# OpenAI-совместимые описания — единый формат Mistral/DeepSeek (§4)
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_places",
            "description": (
                "Поиск мест (музеи, кафе, парки…) по базе сервиса. Возвращает "
                "факты, посчитанные системой: is_open_now и цену. Предлагать "
                "можно ТОЛЬКО места из ответа этого инструмента: имена и "
                "place_id брать оттуда дословно, не по образцу. Пустой список "
                "означает, что таких мест в базе нет — так и скажи, не заменяй "
                "выдуманными. Ищи короткими запросами из 1–2 слов («коса», "
                "«янтарь», «мясо»), город передавай отдельным полем city, а не "
                "внутри query. Вызови поиск заново, если собираешься "
                "предложить план, а точных place_id под рукой нет. "
                "У результата бывают пометки: outside_requested_city (место в "
                "другом городе) и loose_match (точного совпадения нет, это "
                "подбор по категории) — сообщи о них пользователю."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "1–2 слова по названию/описанию, без города"},
                    "category": {
                        "type": "string",
                        "enum": ["hotel", "museum", "landmark", "attraction", "viewpoint", "restaurant", "cafe", "bar", "park", "theatre", "beach", "shopping", "historic"],
                        "description": "категория; hotel — жильё (отели, хостелы, апартаменты)",
                    },
                    "city": {"type": "string", "description": "город поездки (из снапшота) — только город, район/место передавай в near_place"},
                    "near_place": {
                        "type": "string",
                        "description": (
                            "ориентир по названию — искать РЯДОМ с ним (район, "
                            "достопримечательность, место из маршрута: «Рыбная "
                            "деревня», «Кафедральный собор»). Координаты найдёт "
                            "система; у результатов будет distance_m"
                        ),
                    },
                    "near": {
                        "type": "object",
                        "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}},
                        "description": "искать рядом с точкой (если координаты уже известны из ответа системы)",
                    },
                    "radius": {"type": "integer", "description": "радиус в метрах (с near)"},
                    "day": {"type": "string", "description": "ISO-дата — открытость на этот день"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_place_details",
            "description": "Полные детали места по place_id: часы, координаты, цены, описание.",
            "parameters": {
                "type": "object",
                "properties": {
                    "place_id": {"type": "string", "description": "UUID места из search_places"},
                },
                "required": ["place_id"],
            },
        },
    },
]

# человекочитаемые подписи для event: step
STEP_LABELS = {
    "search_places": "ищу места",
    "get_place_details": "смотрю детали места",
}


async def run_tool(db: AsyncSession, now: datetime, name: str, arguments: dict):
    """Выполнить read-tool. Неизвестное имя — мягкая ошибка в контекст модели."""
    if name == "search_places":
        return await search_places(
            db, now,
            query=arguments.get("query", ""),
            category=arguments.get("category"),
            city=arguments.get("city"),
            near=arguments.get("near"),
            radius=arguments.get("radius"),
            day=arguments.get("day"),
            near_place=arguments.get("near_place"),
        )
    if name == "get_place_details":
        return await get_place_details(db, now, place_id=arguments.get("place_id", ""))
    return {"error": f"unknown_tool: {name}"}
