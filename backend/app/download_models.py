"""Downloads the two AI model files (about 11 MB) if they are missing."""
import urllib.request

from .config import FACE_MODEL, FACE_MODEL_URL, OBJECT_MODEL, OBJECT_MODEL_URL


def ensure_models() -> None:
    for path, url in ((FACE_MODEL, FACE_MODEL_URL), (OBJECT_MODEL, OBJECT_MODEL_URL)):
        if not path.exists():
            print(f"Downloading {path.name} ...")
            urllib.request.urlretrieve(url, path)


if __name__ == "__main__":
    ensure_models()
    print("Models ready.")
