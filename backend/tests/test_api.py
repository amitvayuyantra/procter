"""End-to-end: recruiter invites, candidate interviews, camera + browser events flow in, recruiter reviews."""
import base64
import os
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

os.environ["ADMIN_KEY"] = "test-key"

from app import db, main  # noqa: E402
from app.risk import CALIBRATION_FRAMES  # noqa: E402
from app.vision import FrameResult  # noqa: E402

GREY = cv2.imencode(".jpg", np.full((240, 320, 3), 128, np.uint8))[1].tobytes()  # empty room
BLACK = cv2.imencode(".jpg", np.zeros((240, 320, 3), np.uint8))[1].tobytes()  # covered camera
FACE = (Path(__file__).parent / "data" / "astronaut.jpg").read_bytes()  # NASA public-domain portrait
ADMIN = {"x-admin-key": "test-key"}
INVITE = {"candidate_name": "Ada", "candidate_email": "ada@example.com", "position": "Engineer", "template": "general"}


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # starts the server, loading the AI
        yield c


def new_interview(client, **extra):
    sid = client.post("/api/admin/invites", json={**INVITE, **extra}, headers=ADMIN).json()["session_id"]
    client.post(f"/api/interviews/{sid}/start")
    return sid


def admin_view(client, sid):
    return client.get(f"/api/admin/sessions/{sid}", headers=ADMIN).json()


def fake_camera(monkeypatch, **fields):
    """Pretend the camera sees a face with these properties. Returns a dict you can change on the fly."""
    state = {"yaw": 0.5, "embedding": None, **fields}
    monkeypatch.setattr(main.analyzer, "analyze", lambda frame, want=False: FrameResult(
        faces=1, persons=1, yaw=state["yaw"], pitch=0.45, embedding=state["embedding"]))
    return state


def send(ws, frame=GREY):
    ws.send_bytes(frame)
    return ws.receive_json()


def turn_head(ws, cam, reply):
    side = 1 if reply["challenge_first"] == "left" else -1
    cam["yaw"] = 0.5 + side * 0.2
    send(ws)
    cam["yaw"] = 0.5 - side * 0.2
    reply = send(ws)
    cam["yaw"] = 0.5
    return reply


@pytest.fixture
def fast_clock(monkeypatch):
    ticks = iter(range(0, 10_000, 3))  # every picture takes 3 "seconds", so long waits are quick
    monkeypatch.setattr(main, "clock", lambda: next(ticks))


def test_only_recruiters_can_invite(client):
    assert client.post("/api/admin/invites", json=INVITE).status_code == 401
    assert client.post("/api/admin/invites", json={**INVITE, "template": "nope"}, headers=ADMIN).status_code == 400


def test_full_flow(client, monkeypatch, fast_clock):
    sid = client.post("/api/admin/invites", json=INVITE, headers=ADMIN).json()["session_id"]
    info = client.get(f"/api/interviews/{sid}").json()
    assert info["status"] == "invited" and info["seconds_left"] is None and len(info["questions"]) == 4

    with pytest.raises(WebSocketDisconnect):  # camera can't connect before the candidate starts
        with client.websocket_connect(f"/ws/sessions/{sid}"):
            pass
    assert client.post(f"/api/interviews/{sid}/start").json()["seconds_left"] > 1000

    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        with monkeypatch.context() as m:
            cam = fake_camera(m)
            for _ in range(CALIBRATION_FRAMES):
                reply = send(ws)
            assert reply["calibrated"] and reply["challenge"] == "active"
            assert set(reply) == {"faces", "flags", "calibrated", "challenge", "challenge_first",
                                  "challenge_progress", "new_events"}  # no scores leak to the candidate
            assert turn_head(ws, cam, reply)["challenge"] == "passed"

        events = [e for _ in range(4) for e in send(ws)["new_events"]]  # empty room
        assert [e["type"] for e in events] == ["no_face"]
        events = [e for _ in range(4) for e in send(ws, BLACK)["new_events"]]  # camera covered
        assert [e["type"] for e in events] == ["camera_blocked"]

        ws.send_json({"event": "tab_hidden"})
        assert ws.receive_json()["new_events"][0]["type"] == "tab_hidden"
        ws.send_json({"event": "identity_check"})  # a browser must not be able to fake this
        assert ws.receive_json()["new_events"] == []

    assert client.get(f"/api/admin/sessions/{sid}").status_code == 401
    detail = admin_view(client, sid)
    assert [e["type"] for e in detail["events"]] == [
        "identity_check", "liveness_passed", "no_face", "camera_blocked", "tab_hidden"]
    assert detail["risk"] == 23 and detail["liveness"] == "passed" and not detail["has_reference"]
    assert "reference_embedding" not in detail
    photo = detail["events"][0]["evidence"]
    assert client.get(f"/api/admin/evidence/{sid}/{photo}", headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/evidence/{sid}/..%2F..%2Finterviews.db", headers=ADMIN).status_code == 404

    assert client.post(f"/api/interviews/{sid}/submit", json={"answers": {"1": "Because I like it"}}).status_code == 200
    assert client.post(f"/api/interviews/{sid}/submit", json={"answers": {}}).status_code == 409
    assert client.post(f"/api/interviews/{sid}/start").status_code == 409
    detail = admin_view(client, sid)
    assert detail["status"] == "completed" and detail["qa"][0]["answer"] == "Because I like it"

    review = {"verdict": "cleared", "notes": "Was reading the question aloud"}
    assert client.put(f"/api/admin/sessions/{sid}/review", json=review, headers=ADMIN).status_code == 200
    assert admin_view(client, sid)["verdict"] == "cleared"
    row = next(r for r in client.get("/api/admin/sessions", headers=ADMIN).json() if r["id"] == sid)
    assert row["event_count"] == 3 and row["status"] == "completed"  # ID photo and passed checks are not "concerns"


def test_failing_the_head_turn_check_is_recorded(client, monkeypatch, fast_clock):
    sid = new_interview(client)
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws, monkeypatch.context() as m:
        fake_camera(m)  # a picture that never moves
        replies = [send(ws) for _ in range(CALIBRATION_FRAMES + 12)]
    assert replies[-1]["challenge"] == "failed"
    detail = admin_view(client, sid)
    assert detail["liveness"] == "failed" and detail["risk"] == 15


def test_reference_photo_rejects_bad_uploads(client):
    def invite(photo):
        return client.post("/api/admin/invites", json={**INVITE, "reference_photo": photo}, headers=ADMIN)

    assert invite(base64.b64encode(GREY).decode()).status_code == 400  # no face in it
    assert "No face" in invite(base64.b64encode(GREY).decode()).json()["detail"]
    assert invite("not-base64!!").status_code == 400
    assert invite(base64.b64encode(b"hello").decode()).status_code == 400  # not an image


def test_same_face_matches_reference_photo(client):
    """Real face recognition on a real photo."""
    ref = "data:image/jpeg;base64," + base64.b64encode(FACE).decode()
    sid = client.post("/api/admin/invites", json={**INVITE, "reference_photo": ref}, headers=ADMIN).json()["session_id"]
    assert client.get(f"/api/admin/reference/{sid}", headers=ADMIN).status_code == 200
    assert client.get(f"/api/admin/reference/{sid}").status_code == 401
    assert client.get("/api/admin/reference/nope", headers=ADMIN).status_code == 404

    client.post(f"/api/interviews/{sid}/start")
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        for _ in range(CALIBRATION_FRAMES + 2):
            send(ws, FACE)  # the "camera" shows the same face, re-compressed
    detail = admin_view(client, sid)
    assert detail["has_reference"] and detail["identity_label"] == "match" and detail["identity_score"] > 0.8
    assert "identity_mismatch" not in [e["type"] for e in detail["events"]]


def test_other_face_and_mid_interview_swap(client, monkeypatch, fast_clock):
    ref = base64.b64encode(FACE).decode()
    sid = new_interview(client, reference_photo=ref)
    reference = np.array(db.get_session(sid)["reference_embedding"], dtype=np.float32)
    stranger = np.random.default_rng(1).normal(size=reference.shape).astype(np.float32)
    stranger -= (stranger @ reference) * reference  # make it completely unlike the reference
    stranger /= np.linalg.norm(stranger)

    with client.websocket_connect(f"/ws/sessions/{sid}") as ws, monkeypatch.context() as m:
        cam = fake_camera(m, embedding=stranger)  # a different face than the reference photo
        for _ in range(CALIBRATION_FRAMES):
            reply = send(ws)
        turn_head(ws, cam, reply)
        cam["embedding"] = reference  # now the reference person sits down...
        for _ in range(3):
            send(ws)
        cam["embedding"] = stranger  # ...and the first person comes back
        for _ in range(5):
            send(ws)
    detail = admin_view(client, sid)
    kinds = [e["type"] for e in detail["events"]]
    assert detail["identity_label"] == "mismatch" and "identity_mismatch" in kinds and "different_person" in kinds
