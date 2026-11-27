"""The "eyes" of the system: looks at one webcam picture and reports what it sees."""
import threading
from dataclasses import dataclass, field

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from .config import FACE_MODEL, OBJECT_MODEL
from .download_models import ensure_models

# Things a student should not have next to them during an exam
WATCHED_OBJECTS = {"cell phone": "phone", "book": "book", "laptop": "laptop"}

# Face landmark numbers (from MediaPipe's 478-point face map)
NOSE_TIP, LEFT_EDGE, RIGHT_EDGE, BETWEEN_EYES, CHIN = 1, 234, 454, 168, 152


@dataclass
class FrameResult:
    faces: int = 0
    persons: int = 0
    # Where the nose sits between the two cheeks (0.5 = facing the screen)
    yaw: float | None = None
    # Where the nose sits between the eyes and the chin
    pitch: float | None = None
    # How far the eyes are looking sideways (0 = straight, 1 = fully sideways)
    gaze_side: float = 0.0
    objects: list[str] = field(default_factory=list)


class FrameAnalyzer:
    # Models are loaded from memory (not by file path) so Windows folders with
    # accented / non-English characters in the user name can't break loading.
    def __init__(self) -> None:
        ensure_models()
        self._lock = threading.Lock()  # the AI models handle one picture at a time
        self._face = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_buffer=FACE_MODEL.read_bytes()),
                num_faces=3,
                output_face_blendshapes=True,
            )
        )
        self._objects = vision.ObjectDetector.create_from_options(
            vision.ObjectDetectorOptions(
                base_options=mp_python.BaseOptions(model_asset_buffer=OBJECT_MODEL.read_bytes()),
                score_threshold=0.45,
                category_allowlist=["person", *WATCHED_OBJECTS],
            )
        )

    def close(self) -> None:
        self._face.close()
        self._objects.close()

    def analyze(self, jpeg: bytes) -> FrameResult | None:
        bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))

        with self._lock:
            face_out = self._face.detect(image)
            obj_out = self._objects.detect(image)

        result = FrameResult(faces=len(face_out.face_landmarks))

        for det in obj_out.detections:
            name = det.categories[0].category_name
            if name == "person":
                if det.categories[0].score >= 0.6:
                    result.persons += 1
            elif name in WATCHED_OBJECTS:
                result.objects.append(WATCHED_OBJECTS[name])

        if result.faces:
            lm = face_out.face_landmarks[0]  # the biggest / most confident face
            width = lm[RIGHT_EDGE].x - lm[LEFT_EDGE].x
            height = lm[CHIN].y - lm[BETWEEN_EYES].y
            if width > 1e-4 and height > 1e-4:
                result.yaw = (lm[NOSE_TIP].x - lm[LEFT_EDGE].x) / width
                result.pitch = (lm[NOSE_TIP].y - lm[BETWEEN_EYES].y) / height

            if face_out.face_blendshapes:
                s = {c.category_name: c.score for c in face_out.face_blendshapes[0]}
                # Eyes glancing to one side. We use the size of the glance so it
                # works the same whether it's left or right.
                a = (s.get("eyeLookOutLeft", 0) + s.get("eyeLookInRight", 0)) / 2
                b = (s.get("eyeLookInLeft", 0) + s.get("eyeLookOutRight", 0)) / 2
                result.gaze_side = abs(a - b)
        return result
