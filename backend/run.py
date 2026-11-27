"""Start the backend on any system:  python run.py

Works even if you launch it with the wrong Python (e.g. VS Code's Run button):
it switches to the project's .venv automatically.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV_PYTHON = HERE / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def main() -> None:
    try:
        import uvicorn
        import fastapi  # noqa: F401
    except ModuleNotFoundError:
        if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
            print(f"Switching to the project's virtual environment: {VENV_PYTHON}")
            sys.exit(subprocess.call([str(VENV_PYTHON), str(Path(__file__).resolve())], cwd=HERE))
        sys.exit("Packages are missing. From the backend folder run:\n"
                 "  python -m venv .venv\n  .venv\\Scripts\\activate   (Mac/Linux: source .venv/bin/activate)\n"
                 "  pip install -r requirements.txt")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
