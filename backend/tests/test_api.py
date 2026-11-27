"""End-to-end: student starts exam, camera frames + browser events flow in, admin sees them."""
import os

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

os.environ["ADMIN_KEY"] = "test-key"

from app import main  # noqa: E402

BLANK = cv2.imencode(".jpg", np.zeros((240, 320, 3), np.uint8))[1].tobytes()
ADMIN = {"x-admin-key": "test-key"}


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # starts the server, loading the AI
        yield c


def test_full_flow(client, monkeypatch):
    sid = client.post("/api/sessions", json={"student_name": "Ada", "student_email": "ada@example.com"}).json()["session_id"]

    # make "time" run fast so a 4-second problem takes a moment in the test
    fake_time = iter(range(0, 1000, 3))
    monkeypatch.setattr(main, "clock", lambda: next(fake_time))

    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        events = []
        for _ in range(4):  # empty room, frame after frame
            ws.send_bytes(BLANK)
            reply = ws.receive_json()
            events += reply["new_events"]
        assert reply["faces"] == 0 and "no_face" in reply["flags"]
        assert [e["type"] for e in events] == ["no_face"]

        ws.send_json({"event": "tab_hidden"})
        assert ws.receive_json()["new_events"][0]["type"] == "tab_hidden"
        ws.send_json({"event": "not_a_real_event"})  # junk is ignored
        assert ws.receive_json()["new_events"] == []

    assert client.get(f"/api/admin/sessions/{sid}").status_code == 401  # no key -> no entry
    detail = client.get(f"/api/admin/sessions/{sid}", headers=ADMIN).json()
    assert detail["risk"] == 13 and [e["type"] for e in detail["events"]] == ["no_face", "tab_hidden"]
    ev = detail["events"][0]["evidence"]
    assert client.get(f"/api/admin/evidence/{sid}/{ev}", headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/evidence/{sid}/..%2F..%2Fproctor.db", headers=ADMIN).status_code == 404

    done = client.post(f"/api/sessions/{sid}/submit", json={"answers": {"1": 2, "2": 1, "3": 9}}).json()
    assert done == {"score": 2, "total": 5}
    assert client.post(f"/api/sessions/{sid}/submit", json={"answers": {}}).status_code == 409


def test_exam_hides_answers(client):
    assert all("answer" not in q for q in client.get("/api/exam").json()["questions"])
