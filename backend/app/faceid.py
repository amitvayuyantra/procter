"""Face matching: turns a face into a list of numbers so two faces can be compared.

Uses OpenCV's SFace model. Same person -> similarity about 0.5 to 1.0.
Different people -> about 0. (The model's own "same person" cut-off is 0.363.)
"""
import cv2
import numpy as np

# Where the 5 key points (eyes, nose, mouth corners) should land in the 112x112 aligned face
_TEMPLATE = np.float32([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                        [41.5493, 92.3655], [70.7299, 92.2041]])


class FaceEmbedder:
    def __init__(self, model_path) -> None:
        # Loaded from memory, not by file path, so non-English Windows folder names can't break it
        self._net = cv2.dnn.readNetFromONNX(np.frombuffer(model_path.read_bytes(), np.uint8))

    def embed(self, bgr: np.ndarray, points: np.ndarray) -> np.ndarray | None:
        """points: 5x2 pixel positions: [image-left eye, image-right eye, nose, image-left mouth corner, image-right mouth corner]."""
        matrix, _ = cv2.estimateAffinePartial2D(points.astype(np.float32), _TEMPLATE, method=cv2.LMEDS)
        if matrix is None:
            return None
        aligned = cv2.warpAffine(bgr, matrix, (112, 112))
        self._net.setInput(cv2.dnn.blobFromImage(aligned, 1.0, (112, 112), (0, 0, 0), swapRB=True))
        vec = self._net.forward().flatten()
        return (vec / np.linalg.norm(vec)).astype(np.float32)
