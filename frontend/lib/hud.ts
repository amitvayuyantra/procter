export type Identity = "scanning" | "verified" | "locked" | "review" | "off";
export type Challenge = "waiting" | "active" | "passed" | "failed";

/** What the server tells the browser about the latest camera picture (positions are 0-1000 across the picture). */
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

export type HudFrame = {
  seq: number;
  faces: number;
  hud: HudData | null;
  flags: string[];
  checks: { identity: Identity; feed: "live" | "review" };
  calibrated: boolean;
  challenge: Challenge;
  challengeFirst: "left" | "right";
  challengeProgress: number;
};

export const EMPTY_FRAME: HudFrame = {
  seq: 0, faces: 0, hud: null, flags: [], checks: { identity: "scanning", feed: "live" },
  calibrated: false, challenge: "waiting", challengeFirst: "left", challengeProgress: 0,
};

export type CheckState = "ok" | "warn" | "alert" | "pending";
export type CheckItem = { id: string; label: string; detail: string; state: CheckState };

/** The checklist shown under the camera. Words only: no scores. */
export function deriveChecks(f: HudFrame | null, screenOk: boolean): CheckItem[] {
  const h = f?.hud;
  const flags = f?.flags ?? [];
  const ready = !!f?.calibrated;
  const blocked = flags.includes("camera_blocked");
  const item = (id: string, label: string, state: CheckState, detail: string): CheckItem => ({ id, label, state, detail });

  const face = !f ? item("face", "Face", "pending", "starting")
    : f.faces === 1 ? item("face", "Face", "ok", "tracked")
    : f.faces > 1 ? item("face", "Face", "alert", `${f.faces} people`)
    : item("face", "Face", blocked ? "alert" : "warn", blocked ? "blocked" : "searching");

  const identity = f?.checks.identity ?? "scanning";
  return [
    face,
    item("pose", "Head", !ready ? "pending" : h?.head_away ? "warn" : "ok", !ready ? "calibrating" : h?.head_away ? "off-axis" : "centred"),
    item("gaze", "Gaze", !ready ? "pending" : h?.gaze_away ? "warn" : "ok", !ready ? "calibrating" : h?.gaze_away ? "sideways" : "on screen"),
    h?.boxes.length ? item("objects", "Objects", "alert", h.boxes[0].label) : item("objects", "Objects", "ok", "clear"),
    identity === "scanning" ? item("identity", "Identity", "pending", "scanning")
      : identity === "review" ? item("identity", "Identity", "warn", "in review")
      : identity === "off" ? item("identity", "Identity", "pending", "n/a")
      : item("identity", "Identity", "ok", identity),
    f?.challenge === "passed" ? item("live", "Liveness", "ok", "live person")
      : f?.challenge === "failed" ? item("live", "Liveness", "warn", "in review")
      : item("live", "Liveness", "pending", f?.challenge === "active" ? "challenge" : "waiting"),
    f?.checks.feed === "review" ? item("feed", "Feed", "warn", "verifying") : item("feed", "Feed", "ok", "live"),
    blocked ? item("light", "Camera", "alert", "blocked") : flags.includes("low_light") ? item("light", "Camera", "warn", "too dark") : item("light", "Camera", "ok", "clear"),
    item("screen", "Screen", screenOk ? "ok" : "warn", screenOk ? "locked in" : "left window"),
  ];
}
