"use client";
import { useEffect, useRef, useState } from "react";
import LiveConsole from "@/components/LiveConsole";
import demoFace from "@/lib/demoFace.json";
import { Feed, LiveEvent, newFeed, WatchFrame } from "@/lib/hud";
import { announce, pushFrame } from "@/lib/useLiveFeed";

// A preview of the interviewer's live monitor with made-up data, so every animation can be seen without a real interview.
const SCENES = {
  tracking: "Normal: face tracked, identity verified",
  scanning: "Start-up: scanning the face",
  challenge: "Head-turn liveness check",
  away: "Looking away from the screen",
  phone: "Phone detected",
  person: "Second person in the room",
  lost: "Face not visible",
  blocked: "Camera covered",
  dark: "Dark room",
  review: "Face does not match reference",
  frozen: "Frozen / still picture feed",
} as const;
type Scene = keyof typeof SCENES;
const ALERT: Partial<Record<Scene, [string, number]>> = {
  away: ["looking_away", 3], phone: ["phone_detected", 20], person: ["multiple_faces", 15], lost: ["no_face", 5],
  blocked: ["camera_blocked", 10], review: ["identity_mismatch", 25], frozen: ["static_feed", 25],
};

function frameFor(scene: Scene, tick: number, risk: number): WatchFrame {
  const step = Math.floor(tick / 6) % 3; // the head-turn demo moves to its next step every 2 seconds
  const hud = { mesh: demoFace.mesh as [number, number][], others: [], boxes: [], pose: [0.12, 0.05] as [number, number], head_away: false, gaze_away: false, blink: tick % 9 === 0, light: 78 };
  const base: WatchFrame = {
    faces: 1, hud, angles: [0.02, 0.01], flags: [], checks: { identity: "verified", feed: "live" }, calibrated: true,
    challenge: "passed", challenge_first: "left", challenge_progress: 2, risk, level: risk >= 50 ? "high" : risk >= 25 ? "medium" : "low",
    identity_score: 0.94, similarity: 0.93, events: [],
  };
  switch (scene) {
    case "scanning": return { ...base, calibrated: false, challenge: "waiting", checks: { identity: "scanning", feed: "live" }, identity_score: null, similarity: null, angles: null, hud: { ...hud, pose: null } };
    case "challenge": return { ...base, challenge: "active", challenge_progress: step === 2 ? 1 : step, angles: [step === 1 ? 0.2 : step === 2 ? -0.2 : 0, 0.02], hud: { ...hud, pose: [step === 1 ? 1.6 : step === 2 ? -1.6 : 0, 0.1] } };
    case "away": return { ...base, angles: [0.34, 0.1], hud: { ...hud, pose: [1.9, 0.5], head_away: true, gaze_away: true } };
    case "phone": return { ...base, hud: { ...hud, boxes: [{ label: "phone", box: [640, 520, 190, 330] }] } };
    case "person": return { ...base, faces: 2, hud: { ...hud, others: [[30, 250, 200, 280]] } };
    case "lost": return { ...base, faces: 0, angles: null, hud: { ...hud, mesh: null, pose: null } };
    case "blocked": return { ...base, faces: 0, flags: ["camera_blocked"], angles: null, hud: { ...hud, mesh: null, pose: null, light: 2 } };
    case "dark": return { ...base, flags: ["low_light"], hud: { ...hud, light: 18 } };
    case "review": return { ...base, checks: { identity: "review", feed: "live" }, identity_score: 0.04, similarity: 0.05 };
    case "frozen": return { ...base, checks: { identity: "verified", feed: "review" }, hud: { ...hud, blink: false } };
    default: return base;
  }
}

export default function Demo() {
  const feed = useRef<Feed>(newFeed());
  const source = useRef<ImageBitmap | null>(null);
  const risk = useRef(0);
  const nextId = useRef(1);
  const [scene, setScene] = useState<Scene>("tracking");
  const [latest, setLatest] = useState<WatchFrame | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const [startedAt] = useState(() => Date.now() / 1000 - 754);

  useEffect(() => {
    fetch("/demo-face.jpg").then((r) => r.blob()).then(createImageBitmap).then((b) => (source.current = b));
  }, []);

  // like the real server: about three pictures a second
  useEffect(() => {
    let tick = 0;
    feed.current.online = true;
    const alert = ALERT[scene];
    if (alert) {
      risk.current = Math.min(100, risk.current + alert[1]);
      const ev: LiveEvent = { id: nextId.current++, type: alert[0], points: alert[1], detail: "", evidence: null, created_at: Date.now() / 1000 };
      setEvents((e) => [ev, ...e]);
      announce(feed.current, [ev], performance.now() / 1000);
    }
    const push = async () => {
      if (!source.current) return;
      const data = frameFor(scene, tick++, risk.current);
      const bitmap = await createImageBitmap(source.current);
      pushFrame(feed.current, bitmap, data, performance.now() / 1000);
      setLatest(data);
      setHistory((h) => [...h, risk.current].slice(-90));
    };
    push();
    const t = setInterval(push, 330);
    return () => clearInterval(t);
  }, [scene]);

  const level = risk.current >= 50 ? "high" : risk.current >= 25 ? "medium" : "low";
  return (
    <LiveConsole
      demo name="Ada Lovelace" position="Backend Engineer" startedAt={startedAt} backHref="/"
      feed={feed} latest={latest} conn="open" online ended={false}
      risk={{ value: latest?.risk ?? 0, level: latest?.level ?? level, history }} events={events}
      referenceUrl="/demo-face.jpg" startPhotoUrl="/demo-face.jpg" evidenceUrl={() => null}
      extra={
        <div className="glass rounded-2xl p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-slate-400">Try a situation</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(Object.keys(SCENES) as Scene[]).map((k) => (
              <button key={k} onClick={() => setScene(k)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${scene === k ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:border-white/30"}`}>
                {SCENES[k]}
              </button>
            ))}
          </div>
          <button onClick={() => { risk.current = 0; setEvents([]); setHistory([]); }} className="mt-3 font-mono text-[11px] text-slate-400 underline">Reset score</button>
          <p className="mt-3 text-[11px] text-slate-500">Demo photo: NASA, public domain. In a real interview this view is only shown to the interviewer.</p>
        </div>
      }
    />
  );
}
