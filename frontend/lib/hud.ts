import type { Level } from "./api";

export type Identity = "scanning" | "verified" | "locked" | "review" | "off";
export type Challenge = "waiting" | "active" | "passed" | "failed";

/** What the server knows about one camera picture (positions are 0-1000 across the picture). */
export type HudData = {
  mesh: [number, number][] | null;
  others: number[][]; // [x, y, w, h] of extra faces
  boxes: { label: string; box: number[] }[]; // watched objects
  pose: [number, number] | null; // head turn / tilt, where 1.0 = edge of the allowed range
  head_away: boolean;
  gaze_away: boolean;
  blink: boolean;
  light: number; // 0-100
};

export type LiveEvent = { id: number; type: string; points: number; detail: string; evidence: string | null; created_at: number };

/** One live message for the interviewer: a picture plus everything the AI worked out about it. */
export type WatchFrame = {
  faces: number;
  hud: HudData | null;
  angles: [number, number] | null; // head turn / tilt away from the candidate's normal, as picture ratios
  flags: string[];
  checks: { identity: Identity; feed: "live" | "review" };
  calibrated: boolean;
  challenge: Challenge;
  challenge_first: "left" | "right";
  challenge_progress: number;
  risk: number;
  level: Level;
  identity_score: number | null;
  similarity: number | null;
  events: LiveEvent[];
};

export type LiveFrame = { bitmap: ImageBitmap; data: WatchFrame; at: number }; // `at`: when it arrived (seconds)
export type Toast = { text: string; points: number; at: number };
/** What the live monitor draws from. Mutated outside React so the canvas can read it 60 times a second. */
export type Feed = {
  prev: LiveFrame | null;
  curr: LiveFrame | null;
  interval: number; // seconds between pictures
  online: boolean; // is the candidate's camera connected
  ended: boolean;
  toasts: Toast[];
};
export const newFeed = (): Feed => ({ prev: null, curr: null, interval: 0.33, online: false, ended: false, toasts: [] });

export type CheckState = "ok" | "warn" | "alert" | "pending";
export type CheckItem = { id: string; label: string; detail: string; state: CheckState };

/** The nine-item checklist next to the live view. */
export function deriveChecks(f: WatchFrame | null, screenOk: boolean): CheckItem[] {
  const h = f?.hud;
  const flags = f?.flags ?? [];
  const ready = !!f?.calibrated;
  const blocked = flags.includes("camera_blocked");
  const item = (id: string, label: string, state: CheckState, detail: string): CheckItem => ({ id, label, state, detail });

  const face = !f ? item("face", "Face", "pending", "waiting")
    : f.faces === 1 ? item("face", "Face", "ok", "tracked")
    : f.faces > 1 ? item("face", "Face", "alert", `${f.faces} people`)
    : item("face", "Face", blocked ? "alert" : "warn", blocked ? "blocked" : "not visible");

  const identity = f?.checks.identity ?? "scanning";
  return [
    face,
    item("pose", "Head", !ready ? "pending" : h?.head_away ? "warn" : "ok", !ready ? "calibrating" : h?.head_away ? "off-axis" : "centred"),
    item("gaze", "Gaze", !ready ? "pending" : h?.gaze_away ? "warn" : "ok", !ready ? "calibrating" : h?.gaze_away ? "sideways" : "on screen"),
    h?.boxes.length ? item("objects", "Objects", "alert", h.boxes[0].label) : item("objects", "Objects", "ok", "clear"),
    identity === "scanning" ? item("identity", "Identity", "pending", "scanning")
      : identity === "review" ? item("identity", "Identity", "alert", "mismatch")
      : identity === "off" ? item("identity", "Identity", "pending", "n/a")
      : item("identity", "Identity", "ok", identity),
    f?.challenge === "passed" ? item("live", "Liveness", "ok", "live person")
      : f?.challenge === "failed" ? item("live", "Liveness", "alert", "not completed")
      : item("live", "Liveness", "pending", f?.challenge === "active" ? "challenge" : "waiting"),
    f?.checks.feed === "review" ? item("feed", "Feed", "alert", "looks frozen") : item("feed", "Feed", "ok", "live"),
    blocked ? item("light", "Camera", "alert", "blocked") : flags.includes("low_light") ? item("light", "Camera", "warn", "too dark") : item("light", "Camera", "ok", "clear"),
    item("screen", "Screen", screenOk ? "ok" : "warn", screenOk ? "in focus" : "left window"),
  ];
}
