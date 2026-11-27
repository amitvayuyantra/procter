import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")  # settings file works the same on Windows, Mac and Linux

DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"
EVIDENCE_DIR = DATA_DIR / "evidence"
REFERENCE_DIR = DATA_DIR / "reference"
DB_PATH = DATA_DIR / "interviews.db"

ADMIN_KEY = os.getenv("ADMIN_KEY", "admin123")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]

FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
OBJECT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"
SFACE_MODEL_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
FACE_MODEL = MODEL_DIR / "face_landmarker.task"
OBJECT_MODEL = MODEL_DIR / "efficientdet_lite0.tflite"
SFACE_MODEL = MODEL_DIR / "face_recognition_sface.onnx"  # optional: powers identity matching

for d in (DATA_DIR, MODEL_DIR, EVIDENCE_DIR, REFERENCE_DIR):
    d.mkdir(parents=True, exist_ok=True)
