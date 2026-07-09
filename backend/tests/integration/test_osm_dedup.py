"""S8 WP-2: osm_id — get-or-create, уникальный индекс, отсутствие дублей."""
from sqlalchemy import text


async def test_same_osm_id_returns_existing_place(client, auth_headers):
    """Повторное добавление того же POI не создаёт вторую строку."""
    body = {
        "name": "Музей янтаря",
        "city": "Калининград",
        "lat": 54.7142,
        "lon": 20.4989,
        "osm_id": "node/999001",
    }
    r1 = await client.post("/places/", json=body, headers=auth_headers)
    assert r1.status_code == 200, r1.text
    r2 = await client.post("/places/", json=body, headers=auth_headers)
    assert r2.status_code == 200

    # оба ответа указывают на ОДНО место
    assert r1.json()["id"] == r2.json()["id"]


async def test_get_or_create_survives_name_difference(client, auth_headers):
    """Тот же osm_id с другим именем — всё равно существующее место."""
    r1 = await client.post(
        "/places/",
        json={"name": "Кафедральный собор", "lat": 54.7068, "lon": 20.5118,
              "osm_id": "way/555777"},
        headers=auth_headers,
    )
    r2 = await client.post(
        "/places/",
        json={"name": "Königsberg Cathedral", "lat": 54.7069, "lon": 20.5119,
              "osm_id": "way/555777"},
        headers=auth_headers,
    )
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["name"] == "Кафедральный собор"  # оригинал не перезаписан


async def test_places_without_osm_id_can_coexist(client, auth_headers):
    """Места без osm_id (клик по карте) не конфликтуют между собой."""
    r1 = await client.post(
        "/places/", json={"name": "Точка А", "lat": 54.70, "lon": 20.50},
        headers=auth_headers,
    )
    r2 = await client.post(
        "/places/", json={"name": "Точка Б", "lat": 54.71, "lon": 20.51},
        headers=auth_headers,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]


async def test_unique_index_blocks_direct_duplicate(client, _test_database):
    """Прямая вставка второго места с тем же osm_id падает на индексе."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from tests.integration.conftest import _TEST_ASYNC_URL

    engine = create_async_engine(_TEST_ASYNC_URL)
    factory = async_sessionmaker(engine)
    try:
        async with factory() as db:
            await db.execute(text(
                "INSERT INTO places (id, name, osm_id, is_verified) "
                "VALUES (gen_random_uuid(), 'X', 'node/dup1', false)"
            ))
            await db.commit()
        async with factory() as db:
            with pytest.raises(IntegrityError):
                await db.execute(text(
                    "INSERT INTO places (id, name, osm_id, is_verified) "
                    "VALUES (gen_random_uuid(), 'Y', 'node/dup1', false)"
                ))
                await db.commit()
    finally:
        await engine.dispose()
