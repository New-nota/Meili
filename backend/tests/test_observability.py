"""WP-0 (S8): structlog, request-id, глобальный обработчик исключений."""
from fastapi.testclient import TestClient

from app.main import app

# тестовый роут, кидающий необработанное исключение
@app.get("/_test/boom", include_in_schema=False)
async def _boom():
    raise RuntimeError("test explosion")


client = TestClient(app, raise_server_exceptions=False)


def test_response_has_request_id_header():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert "X-Request-ID" in resp.headers
    assert len(resp.headers["X-Request-ID"]) == 32  # uuid4().hex


def test_request_ids_are_unique_per_request():
    id1 = client.get("/health").headers["X-Request-ID"]
    id2 = client.get("/health").headers["X-Request-ID"]
    assert id1 != id2


def test_unhandled_exception_returns_500_with_request_id():
    resp = client.get("/_test/boom")
    assert resp.status_code == 500
    body = resp.json()
    assert body["detail"] == "internal error"
    assert body["request_id"]
    assert body["request_id"] != "unknown"
    assert resp.headers["X-Request-ID"] == body["request_id"]


def test_app_survives_exception():
    # процесс не упал: следующий запрос обрабатывается нормально
    client.get("/_test/boom")
    resp = client.get("/health")
    assert resp.status_code == 200


def test_request_log_line_written(capsys):
    client.get("/health")
    logged = capsys.readouterr().out
    # одна структурная строка с нужными полями
    assert '"event": "request"' in logged or '"event":"request"' in logged
    assert '"request_id"' in logged
    assert '"path": "/health"' in logged.replace('":"', '": "')
    assert '"duration_ms"' in logged
