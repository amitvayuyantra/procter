"""Downloads the AI model files if they are missing (about 50 MB in total, once)."""
import urllib.request

from .config import FACE_MODEL, FACE_MODEL_URL, OBJECT_MODEL, OBJECT_MODEL_URL, SFACE_MODEL, SFACE_MODEL_URL


def _download(path, url) -> None:
    if not path.exists():
        print(f"Downloading {path.name} ...")
        tmp = path.with_suffix(path.suffix + ".part")  # so a cut-off download is never mistaken for a model
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)


def ensure_models() -> None:
    _download(FACE_MODEL, FACE_MODEL_URL)
    _download(OBJECT_MODEL, OBJECT_MODEL_URL)
    try:
        _download(SFACE_MODEL, SFACE_MODEL_URL)
    except Exception as e:  # identity matching is optional; everything else still works
        print(f"WARNING: could not download the face-matching model ({e}). Identity matching is switched off.")


if __name__ == "__main__":
    ensure_models()
    print("Models ready.")
