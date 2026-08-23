"""ТЗ-Meili M5.4: токен-окно истории — юнит на чистую логику."""
from types import SimpleNamespace

from app.services.meili.loop import _window, rough_token_count


def msg(tokens: int, text: str = "x"):
    return SimpleNamespace(token_count=tokens, content=text)


def test_window_keeps_newest_within_budget():
    history = [msg(10), msg(10), msg(10), msg(10)]
    window = _window(history, budget_tokens=25)
    assert window == history[-2:]  # две новейшие влезли, третья — уже нет


def test_window_always_keeps_newest_even_over_budget():
    history = [msg(10), msg(999)]
    window = _window(history, budget_tokens=5)
    assert window == [history[-1]]  # окно никогда не пустое


def test_window_preserves_order():
    history = [msg(1, "старое"), msg(1, "среднее"), msg(1, "новое")]
    assert [m.content for m in _window(history, 100)] == ["старое", "среднее", "новое"]


def test_window_falls_back_to_rough_count():
    # token_count=None -> оценка по длине текста, а не 0
    history = [msg(None, "б" * 400), msg(None, "а" * 400)]
    window = _window(history, budget_tokens=50)
    assert len(window) == 1


def test_rough_token_count_scale():
    assert rough_token_count("") == 1
    assert 90 <= rough_token_count("ф" * 400) <= 110  # ~4 символа на токен
