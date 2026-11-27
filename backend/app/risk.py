"""The "brain": turns what the camera sees into suspicious-behaviour events and a risk score.

It does not shout on a single odd frame. A problem must last a few seconds
before it counts, and the same problem can't repeat for a while (cooldown).
This keeps false alarms low.
"""
import random
import statistics
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from .vision import FrameResult

# Risk points added each time an event is recorded
POINTS = {
    "identity_check": 0,  # start-of-interview photo, for the recruiter to verify who it is
    "liveness_passed": 0,
    "identity_mismatch": 25,  # face does not match the recruiter's reference photo
    "different_person": 35,  # someone else took over mid-interview
    "liveness_failed": 15,  # did not complete the head-turn check
    "static_feed": 25,  # camera shows a still picture / frozen video
    "camera_blocked": 10,
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
    "camera_blocked": 3.0,
    "different_person": 2.0,
    "static_feed": 5.0,
}

COOLDOWN_SECONDS = 15.0  # same problem can't be recorded again within this time
COOLDOWNS = {"different_person": 60.0, "static_feed": 60.0, "camera_blocked": 30.0}

# How far the candidate may turn from their normal pose (tweak to taste)
YAW_LIMIT = 0.16
PITCH_LIMIT = 0.18
GAZE_LIMIT = 0.55

CALIBRATION_FRAMES = 6  # first good frames are used to learn the candidate's "normal"

# --- identity (face matching) ---
MISMATCH_THRESHOLD = 0.30  # below this, the face does not match the reference photo (model's own cut-off is 0.363)
SWAP_THRESHOLD = 0.30  # below this, it's not the same person who started the interview
SWAP_CHECKS = 2  # ...this many checks in a row (a check runs about every 2 seconds)
EMBED_EVERY = 4  # check the face every 4th picture

# --- liveness ---
TURN_LIMIT = 0.12  # how far the head must turn (about 15 degrees) in the head-turn check
CHALLENGE_SECONDS = 25.0
STATIC_WINDOW = 30.0  # a "still picture" needs this long with no blink and almost no movement
STILL_POSE = 0.006  # head position moves less than this (live people sway more)
STILL_PIXELS = 1.0  # picture changes less than this between frames

# --- camera integrity ---
BLOCKED_BRIGHTNESS = 18  # practically black: camera covered
DIM_BRIGHTNESS = 50  # dark room (we only tell the candidate; it is not recorded)

MATCH_THRESHOLD = 0.363  # the face matcher's own "same person" cut-off


def level_for(score: int) -> str:
    return "high" if score >= 50 else "medium" if score >= 25 else "low"


def identity_label(score: float | None) -> str | None:
    if score is None:
        return None
    return "match" if score >= MATCH_THRESHOLD else "mismatch" if score < MISMATCH_THRESHOLD else "uncertain"


@dataclass
class SessionMonitor:
    baseline_yaw: float = 0.5
    baseline_pitch: float = 0.45
    calibrated: bool = False
    risk: int = 0
    last_frame: bytes | None = None

    # identity
    reference: np.ndarray | None = None  # recruiter's reference photo fingerprint
    session_embedding: np.ndarray | None = None  # this candidate's fingerprint at the start
    identity_score: float | None = None
    identity_saved: bool = False

    # head-turn liveness check: "waiting" -> "active" -> "passed" / "failed"
    challenge: str = "waiting"
    challenge_first: str = "left"
    challenge_progress: int = 0

    _calib: list[tuple[float, float]] = field(default_factory=list)
    _calib_emb: list[np.ndarray] = field(default_factory=list)
    _since: dict[str, float] = field(default_factory=dict)
    _last_event: dict[str, float] = field(default_factory=dict)
    _announced: bool = False
    _deadline: float = 0.0
    _frames: int = 0
    _low_sim: int = 0
    _static: bool = False
    _last_blink: float = 0.0
    _prev_thumb: np.ndarray | None = None
    _samples: deque = field(default_factory=deque)

    # -- the one call per camera picture ---------------------------------
    def wants_embedding(self) -> bool:
        """Ask once per picture: should the (slower) face fingerprint be computed for it?"""
        self._frames += 1
        if not self.calibrated:
            return True
        return self.session_embedding is not None and self.challenge != "active" and self._frames % EMBED_EVERY == 0

    def process(self, r: FrameResult, now: float) -> tuple[set[str], list[tuple[str, str]]]:
        """Returns (problems visible right now, one-off events to record)."""
        flags = self.flags_for(r)
        events = self._observe(r, now)
        if self._low_sim >= SWAP_CHECKS:
            flags.add("different_person")
        if self._static:
            flags.add("static_feed")
        return flags, events

    # -- camera checks ---------------------------------------------------
    def flags_for(self, r: FrameResult) -> set[str]:
        """Which problems are visible in this single picture?"""
        flags: set[str] = set()
        blocked = r.brightness < BLOCKED_BRIGHTNESS
        testing_head_turn = self.challenge == "active"  # turning the head is expected right now
        if blocked:
            flags.add("camera_blocked")
        elif r.brightness < DIM_BRIGHTNESS:
            flags.add("low_light")
        if r.faces == 0 and not blocked and not testing_head_turn:
            flags.add("no_face")
        if r.faces >= 2 or r.persons >= 2:
            flags.add("multiple_faces")
        for obj in set(r.objects):
            flags.add(f"{obj}_detected")

        if r.faces == 1 and r.yaw is not None and r.pitch is not None:
            if not self.calibrated:
                self._learn_normal(r)
            elif not testing_head_turn:
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
        if r.embedding is not None:
            self._calib_emb.append(r.embedding)
        if len(self._calib) >= CALIBRATION_FRAMES:
            self.baseline_yaw = statistics.median(c[0] for c in self._calib)
            self.baseline_pitch = statistics.median(c[1] for c in self._calib)
            self.calibrated = True

    # -- identity, liveness, frozen feed ---------------------------------
    def _observe(self, r: FrameResult, now: float) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        if not self.calibrated:
            return events

        if not self._announced:  # the moment we first got a clear look at the candidate
            self._announced = True
            events.append(("identity_check", "Start-of-interview photo"))
            if self._calib_emb:
                mean = np.mean(self._calib_emb, axis=0)
                self.session_embedding = (mean / np.linalg.norm(mean)).astype(np.float32)
                if self.reference is not None:
                    self.identity_score = float(self.reference @ self.session_embedding)
                    if self.identity_score < MISMATCH_THRESHOLD:
                        events.append(("identity_mismatch", f"Similarity to reference photo: {self.identity_score:.2f}"))
            self.challenge = "active"
            self.challenge_first = random.choice(("left", "right"))
            self._deadline = now + CHALLENGE_SECONDS
            self._restart_passive_clock(now)
            return events

        if self.challenge == "active":
            self._update_challenge(r, now, events)
            return events

        # Same person all the way through?
        if self.session_embedding is not None and r.embedding is not None and r.faces == 1 \
                and r.yaw is not None and abs(r.yaw - self.baseline_yaw) < YAW_LIMIT:
            similarity = float(self.session_embedding @ r.embedding)
            self._low_sim = self._low_sim + 1 if similarity < SWAP_THRESHOLD else 0

        self._update_static_check(r, now)
        return events

    def _update_challenge(self, r: FrameResult, now: float, events: list) -> None:
        if r.faces == 1 and r.yaw is not None:
            to_the_left = 1 if self.challenge_first == "left" else -1  # + means the candidate turned to their own left
            dev = (r.yaw - self.baseline_yaw) * to_the_left
            if self.challenge_progress == 0 and dev > TURN_LIMIT:
                self.challenge_progress = 1
            elif self.challenge_progress == 1 and -dev > TURN_LIMIT:
                self.challenge_progress = 2
        if self.challenge_progress == 2:
            self.challenge = "passed"
            events.append(("liveness_passed", "Completed the head-turn check"))
            self._restart_passive_clock(now)
        elif now >= self._deadline:
            self.challenge = "failed"
            events.append(("liveness_failed", "Did not complete the head-turn check"))
            self._restart_passive_clock(now)

    def _restart_passive_clock(self, now: float) -> None:
        self._last_blink = now
        self._samples.clear()
        self._prev_thumb = None
        self._static = False

    def _update_static_check(self, r: FrameResult, now: float) -> None:
        """A live person blinks and sways. A photo or frozen video does neither for a long time."""
        if r.faces != 1 or r.yaw is None or r.pitch is None:
            self._samples.clear()
            self._prev_thumb = None
            self._static = False
            return
        if r.blink:
            self._last_blink = now
        diff = None
        if r.thumb is not None:
            thumb = r.thumb.astype(np.int16)
            if self._prev_thumb is not None:
                diff = float(np.mean(np.abs(thumb - self._prev_thumb)))
            self._prev_thumb = thumb
        self._samples.append((now, r.yaw, r.pitch, diff))
        while now - self._samples[0][0] > STATIC_WINDOW:
            self._samples.popleft()

        enough_history = now - self._samples[0][0] >= STATIC_WINDOW - 2
        no_blink = now - self._last_blink >= STATIC_WINDOW
        yaws = [s[1] for s in self._samples]
        pitches = [s[2] for s in self._samples]
        diffs = [s[3] for s in self._samples if s[3] is not None]
        still = (max(yaws) - min(yaws) < STILL_POSE and max(pitches) - min(pitches) < STILL_POSE
                 and (not diffs or statistics.fmean(diffs) < STILL_PIXELS))
        self._static = enough_history and no_blink and still

    # -- turning flags into events --------------------------------------
    def due_events(self, flags: set[str], now: float) -> list[str]:
        """Which problems have lasted long enough to be recorded right now?"""
        due = []
        for kind, hold in HOLD_SECONDS.items():
            if kind not in flags:
                self._since.pop(kind, None)
                continue
            started = self._since.setdefault(kind, now)
            recently = now - self._last_event.get(kind, -1e9) < COOLDOWNS.get(kind, COOLDOWN_SECONDS)
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
