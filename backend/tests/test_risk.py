from app.risk import CALIBRATION_FRAMES, SessionMonitor, level_for
from app.vision import FrameResult


def good(yaw=0.5, pitch=0.45, gaze=0.0, **kw):
    return FrameResult(faces=1, persons=1, yaw=yaw, pitch=pitch, gaze_side=gaze, **kw)


def calibrated_monitor():
    m = SessionMonitor()
    for _ in range(CALIBRATION_FRAMES):
        m.flags_for(good())
    assert m.calibrated
    return m


def test_normal_candidate_has_no_flags():
    assert calibrated_monitor().flags_for(good()) == set()


def test_turning_head_is_flagged():
    assert "looking_away" in calibrated_monitor().flags_for(good(yaw=0.75))


def test_glancing_sideways_is_flagged():
    assert "looking_away" in calibrated_monitor().flags_for(good(gaze=0.8))


def test_no_face_and_multiple_faces():
    m = calibrated_monitor()
    assert "no_face" in m.flags_for(FrameResult())
    assert "multiple_faces" in m.flags_for(FrameResult(faces=2, yaw=0.5, pitch=0.45))


def test_phone_flagged():
    assert "phone_detected" in calibrated_monitor().flags_for(good(objects=["phone"]))


def test_calibration_learns_each_candidates_normal_pose():
    m = SessionMonitor()
    for _ in range(CALIBRATION_FRAMES):
        m.flags_for(good(yaw=0.62))  # this candidate sits slightly off-centre
    assert m.flags_for(good(yaw=0.62)) == set()


def test_short_glitch_is_ignored_but_sustained_problem_counts_once():
    m = SessionMonitor()
    assert m.due_events({"no_face"}, now=0) == []
    assert m.due_events(set(), now=1) == []          # came back -> timer resets
    assert m.due_events({"no_face"}, now=2) == []
    assert m.due_events({"no_face"}, now=7) == ["no_face"]  # 5s straight
    assert m.due_events({"no_face"}, now=9) == []    # cooldown, no spam
    assert m.due_events({"no_face"}, now=30) == ["no_face"]


def test_levels():
    assert (level_for(0), level_for(25), level_for(50)) == ("low", "medium", "high")


# ------------------------------------------------------------------ advanced vision
import numpy as np  # noqa: E402

from app.risk import CHALLENGE_SECONDS, MISMATCH_THRESHOLD, STATIC_WINDOW, SWAP_CHECKS  # noqa: E402

V, W = np.eye(128, dtype=np.float32)[0], np.eye(128, dtype=np.float32)[1]  # two completely different "faces"
STILL = np.full((24, 32), 100, np.uint8)


def start_interview(reference=None, face=V):
    """Run the first few pictures so the monitor has calibrated and begun the head-turn check."""
    m = SessionMonitor()
    m.reference = reference
    events, t = [], 0.0
    for _ in range(CALIBRATION_FRAMES):
        _, ev = m.process(good(embedding=face, thumb=STILL), t)
        events += ev
        t += 0.5
    return m, events, t


def pass_head_turn(m, t):
    side = 1 if m.challenge_first == "left" else -1
    m.process(good(yaw=0.5 + side * 0.2), t)
    _, ev = m.process(good(yaw=0.5 - side * 0.2), t + 1)
    return ev, t + 2


def test_start_photo_is_taken_and_head_turn_check_begins():
    m, events, _ = start_interview()
    assert [e[0] for e in events] == ["identity_check"]
    assert m.challenge == "active" and m.challenge_first in ("left", "right")


def test_head_turn_in_the_asked_order_passes():
    m, _, t = start_interview()
    ev, _ = pass_head_turn(m, t)
    assert m.challenge == "passed" and [e[0] for e in ev] == ["liveness_passed"]


def test_wrong_order_or_not_turning_fails_after_time_limit():
    m, _, t = start_interview()
    side = 1 if m.challenge_first == "left" else -1
    m.process(good(yaw=0.5 - side * 0.2), t)  # turned the wrong way first
    assert m.challenge_progress == 0
    _, ev = m.process(good(), t + CHALLENGE_SECONDS + 1)
    assert m.challenge == "failed" and [e[0] for e in ev] == ["liveness_failed"]


def test_turning_head_during_the_check_is_not_reported_as_looking_away():
    m, _, t = start_interview()
    flags, _ = m.process(good(yaw=0.8), t)
    assert "looking_away" not in flags
    m.challenge = "passed"
    assert "looking_away" in m.process(good(yaw=0.8), t + 1)[0]


def test_matching_reference_photo():
    m, events, _ = start_interview(reference=V, face=V)
    assert m.identity_score > 0.99 and "identity_mismatch" not in [e[0] for e in events]


def test_different_face_from_reference_photo_is_flagged():
    m, events, _ = start_interview(reference=V, face=W)
    assert m.identity_score < MISMATCH_THRESHOLD
    assert "identity_mismatch" in [e[0] for e in events]


def test_person_swap_mid_interview():
    m, _, t = start_interview(face=V)
    _, t = pass_head_turn(m, t)
    # the same person: nothing
    flags, _ = m.process(good(embedding=V), t)
    assert "different_person" not in flags
    # someone else sits down: needs a couple of checks in a row, then lasts 2 seconds
    for i in range(SWAP_CHECKS):
        flags, _ = m.process(good(embedding=W), t + 1 + i)
    assert "different_person" in flags
    assert m.due_events(flags, 100) == []
    assert "different_person" in m.due_events(flags, 103)
    # one glitch between two good checks does not count
    m2, _, t2 = start_interview(face=V)
    _, t2 = pass_head_turn(m2, t2)
    m2.process(good(embedding=W), t2)
    m2.process(good(embedding=V), t2 + 1)
    assert "different_person" not in m2.process(good(embedding=W), t2 + 2)[0]


def test_covered_camera_is_not_reported_as_missing_face():
    flags = SessionMonitor().flags_for(FrameResult(brightness=3))
    assert "camera_blocked" in flags and "no_face" not in flags


def test_dark_room_only_gives_a_hint():
    flags = calibrated_monitor().flags_for(good(brightness=35))
    assert "low_light" in flags
    assert "low_light" not in __import__("app.risk", fromlist=["HOLD_SECONDS"]).HOLD_SECONDS  # never becomes an event


def run_seconds(m, seconds, t, **frame):
    flags = set()
    for _ in range(int(seconds * 2)):
        flags, _ = m.process(good(thumb=STILL, **frame), t)
        t += 0.5
    return flags, t


def passed_monitor():
    m, _, t = start_interview()
    _, t = pass_head_turn(m, t)
    return m, t


def test_frozen_picture_is_detected():
    m, t = passed_monitor()
    flags, t = run_seconds(m, STATIC_WINDOW - 8, t)
    assert "static_feed" not in flags  # not long enough yet
    flags, t = run_seconds(m, 12, t)
    assert "static_feed" in flags


def test_a_blink_or_head_sway_proves_a_live_person():
    m, t = passed_monitor()
    _, t = run_seconds(m, STATIC_WINDOW - 5, t)
    m.process(good(thumb=STILL, blink=True), t)  # one blink resets the clock
    flags, t = run_seconds(m, 10, t + 0.5)
    assert "static_feed" not in flags

    m2, t2 = passed_monitor()
    flags = set()
    for i in range(int((STATIC_WINDOW + 10) * 2)):  # gentle sway, never blinks
        flags, _ = m2.process(good(yaw=0.5 + 0.015 * (i % 2), thumb=STILL), t2)
        t2 += 0.5
    assert "static_feed" not in flags
