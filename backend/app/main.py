import asyncio
import hmac
import json
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .config import ADMIN_KEY, CORS_ORIGINS, EVIDENCE_DIR
from .exams import grade, public_exam
from .risk import POINTS, SessionMonitor, level_for
from .vision import FrameAnalyzer

analyzer: FrameAnalyzer | None = None
monitors: dict[str, SessionMonitor] = {}


def clock() -> float:
    return time.monotonic()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global analyzer
    analyzer = FrameAnalyzer()  # load the AI models once, when the server starts
    yield
    analyzer.close()


app = FastAPI(title="AI Proctor", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

BROWSER_EVENTS = {"tab_hidden", "window_blur", "fullscreen_exit", "copy_paste", "right_click"}
# Only these events get a camera snapshot saved as evidence
SNAPSHOT_EVENTS = {"no_face", "multiple_faces", "looking_away", "phone_detected", "book_detected",
                   "laptop_detected", "tab_hidden", "copy_paste"}


def require_admin(x_admin_key: str | None = Header(default=None), key: str | None = Query(default=None)) -> None:
    supplied = x_admin_key or key or ""
    if not hmac.compare_digest(supplied.encode(), ADMIN_KEY.encode()):
        raise HTTPException(401, "Wrong admin key")


# ----------------------------------------------------------------- student side
class StartBody(BaseModel):
    student_name: str = Field(min_length=1, max_length=100)
    student_email: str = Field(min_length=3, max_length=200)


@app.get("/api/exam")
def get_exam():
    return public_exam()


@app.post("/api/sessions")
def start_session(body: StartBody):
    return {"session_id": db.create_session(body.student_name.strip(), body.student_email.strip())}


class SubmitBody(BaseModel):
    answers: dict[str, int]


@app.post("/api/sessions/{sid}/submit")
def submit(sid: str, body: SubmitBody):
    session = db.get_session(sid)
    if not session:
        raise HTTPException(404, "Unknown session")
    if session["finished_at"]:
        raise HTTPException(409, "Already submitted")
    score, total = grade(body.answers)
    db.finish_session(sid, score, total)
    monitors.pop(sid, None)
    return {"score": score, "total": total}


def record(sid: str, kind: str, detail: str = "") -> dict:
    """Save an event, attach the latest camera snapshot, and update the risk score."""
    mon = monitors.setdefault(sid, SessionMonitor())
    evidence = None
    if kind in SNAPSHOT_EVENTS and mon.last_frame:
        folder = EVIDENCE_DIR / sid
        folder.mkdir(exist_ok=True)
        evidence = f"{int(time.time() * 1000)}_{kind}.jpg"
        (folder / evidence).write_bytes(mon.last_frame)
    event = db.add_event(sid, kind, POINTS[kind], detail, evidence)
    mon.risk = db.risk_score(sid)
    return event


def status(mon: SessionMonitor, faces: int, flags: set[str], new_events: list[dict]) -> dict:
    return {
        "faces": faces,
        "flags": sorted(flags),
        "risk": mon.risk,
        "level": level_for(mon.risk),
        "calibrated": mon.calibrated,
        "new_events": [{"type": e["type"], "points": e["points"]} for e in new_events],
    }


@app.websocket("/ws/sessions/{sid}")
async def proctor_socket(ws: WebSocket, sid: str):
    session = db.get_session(sid)
    if not session or session["finished_at"]:
        await ws.close(code=4404)
        return
    await ws.accept()
    mon = monitors.setdefault(sid, SessionMonitor())
    mon.risk = db.risk_score(sid)

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            new_events: list[dict] = []
            flags: set[str] = set()
            faces = 0

            if msg.get("bytes"):  # a webcam picture
                mon.last_frame = msg["bytes"]
                result = await asyncio.to_thread(analyzer.analyze, msg["bytes"])
                if result:
                    faces = result.faces
                    flags = mon.flags_for(result)
                    for kind in mon.due_events(flags, clock()):
                        new_events.append(record(sid, kind))
            elif msg.get("text"):  # a browser event (tab switch, copy, ...)
                data = json.loads(msg["text"])
                kind = data.get("event")
                if kind in BROWSER_EVENTS and mon.browser_event_allowed(kind, clock()):
                    new_events.append(record(sid, kind, str(data.get("detail", ""))[:200]))

            await ws.send_json(status(mon, faces, flags, new_events))
    except WebSocketDisconnect:
        pass


# ------------------------------------------------------------------ admin side
@app.get("/api/admin/sessions", dependencies=[Depends(require_admin)])
def admin_sessions():
    rows = db.list_sessions()
    for r in rows:
        r["level"] = level_for(r["risk"])
    return rows


@app.get("/api/admin/sessions/{sid}", dependencies=[Depends(require_admin)])
def admin_session(sid: str):
    session = db.get_session(sid)
    if not session:
        raise HTTPException(404, "Unknown session")
    risk = db.risk_score(sid)
    return {**session, "risk": risk, "level": level_for(risk), "events": db.list_events(sid)}


@app.get("/api/admin/evidence/{sid}/{name}", dependencies=[Depends(require_admin)])
def evidence(sid: str, name: str):
    path = (EVIDENCE_DIR / sid / name).resolve()
    if EVIDENCE_DIR.resolve() not in path.parents or not path.is_file():  # block ../ tricks
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg")
