"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API, Interview } from "@/lib/api";
import CameraHud from "@/components/CameraHud";
import { useProctoring } from "@/lib/useProctoring";

type Stage = "loading" | "welcome" | "interview" | "done" | "notfound";

// Friendly live hints shown under the camera
const HINTS: Record<string, string> = {
  no_face: "We can't see your face. Please sit in front of the camera.",
  multiple_faces: "More than one person is visible.",
  looking_away: "Please keep your eyes on the screen.",
  phone_detected: "A phone is visible. Please put it away.",
  book_detected: "A book is visible. Please remove it.",
  laptop_detected: "Another laptop is visible. Please remove it.",
  camera_blocked: "Your camera looks blocked or covered.",
  low_light: "Your room is quite dark. Please add some light in front of you.",
};

const draftKey = (id: string) => `interview-draft-${id}`;
const loadDraft = (id: string): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) ?? "{}"); } catch { return {}; }
};

export default function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stage, setStage] = useState<Stage>("loading");
  const [info, setInfo] = useState<Interview | null>(null);
  const [agree, setAgree] = useState(false);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState("");

  const { status, connected, warning, hudRef } = useProctoring(id, videoRef, stage === "interview");

  useEffect(() => {
    fetch(`${API}/api/interviews/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Interview) => {
        setInfo(d);
        setAnswers(loadDraft(id));
        setStage(d.status === "completed" ? "done" : "welcome");
      })
      .catch(() => setStage("notfound"));
  }, [id]);

  // Keep a draft in this browser so a page refresh never loses the candidate's typing
  useEffect(() => {
    if (stage === "interview") try { localStorage.setItem(draftKey(id), JSON.stringify(answers)); } catch {}
  }, [answers, stage, id]);

  // Must be called from a button click so the browser allows camera + full screen
  async function begin() {
    setError("");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    } catch {
      return setError("Camera access is required. Please allow it and try again.");
    }
    const res = await fetch(`${API}/api/interviews/${id}/start`, { method: "POST" });
    if (!res.ok) return setError("Could not start the interview. Please try again.");
    setSecondsLeft((await res.json()).seconds_left);
    await document.documentElement.requestFullscreen().catch(() => {});
    setStage("interview");
  }

  // Attach the camera to the <video> once it exists on screen
  useEffect(() => {
    if (stage === "interview" && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [stage]);

  async function submit() {
    const res = await fetch(`${API}/api/interviews/${id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) return setError("Could not submit. Please try again.");
    try { localStorage.removeItem(draftKey(id)); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (document.fullscreenElement) document.exitFullscreen();
    setStage("done");
  }

  // Countdown, auto-submit at zero
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (stage !== "interview") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(t); submitRef.current(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stage]);

  if (stage === "loading") return <main className="p-6 pt-24 text-center">Loading…</main>;
  if (stage === "notfound")
    return <main className="p-6 pt-24 text-center"><h1 className="text-2xl font-bold">Link not found</h1><p className="mt-2 text-slate-600">Please check the link in your invitation email.</p></main>;
  if (stage === "done")
    return (
      <main className="mx-auto max-w-md p-6 pt-24 text-center">
        <h1 className="text-3xl font-bold">Thank you ✅</h1>
        <p className="mt-4 text-slate-600">Your interview has been submitted. The hiring team will be in touch. You can close this page.</p>
      </main>
    );

  if (stage === "welcome") {
    const resuming = info?.status === "in_progress";
    return (
      <main className="mx-auto max-w-lg p-6 pt-16">
        <p className="text-slate-500">Hello {info?.candidate_name},</p>
        <h1 className="text-2xl font-bold">{info?.title}</h1>
        <p className="text-slate-600">Position: {info?.position}</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-slate-700">
          <li>Sit alone in a quiet, well-lit room, facing the camera.</li>
          <li>The interview runs in full screen. Please don&apos;t switch tabs or windows.</li>
          <li>Keep phones, books and other devices out of reach. Copy and paste are disabled.</li>
          <li>{resuming ? `You have about ${Math.ceil((info?.seconds_left ?? 0) / 60)} minutes left.` : `You have ${info?.duration_minutes} minutes. The timer starts when you press the button.`}</li>
        </ul>
        <label className="mt-5 flex gap-2 rounded-lg bg-white p-4 text-sm text-slate-600 shadow">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
          <span>
            I agree to be monitored through my webcam and browser during this interview. An AI checks for my face,
            other people, phones and tab switching, and may save camera snapshots. Results are only flags. A person
            reviews them, and no decision about me is made automatically.
          </span>
        </label>
        {error && <p className="mt-4 text-red-600">{error}</p>}
        <button onClick={begin} disabled={!agree}
          className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white disabled:opacity-40">
          {resuming ? "Resume interview" : "Allow camera & start interview"}
        </button>
      </main>
    );
  }

  const questions = info?.questions ?? [];
  const q = questions[current];
  const last = current === questions.length - 1;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const liveHints = status.flags.map((f) => HINTS[f]).filter(Boolean);
  const checking = status.challenge === "active";

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-6 md:grid-cols-[1fr_340px]">
      {warning && (
        <div className="fixed inset-x-0 top-0 z-10 bg-amber-500 p-3 text-center font-semibold text-white">
          ⚠ Noted: {warning}
        </div>
      )}

      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{info?.title}</h1>
          <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-white">{mm}:{ss}</span>
        </header>

        {q && (
          <div className="rounded-xl bg-white p-5 shadow">
            <p className="text-sm text-slate-500">Question {current + 1} of {questions.length}</p>
            <p className="mt-1 text-lg font-medium">{q.text}</p>
            <textarea rows={10} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              placeholder="Type your answer here…" className="mt-4 w-full rounded-lg border p-3" />
          </div>
        )}
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-between">
          <button onClick={() => setCurrent(current - 1)} disabled={current === 0} className="rounded-lg border px-4 py-2 disabled:opacity-30">Back</button>
          {last ? (
            <button onClick={submit} className="rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white">Submit interview</button>
          ) : (
            <button onClick={() => setCurrent(current + 1)} className="rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white">Next</button>
          )}
        </div>
      </section>

      <aside className="space-y-3 md:sticky md:top-6 md:self-start">
        {/* While the head-turn check runs, the camera moves to the middle of a dimmed screen so the arrows are easy to follow */}
        <div className={checking ? "fixed inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-slate-950/85 p-4 backdrop-blur-sm" : ""}>
          <div className={checking ? "w-[min(92vw,540px)]" : ""}>
            <CameraHud hudRef={hudRef} status={status} connected={connected}>
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
            </CameraHud>
          </div>
          {checking && (
            <p className="max-w-md text-center text-white">
              <b className="text-lg">Quick check.</b> Slowly turn your head to your <b>{status.challengeFirst}</b>, then to
              your <b>{status.challengeFirst === "left" ? "right" : "left"}</b>, then look back at the screen.
            </p>
          )}
        </div>
        {liveHints.map((h) => (
          <p key={h} className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">{h}</p>
        ))}
      </aside>
    </main>
  );
}
