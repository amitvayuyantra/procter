"""End-to-end: recruiter invites, candidate interviews, camera + browser events flow in, recruiter reviews."""
import os

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

os.environ["ADMIN_KEY"] = "test-key"

from app import main  # noqa: E402
from app.risk import CALIBRATION_FRAMES  # noqa: E402
from app.vision import FrameResult  # noqa: E402

BLANK = cv2.imencode(".jpg", np.zeros((240, 320, 3), np.uint8))[1].tobytes()
ADMIN = {"x-admin-key": "test-key"}
INVITE = {"candidate_name": "Ada", "candidate_email": "ada@example.com", "position": "Engineer", "template": "general"}


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # starts the server, loading the AI
        yield c


def test_only_recruiters_can_invite(client):
    assert client.post("/api/admin/invites", json=INVITE).status_code == 401
    assert client.post("/api/admin/invites", json={**INVITE, "template": "nope"}, headers=ADMIN).status_code == 400


def test_full_flow(client, monkeypatch):
    sid = client.post("/api/admin/invites", json=INVITE, headers=ADMIN).json()["session_id"]

    info = client.get(f"/api/interviews/{sid}").json()
    assert info["status"] == "invited" and info["seconds_left"] is None and len(info["questions"]) == 4

    # camera can't connect before the candidate starts
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/sessions/{sid}"):
            pass

    assert client.post(f"/api/interviews/{sid}/start").json()["seconds_left"] > 1000
    assert client.get(f"/api/interviews/{sid}").json()["status"] == "in_progress"

    fake_time = iter(range(0, 1000, 3))  # time runs fast so a 4-second problem takes a moment
    monkeypatch.setattr(main, "clock", lambda: next(fake_time))

    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        # 1. A clear face: after calibration the start-of-interview photo is saved
        with monkeypatch.context() as m:
            m.setattr(main.analyzer, "analyze", lambda b: FrameResult(faces=1, persons=1, yaw=0.5, pitch=0.45))
            events = []
            for _ in range(CALIBRATION_FRAMES + 2):
                ws.send_bytes(BLANK)
                reply = ws.receive_json()
                events += reply["new_events"]
            assert reply["calibrated"] and reply["risk"] == 0
            assert [e["type"] for e in events] == ["identity_check"]

        # 2. Candidate walks away from the camera
        events = []
        for _ in range(4):
            ws.send_bytes(BLANK)
            reply = ws.receive_json()
            events += reply["new_events"]
        assert reply["faces"] == 0 and "no_face" in reply["flags"]
        assert [e["type"] for e in events] == ["no_face"]

        # 3. Browser behaviour
        ws.send_json({"event": "tab_hidden"})
        assert ws.receive_json()["new_events"][0]["type"] == "tab_hidden"
        ws.send_json({"event": "identity_check"})  # a browser must not be able to fake this
        assert ws.receive_json()["new_events"] == []

    assert client.get(f"/api/admin/sessions/{sid}").status_code == 401
    detail = client.get(f"/api/admin/sessions/{sid}", headers=ADMIN).json()
    assert detail["risk"] == 13
    assert [e["type"] for e in detail["events"]] == ["identity_check", "no_face", "tab_hidden"]
    photo = detail["events"][0]["evidence"]
    assert client.get(f"/api/admin/evidence/{sid}/{photo}", headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/evidence/{sid}/..%2F..%2Finterviews.db", headers=ADMIN).status_code == 404

    assert client.post(f"/api/interviews/{sid}/submit", json={"answers": {"1": "Because I like it"}}).status_code == 200
    assert client.post(f"/api/interviews/{sid}/submit", json={"answers": {}}).status_code == 409
    assert client.post(f"/api/interviews/{sid}/start").status_code == 409

    detail = client.get(f"/api/admin/sessions/{sid}", headers=ADMIN).json()
    assert detail["status"] == "completed" and detail["qa"][0]["answer"] == "Because I like it"

    review = {"verdict": "cleared", "notes": "Was reading the question aloud"}
    assert client.put(f"/api/admin/sessions/{sid}/review", json=review, headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/sessions/{sid}", headers=ADMIN).json()["verdict"] == "cleared"

    row = next(r for r in client.get("/api/admin/sessions", headers=ADMIN).json() if r["id"] == sid)
    assert row["event_count"] == 2 and row["status"] == "completed"  # the ID photo is not a "concern"


def test_completed_interview_hides_questions(client):
    sid = client.post("/api/admin/invites", json=INVITE, headers=ADMIN).json()["session_id"]
    client.post(f"/api/interviews/{sid}/start")
    client.post(f"/api/interviews/{sid}/submit", json={"answers": {}})
    assert client.get(f"/api/interviews/{sid}").json()["questions"] == []
    assert client.get("/api/interviews/unknown").status_code == 404
