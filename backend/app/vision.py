"""The "eyes" of the system: looks at one webcam picture and reports what it sees."""
import threading
from dataclasses import dataclass, field

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from .config import FACE_MODEL, OBJECT_MODEL, SFACE_MODEL
from .download_models import ensure_models
from .faceid import FaceEmbedder

# Things a candidate should not have next to them
WATCHED_OBJECTS = {"cell phone": "phone", "book": "book", "laptop": "laptop"}

# Face landmark numbers (from MediaPipe's 478-point face map)
NOSE_TIP, LEFT_EDGE, RIGHT_EDGE, BETWEEN_EYES, CHIN = 1, 234, 454, 168, 152
EYE_A, EYE_B = (33, 133), (362, 263)  # the two corners of each eye
MOUTH_A, MOUTH_B = 61, 291


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
    blink: bool = False  # eyes closed in this picture
    brightness: float = 128.0  # 0 = black picture, 255 = white
    thumb: np.ndarray | None = None  # tiny grey copy of the picture, to spot a frozen feed
    embedding: np.ndarray | None = None  # "face fingerprint" (only when asked for)


def normalize_image(data: bytes, longest_side: int = 800) -> bytes | None:
    """Decode any image, shrink it, and re-save as a clean JPEG (also removes hidden metadata)."""
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    scale = longest_side / max(bgr.shape[:2])
    if scale < 1:
        bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()


def _five_points(lm, w: int, h: int) -> np.ndarray:
    """The 5 key face points in pixels, ordered the way the face matcher wants."""
    pt = lambda i: np.array([lm[i].x * w, lm[i].y * h])  # noqa: E731
    eyes = sorted([(pt(EYE_A[0]) + pt(EYE_A[1])) / 2, (pt(EYE_B[0]) + pt(EYE_B[1])) / 2], key=lambda p: p[0])
    mouth = sorted([pt(MOUTH_A), pt(MOUTH_B)], key=lambda p: p[0])
    return np.array([eyes[0], eyes[1], pt(NOSE_TIP), mouth[0], mouth[1]])


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
        self._embedder = FaceEmbedder(SFACE_MODEL) if SFACE_MODEL.exists() else None

    @property
    def identity_available(self) -> bool:
        return self._embedder is not None

    def close(self) -> None:
        self._face.close()
        self._objects.close()

    def reference_embedding(self, jpeg: bytes) -> tuple[np.ndarray | None, str]:
        """Face fingerprint of a recruiter's reference photo. Returns (fingerprint, problem-to-show)."""
        if not self._embedder:
            return None, "Face matching is not available on this server."
        bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return None, "That file is not a valid image."
        rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        with self._lock:
            out = self._face.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if len(out.face_landmarks) == 0:
            return None, "No face found in the reference photo. Please use a clear, front-facing photo."
        if len(out.face_landmarks) > 1:
            return None, "More than one face found in the reference photo. Please use a photo of one person."
        h, w = bgr.shape[:2]
        emb = self._embedder.embed(bgr, _five_points(out.face_landmarks[0], w, h))
        return (emb, "") if emb is not None else (None, "Could not read the face in that photo.")

    def analyze(self, jpeg: bytes, want_embedding: bool = False) -> FrameResult | None:
        bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        h, w = bgr.shape[:2]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))

        with self._lock:
            face_out = self._face.detect(image)
            obj_out = self._objects.detect(image)

        result = FrameResult(
            faces=len(face_out.face_landmarks),
            brightness=float(gray.mean()),
            thumb=cv2.resize(gray, (32, 24), interpolation=cv2.INTER_AREA),
        )

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
                result.blink = (s.get("eyeBlinkLeft", 0) + s.get("eyeBlinkRight", 0)) / 2 > 0.5

            # Face fingerprints only work on a single, roughly front-facing face
            if (want_embedding and self._embedder and result.faces == 1 and result.yaw is not None
                    and 0.3 < result.yaw < 0.7 and 0.2 < result.pitch < 0.7):
                result.embedding = self._embedder.embed(bgr, _five_points(lm, w, h))
        return result
