"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CameraHud from "@/components/CameraHud";
import demoFace from "@/lib/demoFace.json";
import { EMPTY_FRAME, HudFrame } from "@/lib/hud";

// A preview of the camera view with made-up data, so you can see every animation without running an interview.
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
  review: "Identity under review",
  frozen: "Frozen / still picture feed",
} as const;
type Scene = keyof typeof SCENES;

function frameFor(scene: Scene, tick: number): HudFrame {
  const step = Math.floor(tick / 6) % 3; // the head-turn demo moves to its next step every 3 seconds
  const base: HudFrame = {
    ...EMPTY_FRAME, faces: 1, calibrated: true, challenge: "passed", checks: { identity: "verified", feed: "live" },
    hud: { mesh: demoFace.mesh as [number, number][], others: [], boxes: [], pose: [0.1, 0.05], head_away: false, gaze_away: false, blink: tick % 7 === 0, light: 78 },
  };
  const hud = base.hud!;
  switch (scene) {
    case "scanning": return { ...base, calibrated: false, challenge: "waiting", checks: { identity: "scanning", feed: "live" } };
    case "challenge": {
      const side = step === 1 ? -1.6 : 1.6;
      return { ...base, challenge: "active", challengeFirst: "left", challengeProgress: Math.min(step, 2), hud: { ...hud, pose: [step === 2 ? 0 : side, 0.1] } };
    }
    case "away": return { ...base, hud: { ...hud, pose: [1.7, 0.3], head_away: true, gaze_away: true } };
    case "phone": return { ...base, hud: { ...hud, boxes: [{ label: "phone", box: [640, 520, 190, 330] }] } };
    case "person": return { ...base, faces: 2, hud: { ...hud, others: [[30, 250, 200, 280]] } };
    case "lost": return { ...base, faces: 0, hud: { ...hud, mesh: null, pose: null } };
    case "blocked": return { ...base, faces: 0, flags: ["camera_blocked"], hud: { ...hud, mesh: null, pose: null, light: 2 } };
    case "dark": return { ...base, flags: ["low_light"], hud: { ...hud, light: 18 } };
    case "review": return { ...base, checks: { identity: "review", feed: "live" } };
    case "frozen": return { ...base, checks: { identity: "verified", feed: "review" }, hud: { ...hud, blink: false } };
    default: return base;
  }
}

export default function Demo() {
  const [scene, setScene] = useState<Scene>("tracking");
  const [status, setStatus] = useState<HudFrame>(EMPTY_FRAME);
  const hudRef = useRef<HudFrame | null>(null);
  const seq = useRef(0);

  // like the real server: two updates per second
  useEffect(() => {
    let tick = 0;
    const push = () => {
      const f = { ...frameFor(scene, tick++), seq: ++seq.current };
      hudRef.current = f;
      setStatus(f);
    };
    push();
    const t = setInterval(push, 500);
    return () => clearInterval(t);
  }, [scene]);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[minmax(0,420px)_1fr]">
        <CameraHud hudRef={hudRef} status={status} connected screenOk>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo-face.jpg" alt="Demo face" className="h-full w-full -scale-x-100 object-cover" />
        </CameraHud>
        <div>
          <Link href="/" className="text-sm text-cyan-300 underline">← Home</Link>
          <h1 className="mt-2 text-2xl font-bold">What the AI shows on the camera</h1>
          <p className="mt-1 text-slate-400">A preview with made-up data. Pick a situation to see how the camera view reacts.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {(Object.keys(SCENES) as Scene[]).map((k) => (
              <button key={k} onClick={() => setScene(k)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${scene === k ? "border-cyan-400 bg-cyan-400/10 text-cyan-100" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                {SCENES[k]}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">Demo photo: NASA, public domain.</p>
        </div>
      </div>
    </main>
  );
}
