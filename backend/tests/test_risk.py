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


def test_normal_student_has_no_flags():
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


def test_calibration_learns_each_students_normal_pose():
    m = SessionMonitor()
    for _ in range(CALIBRATION_FRAMES):
        m.flags_for(good(yaw=0.62))  # this student sits slightly off-centre
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
