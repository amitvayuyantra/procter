# AI Proctor

An online exam system that watches for cheating using AI.

- **Backend** – Python (FastAPI + MediaPipe + OpenCV)
- **Frontend** – Next.js (React, TypeScript, Tailwind)

## What it catches

| Check | How |
|---|---|
| Face missing / more than one person | MediaPipe face landmarks + person detector |
| Looking away (head turn, eye glance) | Nose position & eye-direction, compared with the student's *own* normal pose (auto-calibrated in the first seconds) |
| Phone, book, extra laptop | EfficientDet object detector |
| Tab switch, leaving full screen, copy/paste, right-click | Browser events |

A problem has to last a few seconds before it counts, and can't repeat for 15 s. This avoids false alarms. Each event adds risk points (see `backend/app/risk.py`); the admin sees a **Low / Medium / High** score with a camera snapshot for every event. **The AI only flags. A human decides.**

## Run it (Windows, Mac, Linux)

You need **Python 3.10+** and **Node 20+**. Open two terminals (PowerShell or Command Prompt on Windows).

**1. Backend**

Windows (PowerShell):
```powershell
cd backend
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Mac / Linux:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

Open `backend/.env` and change `ADMIN_KEY` to your own password first.
The two AI model files (~11 MB) download automatically on first start.
(Linux only: if MediaPipe complains about libEGL, run `sudo apt install libegl1 libgles2`.)

**2. Frontend** (same on every system)
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 for students and http://localhost:3000/admin for the dashboard.
Webcams only work on `localhost` or HTTPS.

Windows tips: if PowerShell blocks `activate`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
If `pip install` fails on mediapipe, make sure you use 64-bit Python.

## Tests
```bash
cd backend && pytest
```

## Make it yours
- Questions: `backend/app/exams.py`
- Strictness (turn angle, hold time, points): top of `backend/app/risk.py`
- Next steps for real use: login for students, HTTPS, a real database, audio checks, and deleting snapshots after a retention period.

## Limits (be honest with students)
Cameras, lighting and glasses affect accuracy. Head-turn and phone thresholds were set by reasoning, not tuned on real exam footage, so try them with your own users before relying on them.
