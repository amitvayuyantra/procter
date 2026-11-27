"""Tiny SQLite storage: who was invited, what they answered, and what happened during the interview."""
import json
import secrets
import sqlite3
import threading
import time

from .config import DB_PATH

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.executescript(
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, candidate_name TEXT, candidate_email TEXT, position TEXT, template TEXT,
        created_at REAL, started_at REAL, finished_at REAL, answers TEXT,
        verdict TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, type TEXT,
        points INTEGER, detail TEXT, evidence TEXT, created_at REAL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    """
)


def _all(sql: str, args: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in _conn.execute(sql, args).fetchall()]


def status_of(row: dict) -> str:
    return "completed" if row["finished_at"] else "in_progress" if row["started_at"] else "invited"


def create_session(name: str, email: str, position: str, template: str) -> str:
    sid = secrets.token_urlsafe(9)  # hard to guess: this is the candidate's private link
    with _lock, _conn:
        _conn.execute(
            "INSERT INTO sessions (id, candidate_name, candidate_email, position, template, created_at) VALUES (?,?,?,?,?,?)",
            (sid, name, email, position, template, time.time()),
        )
    return sid


def get_session(sid: str) -> dict | None:
    rows = _all("SELECT * FROM sessions WHERE id=?", (sid,))
    if not rows:
        return None
    row = rows[0]
    row["answers"] = json.loads(row["answers"]) if row["answers"] else {}
    row["status"] = status_of(row)
    return row


def start_session(sid: str) -> None:
    """Starts the clock the first time only, so reopening the link can't reset the timer."""
    with _lock, _conn:
        _conn.execute("UPDATE sessions SET started_at=? WHERE id=? AND started_at IS NULL", (time.time(), sid))


def finish_session(sid: str, answers: dict[str, str]) -> None:
    with _lock, _conn:
        _conn.execute("UPDATE sessions SET finished_at=?, answers=? WHERE id=?", (time.time(), json.dumps(answers), sid))


def set_review(sid: str, verdict: str, notes: str) -> None:
    with _lock, _conn:
        _conn.execute("UPDATE sessions SET verdict=?, notes=? WHERE id=?", (verdict, notes, sid))


def add_event(sid: str, kind: str, points: int, detail: str = "", evidence: str | None = None) -> dict:
    now = time.time()
    with _lock, _conn:
        cur = _conn.execute(
            "INSERT INTO events (session_id, type, points, detail, evidence, created_at) VALUES (?,?,?,?,?,?)",
            (sid, kind, points, detail, evidence, now),
        )
    return {"id": cur.lastrowid, "type": kind, "points": points, "detail": detail,
            "evidence": evidence, "created_at": now}


def risk_score(sid: str) -> int:
    rows = _all("SELECT COALESCE(SUM(points),0) AS p FROM events WHERE session_id=?", (sid,))
    return min(100, int(rows[0]["p"]))


def list_events(sid: str) -> list[dict]:
    return _all("SELECT * FROM events WHERE session_id=? ORDER BY created_at", (sid,))


def list_sessions() -> list[dict]:
    rows = _all(
        """SELECT s.id, s.candidate_name, s.candidate_email, s.position, s.created_at, s.started_at,
                  s.finished_at, s.verdict,
                  COALESCE(MIN(100, SUM(e.points)), 0) AS risk,
                  COUNT(CASE WHEN e.points > 0 THEN 1 END) AS event_count
           FROM sessions s LEFT JOIN events e ON e.session_id = s.id
           GROUP BY s.id ORDER BY s.created_at DESC"""
    )
    for r in rows:
        r["status"] = status_of(r)
    return rows
