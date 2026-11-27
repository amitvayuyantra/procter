"""Tiny SQLite storage: who took the exam, and what happened during it."""
import sqlite3
import threading
import time
import uuid

from .config import DB_PATH

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.executescript(
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, student_name TEXT, student_email TEXT,
        started_at REAL, finished_at REAL, score INTEGER, total INTEGER
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


def create_session(name: str, email: str) -> str:
    sid = uuid.uuid4().hex[:12]
    with _lock, _conn:
        _conn.execute(
            "INSERT INTO sessions (id, student_name, student_email, started_at) VALUES (?,?,?,?)",
            (sid, name, email, time.time()),
        )
    return sid


def get_session(sid: str) -> dict | None:
    rows = _all("SELECT * FROM sessions WHERE id=?", (sid,))
    return rows[0] if rows else None


def finish_session(sid: str, score: int, total: int) -> None:
    with _lock, _conn:
        _conn.execute(
            "UPDATE sessions SET finished_at=?, score=?, total=? WHERE id=?",
            (time.time(), score, total, sid),
        )


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
    return _all(
        """SELECT s.*, COALESCE(MIN(100, SUM(e.points)), 0) AS risk, COUNT(e.id) AS event_count
           FROM sessions s LEFT JOIN events e ON e.session_id = s.id
           GROUP BY s.id ORDER BY s.started_at DESC"""
    )
