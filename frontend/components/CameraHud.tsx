"use client";
import { MutableRefObject, ReactNode, useEffect, useRef, useState } from "react";
import { BROWA, BROWB, EYEA, EYEB, IRIS_A, IRIS_B, LIPS, NOSE, OVAL, POINT_COUNT, TRIANGLES } from "@/lib/faceMesh";
import { CheckState, deriveChecks, HudFrame } from "@/lib/hud";

/**
 * The live "AI vision" view drawn over the candidate's camera.
 * The server sends where things are (face points, objects) and what state each check is in;
 * this file only draws it, smoothly, at 60 frames per second.
 */

type RGB = readonly [number, number, number];
const CYAN: RGB = [34, 211, 238];
const GREEN: RGB = [74, 222, 128];
const AMBER: RGB = [251, 191, 36];
const RED: RGB = [248, 113, 113];
const WHITE: RGB = [241, 245, 249];
const BEAM: RGB = [186, 230, 253];
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, Math.max(0, a))})`;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const MONO = "600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

type Tracked = { label: string; x: number; y: number; w: number; h: number; tx: number; ty: number; tw: number; th: number; seen: number };

type Anim = {
  seq: number;
  frame: HudFrame | null;
  mesh: Float32Array | null; // smoothed face points, 0..1
  target: Float32Array | null;
  alpha: number; // how visible the face overlay is
  pose: [number, number];
  poseTarget: [number, number];
  objects: Map<string, Tracked>;
  others: Map<string, Tracked>;
  blinks: number;
  prevBlink: boolean;
  blinkFlash: number;
  prevIdentity: string;
  prevChallenge: string;
  burst: number; // time a "verified" ripple started (-1 = none)
  burstColor: RGB;
  ecg: number[];
  ecgAt: number;
  start: number;
};

export default function CameraHud(props: {
  hudRef: MutableRefObject<HudFrame | null>;
  status: HudFrame;
  connected: boolean;
  screenOk?: boolean; // normally measured in the browser; the demo page forces it
  children: ReactNode; // the <video> element
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ connected: props.connected });
  live.current.connected = props.connected;
  const [measuredScreenOk, setScreenOk] = useState(true);
  const screenOk = props.screenOk ?? measuredScreenOk;

  // The "screen" check is done in the browser: still looking at the interview window, in full screen?
  useEffect(() => {
    const update = () => setScreenOk(!document.hidden && document.hasFocus() && !!document.fullscreenElement);
    update();
    const events: [EventTarget, string][] = [[document, "visibilitychange"], [document, "fullscreenchange"], [window, "focus"], [window, "blur"]];
    events.forEach(([t, e]) => t.addEventListener(e, update));
    return () => events.forEach(([t, e]) => t.removeEventListener(e, update));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const a: Anim = {
      seq: -1, frame: null, mesh: null, target: null, alpha: 0, pose: [0, 0], poseTarget: [0, 0],
      objects: new Map(), others: new Map(), blinks: 0, prevBlink: false, blinkFlash: 0,
      prevIdentity: "scanning", prevChallenge: "waiting", burst: -1, burstColor: GREEN,
      ecg: Array(64).fill(0), ecgAt: 0, start: performance.now() / 1000,
    };

    // The camera picture is mirrored (like a bathroom mirror), so we mirror the drawing too.
    const X = (n: number) => (1 - n) * W;
    const Y = (n: number) => n * H;

    const track = (map: Map<string, Tracked>, key: string, label: string, b: number[], t: number) => {
      const [x, y, w, h] = b.map((v) => v / 1000);
      const cur = map.get(key);
      if (cur) Object.assign(cur, { tx: x, ty: y, tw: w, th: h, seen: t });
      else map.set(key, { label, x, y, w, h, tx: x, ty: y, tw: w, th: h, seen: t });
    };

    // A new set of results has arrived from the server
    const ingest = (f: HudFrame, t: number) => {
      a.seq = f.seq; a.frame = f;
      const h = f.hud;
      if (h?.mesh && h.mesh.length === POINT_COUNT) {
        a.target = new Float32Array(POINT_COUNT * 2);
        h.mesh.forEach(([x, y], i) => { a.target![i * 2] = x / 1000; a.target![i * 2 + 1] = y / 1000; });
        if (!a.mesh) a.mesh = Float32Array.from(a.target);
      } else a.target = null;
      a.poseTarget = h?.pose ?? [0, 0];
      h?.boxes.forEach((o, i) => track(a.objects, `${o.label}${i}`, o.label.toUpperCase(), o.box, t));
      h?.others.forEach((o, i) => track(a.others, `p${i}`, "EXTRA PERSON", o, t));
      if (h?.blink && !a.prevBlink) { a.blinks++; a.blinkFlash = 1; }
      a.prevBlink = !!h?.blink;

      const id = f.checks.identity;
      if (id !== a.prevIdentity) {
        if ((id === "verified" || id === "locked") && a.prevIdentity === "scanning") { a.burst = t; a.burstColor = GREEN; }
        a.prevIdentity = id;
      }
      if (f.challenge !== a.prevChallenge) {
        if (f.challenge === "passed") { a.burst = t; a.burstColor = GREEN; }
        a.prevChallenge = f.challenge;
      }
    };

    // ---- small drawing helpers -------------------------------------------------------------
    const glow = (c: RGB, blur: number) => { ctx.shadowColor = rgba(c, 0.9); ctx.shadowBlur = blur; };
    const noGlow = () => { ctx.shadowBlur = 0; };
    const poly = (idx: number[], closed: boolean) => {
      const m = a.mesh!;
      ctx.beginPath();
      idx.forEach((p, i) => (i ? ctx.lineTo(X(m[p * 2]), Y(m[p * 2 + 1])) : ctx.moveTo(X(m[p * 2]), Y(m[p * 2 + 1]))));
      if (closed) ctx.closePath();
    };
    const brackets = (x0: number, y0: number, x1: number, y1: number, len: number) => {
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        ctx.moveTo(x, y + dy * len); ctx.lineTo(x, y); ctx.lineTo(x + dx * len, y);
      }
      ctx.stroke();
    };
    const chip = (text: string, x: number, y: number, c: RGB, align: "left" | "center" | "right" = "left", alpha = 1) => {
      ctx.font = MONO;
      const w = ctx.measureText(text).width + 14;
      const x0 = clamp(align === "center" ? x - w / 2 : align === "right" ? x - w : x, 4, Math.max(4, W - w - 4));
      ctx.fillStyle = `rgba(2,6,23,${0.72 * alpha})`;
      ctx.strokeStyle = rgba(c, 0.7 * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y - 9, w, 18, 9); else ctx.rect(x0, y - 9, w, 18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(c, alpha);
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillText(text, x0 + 7, y + 0.5);
    };

    // ---- one animation frame ---------------------------------------------------------------
    let last = performance.now();
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const f = props.hudRef.current;
      if (f && f.seq !== a.seq) ingest(f, t);
      const frame = a.frame;
      const k = 1 - Math.exp(-dt / 0.1); // smoothing: glides between the 2-per-second updates

      ctx.clearRect(0, 0, W, H);
      if (!W || !H) return;
      const flags = frame?.flags ?? [];
      const blocked = flags.includes("camera_blocked");
      const challenge = frame?.challenge ?? "waiting";
      const identity = frame?.checks.identity ?? "scanning";
      const feedBad = frame?.checks.feed === "review";

      // glide everything toward where the server says it is
      if (a.mesh && a.target) for (let i = 0; i < a.mesh.length; i++) a.mesh[i] += (a.target[i] - a.mesh[i]) * k;
      a.alpha += ((a.target ? 1 : 0) - a.alpha) * (1 - Math.exp(-dt / (a.target ? 0.15 : 0.3)));
      a.pose[0] += (a.poseTarget[0] - a.pose[0]) * k;
      a.pose[1] += (a.poseTarget[1] - a.pose[1]) * k;
      a.blinkFlash = Math.max(0, a.blinkFlash - dt * 4);
      for (const map of [a.objects, a.others])
        for (const [key, o] of map) {
          o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.w += (o.tw - o.w) * k; o.h += (o.th - o.h) * k;
          if (t - o.seen > 0.9) map.delete(key);
        }

      const boot = clamp((t - a.start) / 1.1);
      const issue = (frame?.faces ?? 0) > 1 || a.objects.size > 0;
      const accent: RGB = blocked ? RED : issue ? RED : CYAN;

      // 1. screen corner frame (draws itself in at start-up)
      ctx.strokeStyle = rgba(accent, 0.75); ctx.lineWidth = 1.5;
      const inset = 10, len = 26 * boot;
      brackets(inset, inset, W - inset, H - inset, len);

      // 2. top-left tag
      const online = live.current.connected;
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      ctx.fillStyle = rgba(online ? GREEN : AMBER, online ? pulse : 1);
      ctx.beginPath(); ctx.arc(24, 27, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = MONO; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(WHITE, 0.85 * boot);
      const boottext = "AI PROCTOR ONLINE";
      ctx.fillText(online ? (t - a.start < 3 ? boottext.slice(0, Math.floor(boottext.length * boot)) : "AI PROCTOR · LIVE") : "RECONNECTING…", 34, 27.5);

      // 3. face
      const m = a.mesh;
      let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
      if (m && a.alpha > 0.02) {
        const al = a.alpha;
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (let i = 0; i < POINT_COUNT; i++) {
          minX = Math.min(minX, m[i * 2]); maxX = Math.max(maxX, m[i * 2]);
          minY = Math.min(minY, m[i * 2 + 1]); maxY = Math.max(maxY, m[i * 2 + 1]);
        }
        const fw = maxX - minX, fh = maxY - minY;
        // a band of light sweeps down the face while scanning, and every few seconds afterwards
        const scanning = identity === "scanning" || challenge === "active";
        const cycle = scanning ? (t * 0.7) % 1 : ((t / 7) % 1) * 1.9;
        const sweep = calm ? -1 : minY + fh * cycle;
        const band = fh * 0.09;
        const meshColor: RGB = identity === "review" ? AMBER : issue ? CYAN : CYAN;

        // mesh lines
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = rgba(meshColor, 0.2 * al);
        ctx.beginPath();
        const lit: number[] = [];
        for (let i = 0; i < TRIANGLES.length; i += 3) {
          const p = [TRIANGLES[i], TRIANGLES[i + 1], TRIANGLES[i + 2]];
          const cy = (m[p[0] * 2 + 1] + m[p[1] * 2 + 1] + m[p[2] * 2 + 1]) / 3;
          if (Math.abs(cy - sweep) < band) { lit.push(i); continue; }
          ctx.moveTo(X(m[p[0] * 2]), Y(m[p[0] * 2 + 1]));
          ctx.lineTo(X(m[p[1] * 2]), Y(m[p[1] * 2 + 1]));
          ctx.lineTo(X(m[p[2] * 2]), Y(m[p[2] * 2 + 1]));
          ctx.closePath();
        }
        ctx.stroke();
        if (lit.length) {
          ctx.strokeStyle = rgba(BEAM, 0.55 * al); ctx.lineWidth = 0.9;
          ctx.beginPath();
          for (const i of lit) {
            const p = [TRIANGLES[i], TRIANGLES[i + 1], TRIANGLES[i + 2]];
            ctx.moveTo(X(m[p[0] * 2]), Y(m[p[0] * 2 + 1]));
            ctx.lineTo(X(m[p[1] * 2]), Y(m[p[1] * 2 + 1]));
            ctx.lineTo(X(m[p[2] * 2]), Y(m[p[2] * 2 + 1]));
            ctx.closePath();
          }
          ctx.stroke();
        }

        // points
        for (let i = 0; i < POINT_COUNT; i++) {
          const near = Math.abs(m[i * 2 + 1] - sweep) < band;
          const tw = calm ? 0.6 : 0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.7);
          ctx.fillStyle = near ? rgba(BEAM, 0.9 * al) : rgba(meshColor, (0.35 + 0.4 * tw) * al);
          ctx.beginPath(); ctx.arc(X(m[i * 2]), Y(m[i * 2 + 1]), near ? 1.7 : 1.2, 0, Math.PI * 2); ctx.fill();
        }

        // glowing outlines of the face, eyes, brows, lips and nose
        glow(meshColor, 10);
        ctx.strokeStyle = rgba(meshColor, 0.95 * al); ctx.lineWidth = 1.6;
        poly(OVAL, true); ctx.stroke();
        ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(meshColor, 0.85 * al);
        poly(BROWA, false); ctx.stroke(); poly(BROWB, false); ctx.stroke();
        poly(NOSE, false); ctx.stroke();
        poly(LIPS, true); ctx.stroke();
        const eyeColor: RGB = a.blinkFlash > 0.05 ? WHITE : meshColor; // eyes flash white when you blink
        ctx.strokeStyle = rgba(eyeColor, (0.9 + 0.1 * a.blinkFlash) * al); ctx.lineWidth = 1.2 + a.blinkFlash * 1.5;
        poly(EYEA, true); ctx.stroke(); poly(EYEB, true); ctx.stroke();
        noGlow();

        // eyes: iris ring and a gaze arrow showing where the eyes are pointing
        const away = !!frame?.hud?.gaze_away;
        const gz: RGB = away ? AMBER : GREEN;
        for (const [eye, iris] of [[EYEA, IRIS_A], [EYEB, IRIS_B]] as const) {
          let cx = 0, cy = 0, lo = 1, hi = 0;
          eye.forEach((p) => { cx += m[p * 2]; cy += m[p * 2 + 1]; lo = Math.min(lo, m[p * 2]); hi = Math.max(hi, m[p * 2]); });
          cx /= eye.length; cy /= eye.length;
          const ix = m[iris * 2], iy = m[iris * 2 + 1];
          const ew = (hi - lo) * W;
          const vx = (X(ix) - X(cx)), vy = (Y(iy) - Y(cy));
          const px = X(ix), py = Y(iy);
          glow(gz, 8);
          ctx.strokeStyle = rgba(gz, 0.95 * al); ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(px, py, Math.max(3, ew * 0.16), 0, Math.PI * 2); ctx.stroke();
          const ex = px + vx * 4.2, ey = py + vy * 4.2; // exaggerated so small eye movements are easy to see
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.fillStyle = rgba(gz, al); ctx.beginPath(); ctx.arc(ex, ey, 2, 0, Math.PI * 2); ctx.fill();
          noGlow();
        }

        // tracking reticle around the face, breathing slowly
        const pad = 0.1 + (calm ? 0 : 0.012 * Math.sin(t * 2.4));
        bx0 = X(maxX + fw * pad); bx1 = X(minX - fw * pad);
        by0 = Y(minY - fh * pad * 1.6); by1 = Y(maxY + fh * pad);
        glow(accent, 8);
        ctx.strokeStyle = rgba(accent, 0.95 * al); ctx.lineWidth = 2;
        brackets(bx0, by0, bx1, by1, Math.min(bx1 - bx0, by1 - by0) * 0.2);
        noGlow();

        // spinning ring while scanning the identity
        if (identity === "scanning" || challenge === "active") {
          const cxm = (bx0 + bx1) / 2, cym = (by0 + by1) / 2, r = Math.max(bx1 - bx0, by1 - by0) * 0.62;
          ctx.strokeStyle = rgba(CYAN, 0.8 * al); ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const s = t * 1.6 + (i * Math.PI * 2) / 3;
            ctx.beginPath(); ctx.arc(cxm, cym, r, s, s + 0.9); ctx.stroke();
          }
        }

        // status tag above the face
        const tag = identity === "scanning" ? "SCANNING FACE" : identity === "verified" ? "✓ IDENTITY VERIFIED"
          : identity === "locked" ? "✓ FACE LOCKED" : identity === "review" ? "IDENTITY · UNDER REVIEW" : "TRACKING";
        chip(tag, (bx0 + bx1) / 2, Math.max(22, by0 - 14), identity === "review" ? AMBER : identity === "scanning" ? CYAN : GREEN, "center", al);
      } else if (!blocked && boot > 0.5) {
        // no face: radar rings spread from the centre
        for (let i = 0; i < 3; i++) {
          const ph = calm ? 0.5 : (t * 0.45 + i / 3) % 1;
          ctx.strokeStyle = rgba(AMBER, (1 - ph) * 0.95); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(W / 2, H / 2, 12 + ph * Math.min(W, H) * 0.38, 0, Math.PI * 2); ctx.stroke();
        }
        chip("SEARCHING FOR FACE…", W / 2, H / 2, AMBER, "center");
      }

      // 4. ripple when a check is passed
      if (a.burst > 0 && !calm) {
        const p = (t - a.burst) / 1.2;
        if (p < 1) {
          const cx = a.mesh ? (bx0 + bx1) / 2 : W / 2, cy = a.mesh ? (by0 + by1) / 2 : H / 2;
          ctx.strokeStyle = rgba(a.burstColor, (1 - p) * 0.9); ctx.lineWidth = 3 * (1 - p) + 1;
          ctx.beginPath(); ctx.arc(cx, cy, 20 + p * Math.max(W, H) * 0.55, 0, Math.PI * 2); ctx.stroke();
        } else a.burst = -1;
      }

      // 5. objects the AI spotted: red animated boxes
      for (const o of a.objects.values()) {
        const al = 1 - clamp((t - o.seen - 0.5) / 0.4);
        const x0 = X(o.x + o.w), x1 = X(o.x), y0 = Y(o.y), y1 = Y(o.y + o.h);
        glow(RED, 12);
        ctx.strokeStyle = rgba(RED, al); ctx.lineWidth = 2;
        brackets(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) * 0.25);
        ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 30; ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(RED, 0.55 * al); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]); noGlow();
        chip(`⚠ ${o.label} DETECTED`, x0, Math.max(20, y0 - 14), RED, "left", al);
      }
      for (const o of a.others.values()) {
        const al = 1 - clamp((t - o.seen - 0.5) / 0.4);
        const x0 = X(o.x + o.w), x1 = X(o.x), y0 = Y(o.y), y1 = Y(o.y + o.h);
        glow(AMBER, 10);
        ctx.strokeStyle = rgba(AMBER, al); ctx.lineWidth = 2;
        brackets(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) * 0.22);
        noGlow();
        chip("⚠ EXTRA PERSON", x0, Math.max(20, y0 - 14), AMBER, "left", al);
      }

      // 6. head-turn challenge: arrows flow toward the side to turn to
      if (challenge === "active" && frame) {
        const step = frame.challengeProgress;
        const side = (step === 0 ? frame.challengeFirst : frame.challengeFirst === "left" ? "right" : "left");
        const dir = side === "left" ? -1 : 1; // the picture is a mirror, so "your left" is the left of the picture
        for (let i = 0; i < 4; i++) {
          const ph = calm ? 1 : (t * 1.8 - i * 0.35) % 1.4;
          const al = clamp(Math.sin(clamp(ph / 1.4) * Math.PI));
          const x = W / 2 + dir * (W * 0.2 + i * W * 0.055);
          const s = W * 0.03;
          glow(GREEN, 12);
          ctx.strokeStyle = rgba(GREEN, al); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(x - dir * s, H / 2 - s * 1.5); ctx.lineTo(x + dir * s, H / 2); ctx.lineTo(x - dir * s, H / 2 + s * 1.5); ctx.stroke();
          noGlow();
        }
        chip(step === 0 ? `TURN ${side.toUpperCase()}` : `NOW TURN ${side.toUpperCase()}`, W / 2, H - 28, GREEN, "center");
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = rgba(i < step ? GREEN : WHITE, i < step ? 1 : 0.35);
          ctx.beginPath(); ctx.arc(W / 2 - 10 + i * 20, H - 50, 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // 7. head pose dial (bottom right): the dot is your head, the dashed circle is the allowed range
      {
        const cx = W - 40, cy = H - 46, R = 26, safe = R * 0.55;
        ctx.fillStyle = "rgba(2,6,23,0.6)"; ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(WHITE, 0.25); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        const off = !!frame?.hud?.head_away;
        ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(off ? AMBER : CYAN, 0.8);
        ctx.beginPath(); ctx.arc(cx, cy, safe, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        let dx = -a.pose[0] * safe, dy = a.pose[1] * safe; // minus: the picture is mirrored
        const d = Math.hypot(dx, dy);
        if (d > R - 3) { dx *= (R - 3) / d; dy *= (R - 3) / d; }
        glow(off ? AMBER : GREEN, 8);
        ctx.fillStyle = rgba(off ? AMBER : GREEN, 1); ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 3.5, 0, Math.PI * 2); ctx.fill(); noGlow();
        ctx.font = MONO; ctx.fillStyle = rgba(WHITE, 0.6); ctx.textAlign = "center"; ctx.fillText("HEAD", cx, cy - R - 9);
      }

      // 8. bottom-left readouts: light level, blink count and a live-feed pulse line
      {
        const x = 20, y = H - 20;
        ctx.fillStyle = "rgba(2,6,23,0.62)"; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - 8, y - 46, 150, 56, 8); else ctx.rect(x - 8, y - 46, 150, 56);
        ctx.fill();
        ctx.font = MONO; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(WHITE, 0.7); ctx.fillText("LIGHT", x, y - 36);
        const lit = Math.round(((frame?.hud?.light ?? 0) / 100) * 5);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i < lit ? rgba(lit <= 1 ? AMBER : GREEN, 0.95) : rgba(WHITE, 0.2);
          ctx.fillRect(x + 40 + i * 7, y - 41, 5, 10);
        }
        ctx.fillStyle = rgba(WHITE, 0.7); ctx.fillText(`BLINKS ${a.blinks}`, x, y - 18);

        if (t - a.ecgAt > 0.05) {
          a.ecgAt = t;
          const spike = a.blinkFlash > 0.5 ? 1 : 0;
          a.ecg.push(feedBad ? 0 : spike ? 1 : (Math.random() - 0.5) * 0.15 + Math.sin(t * 5) * 0.12);
          a.ecg.shift();
        }
        ctx.strokeStyle = rgba(feedBad ? AMBER : GREEN, 0.95); ctx.lineWidth = 1.3; ctx.lineJoin = "round";
        ctx.beginPath();
        a.ecg.forEach((v, i) => (i ? ctx.lineTo(x + i * 0.95, y - v * 7) : ctx.moveTo(x, y - v * 7)));
        ctx.stroke();
        ctx.fillStyle = rgba(feedBad ? AMBER : GREEN, 0.95);
        ctx.fillText(feedBad ? "VERIFYING" : "LIVE FEED", x + 68, y);
      }

      // 9. warnings across the whole picture
      if (blocked) {
        ctx.strokeStyle = rgba(RED, 0.4 + 0.5 * Math.abs(Math.sin(t * 3))); ctx.lineWidth = 5;
        ctx.strokeRect(3, 3, W - 6, H - 6);
        chip("CAMERA BLOCKED", W / 2, H / 2, RED, "center");
      } else if (flags.includes("low_light")) chip("LOW LIGHT · add light in front of you", W / 2, 27, AMBER, "center");
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hudRef]);

  const checks = deriveChecks(props.status, screenOk);
  const dot: Record<CheckState, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", alert: "bg-red-400", pending: "bg-cyan-400 animate-pulse" };
  const box: Record<CheckState, string> = {
    ok: "border-emerald-400/30 text-emerald-200", warn: "border-amber-400/50 text-amber-200",
    alert: "border-red-400/60 text-red-200", pending: "border-cyan-400/30 text-cyan-200",
  };

  return (
    <div className="rounded-2xl bg-slate-950 p-2 shadow-[0_0_40px_-12px_rgba(34,211,238,0.45)] ring-1 ring-cyan-400/25">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        {props.children}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(2,6,23,0.6)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.035)_0_1px,transparent_1px_3px)]" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {checks.map((c, i) => (
          <div key={c.id} style={{ animation: `chipIn .5s ease both ${i * 70}ms` }}
            className={`rounded-lg border bg-slate-900/70 px-2 py-1.5 transition-colors duration-500 ${box[c.state]}`}>
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-70">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[c.state]}`} />{c.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] font-semibold uppercase tracking-wide">{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
