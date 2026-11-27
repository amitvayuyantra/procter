# AI Interview Proctor

Keeps remote **corporate interviews** honest using AI, and gives recruiters evidence to review.

- **Backend**: Python (FastAPI + MediaPipe + OpenCV)
- **Frontend**: Next.js (React, TypeScript, Tailwind)

## How it works

1. **Recruiter** opens `/admin`, signs in with the admin key, and creates an interview (candidate, role, question set, and optionally a **reference photo**). This gives a private link to email to the candidate.
2. **Candidate** opens the link, agrees to monitoring, allows the camera, and answers the questions in full screen. The timer starts when they press start.
3. **AI watches** while they answer. It saves a start-of-interview photo, checks it against the reference photo, runs a short head-turn liveness check, and keeps flagging problems. The recruiter can watch all of this live (see below).
4. **Recruiter** opens the interview: ID photo, written answers, a timeline of flags with camera snapshots, and a verdict box (*Cleared / Needs follow-up / Concern confirmed*).

## What it flags

| Check | How |
|---|---|
| Face missing / someone else in the room | MediaPipe face landmarks + person detector |
| Looking away (reading from another screen) | Nose position & eye direction, compared with the candidate's *own* normal pose |
| Phone, book, extra laptop | EfficientDet object detector |
| **Wrong person**: face doesn't match the reference photo | SFace face-recognition model (`backend/app/faceid.py`) compares "face fingerprints" |
| **Person swap**: someone else takes over mid-interview | The candidate's face is re-checked about every 2 seconds against their own start-of-interview fingerprint |
| **Photo / pre-recorded video instead of a live person** | Random head-turn challenge at the start ("turn to your left, then right"), plus a check for a feed with no blinking and no movement for 30 s |
| **Camera covered or blocked**, dark room | Brightness analysis (a dark room only gets a hint to the candidate) |
| Tab switch, leaving full screen, copy/paste, right-click | Browser events |

## The interviewer's live AI monitor

While a candidate is interviewing, the recruiter can click **Watch live** (on the dashboard or the interview's page) to open a mission-control view. **Only the interviewer sees it. The candidate sees just their own plain camera.** Preview it without a webcam at `/demo`.

On the live camera picture:

- a glowing gradient **face mesh** with a ripple of light, data particles flowing around the outline, and a rotating tracking ring
- **callouts** with live readouts: head yaw and pitch in degrees, gaze, and the face-match score
- **gaze arrows** from each eye, and the eyes flash when the candidate **blinks**
- a **head-pose dial**, a pulse line that goes flat if the feed looks frozen, a light meter and a blink counter
- animated **boxes around phones, books, laptops and extra people**, and sliding **alert toasts** the moment something happens
- the **liveness challenge** progress, an **identity scan** that resolves to "Identity verified" or "Identity mismatch", and a **camera blocked** alert

Around it: an animated **integrity-score gauge** with a history graph, an **identity panel** (reference photo, start-of-interview photo and match ring), the nine-item **checklist**, and a **live event feed** with snapshots.

How it works: the server relays each camera picture, together with what the AI found in it, to the interviewer's browser. Because the picture and the face points come from the same capture, the overlay always lines up exactly, and the screen blends smoothly between pictures (about 3 per second). Access needs the admin key.

**What the candidate's browser receives:** only friendly hints ("please keep your face visible"), the head-turn instruction, and a warning banner for obvious things like switching tabs. No face data, no checks, no scores. Identity and liveness problems are never announced to the candidate.

Interview-friendly settings: candidates may glance away for about 6 seconds (thinking, notes) before it counts; a problem can't repeat for 15 s; and the start photo is **not** counted as a concern. **The AI only flags. A person decides, and nobody is rejected automatically.**

## The admin key

It is the recruiter password. It lives only in the **backend**: set `ADMIN_KEY` in `backend/.env` (default `admin123`; change it), restart the backend, then type it on the `/admin` login page. The frontend needs no setting for it.

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
The AI model files (~50 MB in total) download automatically on first start. The face-matching model is optional: if its download fails, everything else still works and face matching is switched off.
(Linux only: if MediaPipe complains about libEGL, run `sudo apt install libegl1 libgles2`.)

**2. Frontend** (same on every system)
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000/admin for the recruiter dashboard. Candidates use the link it creates.
In production, set `NEXT_PUBLIC_API_URL` (frontend) and `CORS_ORIGINS` (backend) to your real addresses.
Webcams only work on `localhost` or HTTPS.

Windows tips: if PowerShell blocks `activate`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
If `pip install` fails on mediapipe, make sure you use 64-bit Python.

## Tests
```bash
cd backend && pytest
```

## Make it yours
- Interview roles and questions: `backend/app/interviews.py`
- Strictness (turn angle, hold time, points): top of `backend/app/risk.py`

## Before using it on real candidates
- **Get legal advice.** Camera monitoring of job applicants is regulated (for example GDPR in the EU, biometric rules in some US states). Tell candidates what you collect and for how long, offer an alternative to people who can't or won't be monitored, and delete snapshots after a set period.
- Add real recruiter logins (one shared key is for demos), HTTPS, and a production database.
- **Not covered yet:** matching against an ID *document* (the recruiter supplies a reference photo instead), audio (someone whispering help), screen sharing, deepfake or virtual-camera detection (the head-turn check helps, but a live deepfake could still pass), and live video calls with an interviewer.
- We deliberately do **not** include "emotion" or "lie detection". It is not scientifically reliable and risks unfair treatment of candidates.

## Limits
Cameras, lighting and glasses affect accuracy. Face matching was verified on photos (same person re-saved with changed lighting, blur and rotation scores 0.86 to 0.97; different people score about 0), not on thousands of real webcam sessions. Candidates with heavy glasses, strong lighting changes, or a big change in appearance since the reference photo may score lower, so a low score is a prompt for a human to look, not proof. The head-turn, still-picture and phone thresholds were set by reasoning, not tuned on real interview footage. Try them with your own people first.
