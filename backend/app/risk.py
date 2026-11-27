"""The "brain": turns what the camera sees into suspicious-behaviour events and a risk score.

It does not shout on a single odd frame. A problem must last a few seconds
before it counts, and the same problem can't repeat for a while (cooldown).
This keeps false alarms low.
"""
import statistics
from dataclasses import dataclass, field

from .vision import FrameResult

# Risk points added each time an event is recorded
POINTS = {
    "identity_check": 0,  # start-of-interview photo, for the recruiter to verify who it is
    "no_face": 5,
    "multiple_faces": 15,
    "looking_away": 3,
    "phone_detected": 20,
    "book_detected": 8,
    "laptop_detected": 10,
    "tab_hidden": 8,
    "window_blur": 4,
    "fullscreen_exit": 6,
    "copy_paste": 5,
    "right_click": 1,
}

# How many seconds a problem must continue before it is recorded
HOLD_SECONDS = {
    "no_face": 4.0,
    "multiple_faces": 2.0,
    "looking_away": 6.0,  # candidates look up to think and glance at notes, so be patient
    "phone_detected": 1.5,
    "book_detected": 3.0,
    "laptop_detected": 3.0,
}

COOLDOWN_SECONDS = 15.0  # same problem can't be recorded again within this time

# How far the candidate may turn from their normal pose (tweak to taste)
YAW_LIMIT = 0.16
PITCH_LIMIT = 0.18
GAZE_LIMIT = 0.55

CALIBRATION_FRAMES = 6  # first good frames are used to learn the candidate's "normal"


def level_for(score: int) -> str:
    return "high" if score >= 50 else "medium" if score >= 25 else "low"


@dataclass
class SessionMonitor:
    baseline_yaw: float = 0.5
    baseline_pitch: float = 0.45
    calibrated: bool = False
    _calib: list[tuple[float, float]] = field(default_factory=list)
    _since: dict[str, float] = field(default_factory=dict)
    _last_event: dict[str, float] = field(default_factory=dict)
    risk: int = 0
    last_frame: bytes | None = None

    # -- camera checks ---------------------------------------------------
    def flags_for(self, r: FrameResult) -> set[str]:
        """Which problems are visible in this single picture?"""
        flags: set[str] = set()
        if r.faces == 0:
            flags.add("no_face")
        if r.faces >= 2 or r.persons >= 2:
            flags.add("multiple_faces")
        for obj in set(r.objects):
            flags.add(f"{obj}_detected")

        if r.faces == 1 and r.yaw is not None and r.pitch is not None:
            if not self.calibrated:
                self._learn_normal(r)
            else:
                turned = abs(r.yaw - self.baseline_yaw) > YAW_LIMIT
                tilted = abs(r.pitch - self.baseline_pitch) > PITCH_LIMIT
                glancing = r.gaze_side > GAZE_LIMIT
                if turned or tilted or glancing:
                    flags.add("looking_away")
        return flags

    def _learn_normal(self, r: FrameResult) -> None:
        if r.gaze_side > GAZE_LIMIT:
            return
        self._calib.append((r.yaw, r.pitch))
        if len(self._calib) >= CALIBRATION_FRAMES:
            self.baseline_yaw = statistics.median(c[0] for c in self._calib)
            self.baseline_pitch = statistics.median(c[1] for c in self._calib)
            self.calibrated = True

    # -- turning flags into events --------------------------------------
    def due_events(self, flags: set[str], now: float) -> list[str]:
        """Which problems have lasted long enough to be recorded right now?"""
        due = []
        for kind, hold in HOLD_SECONDS.items():
            if kind not in flags:
                self._since.pop(kind, None)
                continue
            started = self._since.setdefault(kind, now)
            recently = now - self._last_event.get(kind, -1e9) < COOLDOWN_SECONDS
            if now - started >= hold and not recently:
                self._last_event[kind] = now
                due.append(kind)
        return due

    def browser_event_allowed(self, kind: str, now: float) -> bool:
        """Browser events (tab switch etc.) also get a short cooldown to avoid spam."""
        if kind not in POINTS or now - self._last_event.get(kind, -1e9) < 3.0:
            return False
        self._last_event[kind] = now
        return True
