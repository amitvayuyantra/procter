"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API, Exam } from "@/lib/api";
import { useProctoring } from "@/lib/useProctoring";

type Stage = "setup" | "exam" | "done";

// Friendly live hints shown under the camera
const HINTS: Record<string, string> = {
  no_face: "We can't see your face. Please sit in front of the camera.",
  multiple_faces: "More than one person is visible.",
  looking_away: "Please keep your eyes on the screen.",
  phone_detected: "A phone is visible. Please put it away.",
  book_detected: "A book is visible. Please remove it.",
  laptop_detected: "Another laptop is visible. Please remove it.",
};

export default function ExamPage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stage, setStage] = useState<Stage>("setup");
  const [exam, setExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const { status, connected, warning } = useProctoring(id, videoRef, stage === "exam");

  useEffect(() => {
    fetch(`${API}/api/exam`).then((r) => r.json()).then(setExam).catch(() => setError("Could not load the exam."));
  }, []);

  // Must be called from a button click so the browser allows camera + full screen
  async function begin() {
    setError("");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    } catch {
      return setError("Camera access is required. Please allow it and try again.");
    }
    await document.documentElement.requestFullscreen().catch(() => {});
    setSecondsLeft((exam?.duration_minutes ?? 15) * 60);
    setStage("exam");
  }

  // Attach the camera to the <video> once it exists on screen
  useEffect(() => {
    if (stage === "exam" && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [stage]);

  async function submit() {
    const res = await fetch(`${API}/api/sessions/${id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) return setError("Could not submit. Please try again.");
    setResult(await res.json());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (document.fullscreenElement) document.exitFullscreen();
    setStage("done");
  }

  // Countdown, auto-submit at zero
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (stage !== "exam") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(t); submitRef.current(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stage]);

  if (stage === "done" && result)
    return (
      <main className="mx-auto max-w-md p-6 pt-24 text-center">
        <h1 className="text-3xl font-bold">Exam submitted ✅</h1>
        <p className="mt-4 text-xl">Your score: {result.score} / {result.total}</p>
        <p className="mt-2 text-slate-500">You can close this page.</p>
      </main>
    );

  if (stage === "setup")
    return (
      <main className="mx-auto max-w-lg p-6 pt-16">
        <h1 className="text-2xl font-bold">{exam?.title ?? "Loading…"}</h1>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-slate-700">
          <li>Sit in a bright room, alone, facing the camera.</li>
          <li>The exam runs in full screen. Don&apos;t leave it or switch tabs.</li>
          <li>No phones, books or other devices. Copy and paste are disabled.</li>
          <li>You have {exam?.duration_minutes} minutes. It submits itself when time is up.</li>
        </ul>
        {error && <p className="mt-4 text-red-600">{error}</p>}
        <button onClick={begin} disabled={!exam} className="mt-6 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white disabled:opacity-40">
          Allow camera &amp; start exam
        </button>
      </main>
    );

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const liveHints = status.flags.map((f) => HINTS[f]).filter(Boolean);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[1fr_260px]">
      {warning && (
        <div className="fixed inset-x-0 top-0 z-10 bg-red-600 p-3 text-center font-semibold text-white">
          ⚠ Warning recorded: {warning}
        </div>
      )}

      <section className="space-y-5">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{exam?.title}</h1>
          <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-white">{mm}:{ss}</span>
        </header>

        {exam?.questions.map((q, i) => (
          <div key={q.id} className="rounded-xl bg-white p-5 shadow">
            <p className="font-medium">{i + 1}. {q.text}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name={`q${q.id}`} checked={answers[q.id] === oi}
                    onChange={() => setAnswers({ ...answers, [q.id]: oi })} />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        ))}
        {error && <p className="text-red-600">{error}</p>}
        <button onClick={submit} className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white">Submit exam</button>
      </section>

      <aside className="space-y-3 md:sticky md:top-6 md:self-start">
        <video ref={videoRef} autoPlay muted playsInline className="w-full -scale-x-100 rounded-xl bg-black" />
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          {connected ? (status.calibrated ? "Monitoring active" : "Calibrating… look at the screen") : "Reconnecting…"}
        </div>
        {liveHints.map((h) => (
          <p key={h} className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">{h}</p>
        ))}
      </aside>
    </main>
  );
}
