"""ТЗ-E: авто-оценка бюджета — триггеры, manual/auto, recompute-эндпоинт."""
from tests.integration.conftest import D1


async def _trip(client, headers, adults=2, children=0) -> str:
    r = await client.post(
        "/trips/",
        json={"title": "Оценки", "adults_count": adults, "children_count": children,
              "start_date": D1, "end_date": D1},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _place(client, headers, name="Музей", **prices) -> str:
    r = await client.post(
        "/places/", json={"name": name, "lat": 54.71, "lon": 20.47, **prices},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _day_id(client, headers, trip_id) -> str:
    days = (await client.get(f"/trips/{trip_id}/days", headers=headers)).json()
    return days[0]["id"]


async def _add_stop(client, headers, trip_id, place_id) -> dict:
    # S16: стоп всегда в дне
    r = await client.post(
        f"/trips/{trip_id}/stops",
        json={"place_id": place_id, "day_id": await _day_id(client, headers, trip_id)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_new_stop_gets_auto_estimate(client, auth_headers):
    """POST /stops сразу считает оценку: ticketed, 2 взрослых -> 2 * 10."""
    trip_id = await _trip(client, auth_headers, adults=2)
    place_id = await _place(
        client, auth_headers,
        pricing_model="ticketed", ticket_adult="10.00", ticket_child="4.00",
    )
    stop = await _add_stop(client, auth_headers, trip_id, place_id)
    assert stop["estimated_cost"] == "20.00"
    assert stop["cost_source"] == "auto"
    assert stop["place_pricing_model"] == "ticketed"


async def test_free_place_is_zero_and_no_data_is_null(client, auth_headers):
    trip_id = await _trip(client, auth_headers)
    free_id = await _place(client, auth_headers, "Парк", pricing_model="free")
    nodata_id = await _place(client, auth_headers, "Кафе", pricing_model="per_person")

    free_stop = await _add_stop(client, auth_headers, trip_id, free_id)
    nodata_stop = await _add_stop(client, auth_headers, trip_id, nodata_id)
    assert free_stop["estimated_cost"] == "0.00"      # «Бесплатно»
    assert nodata_stop["estimated_cost"] is None      # «цена не указана»


async def test_group_change_recomputes_auto_only(client, auth_headers):
    """PUT /trips: смена группы пересчитывает auto, manual нетронут."""
    trip_id = await _trip(client, auth_headers, adults=1)
    auto_place = await _place(
        client, auth_headers, "Обед", pricing_model="per_person", avg_check="20.00"
    )
    manual_place = await _place(client, auth_headers, "Сувениры")
    auto_stop = await _add_stop(client, auth_headers, trip_id, auto_place)
    manual_stop = await _add_stop(client, auth_headers, trip_id, manual_place)

    # ручной ввод суммы -> manual
    r = await client.put(
        f"/trips/{trip_id}/stops/{manual_stop['id']}",
        json={"estimated_cost": "55.00"}, headers=auth_headers,
    )
    assert r.json()["cost_source"] == "manual"

    # группа выросла до 2 взрослых + 1 ребёнок = 3 головы
    r = await client.put(
        f"/trips/{trip_id}", json={"adults_count": 2, "children_count": 1},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    stops = {s["id"]: s for s in
             (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()}
    assert stops[auto_stop["id"]]["estimated_cost"] == "60.00"   # 20 * 3
    assert stops[manual_stop["id"]]["estimated_cost"] == "55.00"  # не тронут


async def test_reset_to_auto_recomputes(client, auth_headers):
    """PUT cost_source='auto' — «вернуть авто»: сброс ручной суммы + пересчёт."""
    trip_id = await _trip(client, auth_headers, adults=2)
    place_id = await _place(
        client, auth_headers, pricing_model="ticketed", ticket_adult="15.00"
    )
    stop = await _add_stop(client, auth_headers, trip_id, place_id)

    await client.put(
        f"/trips/{trip_id}/stops/{stop['id']}",
        json={"estimated_cost": "999.00"}, headers=auth_headers,
    )
    r = await client.put(
        f"/trips/{trip_id}/stops/{stop['id']}",
        json={"cost_source": "auto"}, headers=auth_headers,
    )
    body = r.json()
    assert body["cost_source"] == "auto"
    assert body["estimated_cost"] == "30.00"  # 15 * 2 взрослых


async def test_currency_mismatch_gives_null_estimate(client, auth_headers):
    """Цены места в RUB, поездка в EUR -> авто-оценки нет (FX вне ТЗ)."""
    trip_id = await _trip(client, auth_headers)
    place_id = await _place(
        client, auth_headers,
        pricing_model="per_person", avg_check="1500.00", price_currency="RUB",
    )
    stop = await _add_stop(client, auth_headers, trip_id, place_id)
    assert stop["estimated_cost"] is None


async def test_recompute_endpoint_after_price_update(client, auth_headers):
    """Ре-сид цен не триггерит пересчёт — его делает ручной recompute."""
    trip_id = await _trip(client, auth_headers, adults=2)
    # Ревью: дефолт pricing_model теперь 'unknown' — «цены не знаем», а не
    # «бесплатно». Раньше дефолтом было 'free', и 2701 сидовое место врало,
    # что вход свободный, подставляя в бюджет выдуманный 0.00
    place_id = await _place(client, auth_headers)
    stop = await _add_stop(client, auth_headers, trip_id, place_id)
    assert stop["estimated_cost"] is None

    # у места появилась цена (сид/ручной ввод) — стоп ещё не пересчитан
    r = await client.patch(
        f"/places/{place_id}",
        json={"pricing_model": "ticketed", "ticket_adult": "12.50"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["ticket_adult"] == "12.50"

    r = await client.post(
        f"/trips/{trip_id}/recompute-estimates", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 1

    stops = (await client.get(f"/trips/{trip_id}/stops", headers=auth_headers)).json()
    assert stops[0]["estimated_cost"] == "25.00"


async def test_null_estimates_do_not_break_budget(client, auth_headers):
    """Бюджет: null-стопы считаются отсутствующими, не 0 и не ошибка."""
    trip_id = await _trip(client, auth_headers)
    priced = await _place(
        client, auth_headers, "Кафе", pricing_model="per_person", avg_check="10.00"
    )
    unpriced = await _place(client, auth_headers, "Без цены", pricing_model="per_person")
    await _add_stop(client, auth_headers, trip_id, priced)
    await _add_stop(client, auth_headers, trip_id, unpriced)

    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    assert budget["activities_total"] == "20.00"  # 10 * 2 взрослых, null не ломает


async def test_unknown_price_is_not_free(client, auth_headers):
    """Ревью: «не знаем цену» и «бесплатно» — разные вещи.

    Дефолт места — unknown -> оценки нет (None, не 0.00). Явный free — это
    факт «вход свободный», и он даёт честный 0.00.
    """
    trip_id = await _trip(client, auth_headers, adults=2)

    unknown_stop = await _add_stop(
        client, auth_headers, trip_id,
        await _place(client, auth_headers, name="Без цены"),
    )
    assert unknown_stop["estimated_cost"] is None
    assert unknown_stop["place_pricing_model"] == "unknown"

    free_stop = await _add_stop(
        client, auth_headers, trip_id,
        await _place(client, auth_headers, name="Парк", pricing_model="free"),
    )
    assert free_stop["estimated_cost"] == "0.00"
    assert free_stop["place_pricing_model"] == "free"

    # бюджет: unknown не считается нулём и не ломает сумму
    budget = (await client.get(f"/trips/{trip_id}/budget", headers=auth_headers)).json()
    assert budget["activities_total"] == "0"
