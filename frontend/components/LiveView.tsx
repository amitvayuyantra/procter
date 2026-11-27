"use client";
import { MutableRefObject, useEffect, useRef } from "react";
import { BROWA, BROWB, EYEA, EYEB, IRIS_A, IRIS_B, LIPS, NOSE, OVAL, POINT_COUNT, TRIANGLES } from "@/lib/faceMesh";
import type { Feed, LiveFrame } from "@/lib/hud";

/**
 * The interviewer's live AI-vision display.
 * Draws the candidate's camera picture and, on top of it, everything the AI sees.
 * Pictures arrive about 3 times a second; both the picture and the face points are blended between
 * arrivals so the motion looks smooth, and they always stay lined up because they come from the same capture.
 */

type RGB = readonly [number, number, number];
const CYAN: RGB = [34, 211, 238];
const VIOLET: RGB = [167, 139, 250];
const GREEN: RGB = [74, 222, 128];
const AMBER: RGB = [251, 191, 36];
const RED: RGB = [248, 113, 113];
const WHITE: RGB = [241, 245, 249];
const ICE: RGB = [186, 230, 253];
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, Math.max(0, a))})`;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const font = (px: number, weight = 600) => `${weight} ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const hms = (s: number) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60].map((n) => String(n).padStart(2, "0")).join(":");

type Tracked = { label: string; x: number; y: number; w: number; h: number; tx: number; ty: number; tw: number; th: number; seen: number };

export default function LiveView(props: { feed: MutableRefObject<Feed>; name: string; startedAt: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meta = useRef(props);
  meta.current = props;

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

    const lines = document.createElement("canvas");
    lines.width = 4; lines.height = 4;
    const lc = lines.getContext("2d")!;
    lc.fillStyle = "rgba(255,255,255,0.06)"; lc.fillRect(0, 0, 4, 1);
    const scanlines = ctx.createPattern(lines, "repeat")!;

    const a = {
      start: performance.now() / 1000,
      seen: null as LiveFrame | null,
      mesh: new Float32Array(POINT_COUNT * 2),
      hasMesh: false,
      alpha: 0,
      pose: [0, 0],
      blinks: 0, prevBlink: false, blinkFlash: 0,
      objects: new Map<string, Tracked>(),
      others: new Map<string, Tracked>(),
      burst: -1, burstColor: GREEN as RGB,
      prevIdentity: "scanning", prevChallenge: "waiting",
      ecg: Array(48).fill(0), ecgAt: 0,
    };

    const track = (map: Map<string, Tracked>, key: string, label: string, b: number[], t: number) => {
      const [x, y, w, h] = b.map((v) => v / 1000);
      const cur = map.get(key);
      if (cur) Object.assign(cur, { tx: x, ty: y, tw: w, th: h, seen: t });
      else map.set(key, { label, x, y, w, h, tx: x, ty: y, tw: w, th: h, seen: t });
    };

    // a new picture has arrived
    const ingest = (f: LiveFrame, t: number) => {
      const d = f.data;
      d.hud?.boxes.forEach((o, i) => track(a.objects, `${o.label}${i}`, o.label.toUpperCase(), o.box, t));
      d.hud?.others.forEach((o, i) => track(a.others, `p${i}`, "EXTRA PERSON", o, t));
      if (d.hud?.blink && !a.prevBlink) { a.blinks++; a.blinkFlash = 1; }
      a.prevBlink = !!d.hud?.blink;
      if (d.checks.identity !== a.prevIdentity) {
        if ((d.checks.identity === "verified" || d.checks.identity === "locked") && a.prevIdentity === "scanning") { a.burst = t; a.burstColor = GREEN; }
        a.prevIdentity = d.checks.identity;
      }
      if (d.challenge !== a.prevChallenge) {
        if (d.challenge === "passed") { a.burst = t; a.burstColor = GREEN; }
        a.prevChallenge = d.challenge;
      }
    };

    // ---- drawing helpers -------------------------------------------------------------------
    const glow = (c: RGB, blur: number) => { ctx.shadowColor = rgba(c, 0.95); ctx.shadowBlur = blur; };
    const noGlow = () => { ctx.shadowBlur = 0; };
    const rrect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    };
    const text = (s: string, x: number, y: number, px: number, c: RGB, alpha = 1, align: CanvasTextAlign = "left", weight = 600) => {
      ctx.font = font(px, weight); ctx.fillStyle = rgba(c, alpha); ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.fillText(s, x, y);
    };
    const chip = (s: string, x: number, y: number, c: RGB, align: CanvasTextAlign = "left", alpha = 1) => {
      ctx.font = font(10);
      const w = ctx.measureText(s).width + 16;
      const x0 = clamp(align === "center" ? x - w / 2 : align === "right" ? x - w : x, 6, Math.max(6, W - w - 6));
      ctx.fillStyle = `rgba(3,7,18,${0.7 * alpha})`; ctx.strokeStyle = rgba(c, 0.75 * alpha); ctx.lineWidth = 1;
      rrect(x0, y - 10, w, 20, 10); ctx.fill(); ctx.stroke();
      text(s, x0 + 8, y + 0.5, 10, c, alpha);
    };
    const brackets = (x0: number, y0: number, x1: number, y1: number, len: number) => {
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        ctx.moveTo(x, y + dy * len); ctx.lineTo(x, y); ctx.lineTo(x + dx * len, y);
      }
      ctx.stroke();
    };

    // ---- one animation frame ---------------------------------------------------------------
    let last = performance.now();
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      if (!W || !H) return;
      const feed = meta.current.feed.current;
      const curr = feed.curr, prev = feed.prev;
      if (curr !== a.seen) { a.seen = curr; if (curr) ingest(curr, t); }
      const d = curr?.data ?? null;
      const k = 1 - Math.exp(-dt / 0.12);
      const u = curr ? smooth(clamp((t - curr.at) / feed.interval)) : 0; // blend from the previous to the newest picture
      const online = feed.online && !feed.ended;

      // ---- the camera picture, colour-graded
      ctx.fillStyle = "#02050f"; ctx.fillRect(0, 0, W, H);
      if (curr) {
        const f = "filter" in ctx;
        if (f) ctx.filter = online ? "saturate(0.88) contrast(1.08) brightness(0.9)" : "grayscale(1) brightness(0.55)";
        if (prev) ctx.drawImage(prev.bitmap, 0, 0, W, H);
        ctx.globalAlpha = prev ? u : 1;
        ctx.drawImage(curr.bitmap, 0, 0, W, H);
        ctx.globalAlpha = 1;
        if (f) ctx.filter = "none";
      } else {
        // waiting: a faint moving grid
        ctx.strokeStyle = rgba(CYAN, 0.07); ctx.lineWidth = 1; ctx.beginPath();
        const off = calm ? 0 : (t * 14) % 32;
        for (let x = -32 + off; x < W; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = -32 + off; y < H; y += 32) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      }
      const grade = ctx.createLinearGradient(0, 0, W, H);
      grade.addColorStop(0, "rgba(34,211,238,0.16)"); grade.addColorStop(1, "rgba(167,139,250,0.20)");
      ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = grade; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vig.addColorStop(0, "rgba(2,5,15,0)"); vig.addColorStop(1, "rgba(2,5,15,0.7)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = scanlines; ctx.fillRect(0, 0, W, H);

      // ---- smooth values
      const cm = d?.hud?.mesh, pm = prev?.data.hud?.mesh;
      a.hasMesh = !!cm && cm.length === POINT_COUNT;
      if (a.hasMesh && cm) {
        for (let i = 0; i < POINT_COUNT; i++) {
          const px = pm && pm.length === POINT_COUNT ? pm[i][0] : cm[i][0], py = pm && pm.length === POINT_COUNT ? pm[i][1] : cm[i][1];
          a.mesh[i * 2] = lerp(px, cm[i][0], u) / 1000;
          a.mesh[i * 2 + 1] = lerp(py, cm[i][1], u) / 1000;
        }
      }
      a.alpha += ((a.hasMesh && online ? 1 : 0) - a.alpha) * (1 - Math.exp(-dt / 0.2));
      const tp = d?.hud?.pose ?? [0, 0];
      a.pose[0] += (tp[0] - a.pose[0]) * k; a.pose[1] += (tp[1] - a.pose[1]) * k;
      a.blinkFlash = Math.max(0, a.blinkFlash - dt * 4);
      for (const map of [a.objects, a.others])
        for (const [key, o] of map) {
          o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.w += (o.tw - o.w) * k; o.h += (o.th - o.h) * k;
          if (t - o.seen > 1.2) map.delete(key);
        }

      const flags = d?.flags ?? [];
      const identity = d?.checks.identity ?? "scanning";
      const challenge = d?.challenge ?? "waiting";
      const blocked = flags.includes("camera_blocked");
      const issue = (d?.faces ?? 0) > 1 || a.objects.size > 0;
      const accent: RGB = blocked || issue ? RED : CYAN;
      const m = a.mesh;
      const boot = clamp((t - a.start) / 1.2);

      // ---- the face
      let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
      if (a.alpha > 0.02) {
        const al = a.alpha;
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (let i = 0; i < POINT_COUNT; i++) {
          minX = Math.min(minX, m[i * 2]); maxX = Math.max(maxX, m[i * 2]);
          minY = Math.min(minY, m[i * 2 + 1]); maxY = Math.max(maxY, m[i * 2 + 1]);
        }
        const px = (p: number) => m[p * 2] * W, py = (p: number) => m[p * 2 + 1] * H;
        const fx0 = minX * W, fx1 = maxX * W, fy0 = minY * H, fy1 = maxY * H;
        const cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2, size = Math.max(fx1 - fx0, fy1 - fy0);

        const lineGrad = ctx.createLinearGradient(0, fy0, 0, fy1);
        lineGrad.addColorStop(0, rgba(identity === "review" ? AMBER : CYAN, 0.5 * al));
        lineGrad.addColorStop(1, rgba(identity === "review" ? RED : VIOLET, 0.5 * al));
        const strongGrad = ctx.createLinearGradient(0, fy0, 0, fy1);
        strongGrad.addColorStop(0, rgba(identity === "review" ? AMBER : CYAN, 1 * al));
        strongGrad.addColorStop(1, rgba(identity === "review" ? RED : VIOLET, 1 * al));

        // mesh: a ripple of light spreads out from the centre of the face
        const waveR = calm ? -1 : ((t * 0.55) % 1.5) * size * 0.75;
        const band = size * 0.07;
        const lit: number[] = [];
        ctx.lineWidth = 0.75; ctx.strokeStyle = lineGrad; ctx.beginPath();
        for (let i = 0; i < TRIANGLES.length; i += 3) {
          const p0 = TRIANGLES[i], p1 = TRIANGLES[i + 1], p2 = TRIANGLES[i + 2];
          const gx = (px(p0) + px(p1) + px(p2)) / 3, gy = (py(p0) + py(p1) + py(p2)) / 3;
          if (Math.abs(Math.hypot(gx - cx, gy - cy) - waveR) < band) { lit.push(i); continue; }
          ctx.moveTo(px(p0), py(p0)); ctx.lineTo(px(p1), py(p1)); ctx.lineTo(px(p2), py(p2)); ctx.closePath();
        }
        ctx.stroke();
        if (lit.length) {
          ctx.beginPath();
          for (const i of lit) {
            const p0 = TRIANGLES[i], p1 = TRIANGLES[i + 1], p2 = TRIANGLES[i + 2];
            ctx.moveTo(px(p0), py(p0)); ctx.lineTo(px(p1), py(p1)); ctx.lineTo(px(p2), py(p2)); ctx.closePath();
          }
          ctx.fillStyle = rgba(VIOLET, 0.16 * al); ctx.fill();
          ctx.strokeStyle = rgba(ICE, 0.85 * al); ctx.lineWidth = 0.9; ctx.stroke();
        }
        for (let i = 0; i < POINT_COUNT; i++) {
          const tw = calm ? 0.6 : 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.7);
          const near = Math.abs(Math.hypot(px(i) - cx, py(i) - cy) - waveR) < band;
          ctx.fillStyle = near ? rgba(WHITE, al) : rgba(CYAN, (0.3 + 0.45 * tw) * al);
          ctx.beginPath(); ctx.arc(px(i), py(i), near ? 2 : 1.15, 0, Math.PI * 2); ctx.fill();
        }

        // outlines
        const poly = (idx: number[], closed: boolean) => {
          ctx.beginPath();
          idx.forEach((p, i) => (i ? ctx.lineTo(px(p), py(p)) : ctx.moveTo(px(p), py(p))));
          if (closed) ctx.closePath();
        };
        glow(identity === "review" ? AMBER : CYAN, 10);
        ctx.strokeStyle = strongGrad; ctx.lineWidth = 1.7; poly(OVAL, true); ctx.stroke();
        ctx.lineWidth = 1.1; poly(BROWA, false); ctx.stroke(); poly(BROWB, false); ctx.stroke(); poly(NOSE, false); ctx.stroke(); poly(LIPS, true); ctx.stroke();
        ctx.strokeStyle = a.blinkFlash > 0.05 ? rgba(WHITE, al) : strongGrad; ctx.lineWidth = 1.2 + a.blinkFlash * 1.6;
        poly(EYEA, true); ctx.stroke(); poly(EYEB, true); ctx.stroke();
        noGlow();

        // data particles streaming around the outline
        if (!calm) for (let n = 0; n < 6; n++) {
          for (let tail = 0; tail < 5; tail++) {
            const s = (((t * 0.16 + n / 6 - tail * 0.006) % 1) + 1) % 1 * OVAL.length;
            const i0 = Math.floor(s) % OVAL.length, i1 = (i0 + 1) % OVAL.length, f = s - Math.floor(s);
            const x = lerp(px(OVAL[i0]), px(OVAL[i1]), f), y = lerp(py(OVAL[i0]), py(OVAL[i1]), f);
            glow(ICE, tail ? 0 : 8);
            ctx.fillStyle = rgba(ICE, (1 - tail / 5) * 0.95 * al);
            ctx.beginPath(); ctx.arc(x, y, 2.2 - tail * 0.35, 0, Math.PI * 2); ctx.fill();
          }
          noGlow();
        }

        // eyes: iris ring, crosshair and gaze arrow
        const away = !!d?.hud?.gaze_away;
        const gz: RGB = away ? AMBER : GREEN;
        for (const [eye, iris] of [[EYEA, IRIS_A], [EYEB, IRIS_B]] as const) {
          let ex = 0, ey = 0, lo = 1, hi = 0;
          eye.forEach((p) => { ex += m[p * 2]; ey += m[p * 2 + 1]; lo = Math.min(lo, m[p * 2]); hi = Math.max(hi, m[p * 2]); });
          ex = (ex / eye.length) * W; ey = (ey / eye.length) * H;
          const ew = (hi - lo) * W, ix = px(iris), iy = py(iris), r = Math.max(3, ew * 0.17);
          glow(gz, 8);
          ctx.strokeStyle = rgba(gz, 0.95 * al); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(ix, iy, r, 0, Math.PI * 2);
          ctx.moveTo(ix - r * 1.7, iy); ctx.lineTo(ix - r * 1.1, iy); ctx.moveTo(ix + r * 1.1, iy); ctx.lineTo(ix + r * 1.7, iy);
          ctx.moveTo(ix, iy - r * 1.7); ctx.lineTo(ix, iy - r * 1.1); ctx.moveTo(ix, iy + r * 1.1); ctx.lineTo(ix, iy + r * 1.7);
          ctx.stroke();
          const gx = ix + (ix - ex) * 4.5, gy = iy + (iy - ey) * 4.5;
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(gx, gy); ctx.stroke();
          ctx.fillStyle = rgba(gz, al); ctx.beginPath(); ctx.arc(gx, gy, 2, 0, Math.PI * 2); ctx.fill();
          noGlow();
        }

        // tracking reticle: tick ring, counter-rotating arcs and corner brackets
        const pad = 0.12 + (calm ? 0 : 0.012 * Math.sin(t * 2.2));
        bx0 = fx0 - size * pad; bx1 = fx1 + size * pad; by0 = fy0 - size * pad * 1.5; by1 = fy1 + size * pad;
        const ringR = size * 0.78;
        ctx.lineWidth = 1;
        for (let i = 0; i < 72; i++) {
          const ang = (i * Math.PI) / 36 + (calm ? 0 : t * 0.12), long = i % 6 === 0;
          ctx.strokeStyle = rgba(accent, (long ? 0.55 : 0.22) * al);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * ringR, cy + Math.sin(ang) * ringR);
          ctx.lineTo(cx + Math.cos(ang) * (ringR + (long ? 9 : 4)), cy + Math.sin(ang) * (ringR + (long ? 9 : 4)));
          ctx.stroke();
        }
        const spin = identity === "scanning" || challenge === "active";
        for (let i = 0; i < 3; i++) {
          const s = (calm ? 0 : t * (spin ? 1.8 : 0.5)) * (i % 2 ? -1 : 1) + (i * Math.PI * 2) / 3;
          ctx.strokeStyle = rgba(i === 1 ? VIOLET : accent, (spin ? 0.9 : 0.45) * al); ctx.lineWidth = spin ? 2 : 1.2;
          ctx.beginPath(); ctx.arc(cx, cy, ringR - 8 - i * 5, s, s + (spin ? 1.1 : 0.7)); ctx.stroke();
        }
        glow(accent, 8);
        ctx.strokeStyle = rgba(accent, 0.95 * al); ctx.lineWidth = 2;
        brackets(bx0, by0, bx1, by1, Math.min(bx1 - bx0, by1 - by0) * 0.2);
        noGlow();

        // callouts: leader lines to live readouts
        const ang = d?.angles;
        const toDeg = (v: number) => (Math.asin(clamp(v / 0.45, -1, 1)) * 180) / Math.PI;
        const yaw = ang ? toDeg(ang[0]) : 0, pitch = ang ? toDeg(ang[1]) : 0;
        const callout = (p: number, side: 1 | -1, up: 1 | -1, label: string, value: string, c: RGB, delay: number) => {
          const e = clamp((t - a.start - 0.6 - delay) / 0.5) * al;
          if (e <= 0.01) return;
          const ax = px(p), ay = py(p), ex = ax + side * 24, ey = ay + up * 22;
          ctx.font = font(12, 700);
          const pw = Math.max(ctx.measureText(value).width, 44) + 16, ph = 34;
          const x0 = clamp(side > 0 ? ex + 2 : ex - 2 - pw, 6, W - pw - 6);
          ctx.strokeStyle = rgba(c, 0.9 * e); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.lineTo(side > 0 ? x0 : x0 + pw, ey); ctx.stroke();
          ctx.fillStyle = rgba(c, e); ctx.beginPath(); ctx.arc(ax, ay, 2.8, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = rgba(c, 0.5 * e); ctx.beginPath(); ctx.arc(ax, ay, 5.5 + (calm ? 0 : 2 * Math.sin(t * 3)), 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = `rgba(3,7,18,${0.74 * e})`; ctx.strokeStyle = rgba(c, 0.55 * e);
          rrect(x0, ey - ph / 2, pw, ph, 8); ctx.fill(); ctx.stroke();
          text(label, x0 + 8, ey - 7, 8, c, 0.8 * e, "left", 600);
          text(value, x0 + 8, ey + 7, 12, c, e, "left", 700);
        };
        callout(OVAL[7], 1, -1, "YAW", ang ? `${Math.abs(yaw).toFixed(0)}° ${yaw >= 0 ? "LEFT" : "RIGHT"}` : "—", away || d?.hud?.head_away ? AMBER : CYAN, 0);
        callout(OVAL[10], 1, 1, "PITCH", ang ? `${Math.abs(pitch).toFixed(0)}° ${pitch >= 0 ? "DOWN" : "UP"}` : "—", d?.hud?.head_away ? AMBER : CYAN, 0.15);
        callout(OVAL[29], -1, -1, "GAZE", away ? "SIDEWAYS" : "ON SCREEN", away ? AMBER : GREEN, 0.3);
        const idLine = d?.identity_score != null ? [`MATCH`, d.identity_score.toFixed(2)] : d?.similarity != null ? [`SELF`, d.similarity.toFixed(2)] : [`FACE`, "LOCKED"];
        callout(OVAL[26], -1, 1, idLine[0], idLine[1], identity === "review" ? RED : GREEN, 0.45);

        // tag above the face
        const tag = identity === "scanning" ? "SCANNING FACE" : identity === "verified" ? "✓ IDENTITY VERIFIED"
          : identity === "locked" ? "✓ FACE LOCKED" : identity === "review" ? "⚠ IDENTITY MISMATCH" : "TRACKING";
        chip(tag, cx, Math.max(60, by0 - 16), identity === "review" ? RED : identity === "scanning" ? CYAN : GREEN, "center", al);
      } else if (curr && !blocked && boot > 0.5 && online) {
        for (let i = 0; i < 3; i++) {
          const ph = calm ? 0.5 : (t * 0.45 + i / 3) % 1;
          ctx.strokeStyle = rgba(AMBER, (1 - ph) * 0.95); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(W / 2, H / 2, 12 + ph * Math.min(W, H) * 0.38, 0, Math.PI * 2); ctx.stroke();
        }
        chip("NO FACE IN VIEW", W / 2, H / 2, AMBER, "center");
      }

      // ---- ripple when a check passes
      if (a.burst > 0 && !calm) {
        const p = (t - a.burst) / 1.3;
        if (p < 1) {
          const cx = a.alpha > 0.02 ? (bx0 + bx1) / 2 : W / 2, cy = a.alpha > 0.02 ? (by0 + by1) / 2 : H / 2;
          ctx.strokeStyle = rgba(a.burstColor, (1 - p) * 0.9); ctx.lineWidth = 3 * (1 - p) + 1;
          ctx.beginPath(); ctx.arc(cx, cy, 20 + p * Math.max(W, H) * 0.55, 0, Math.PI * 2); ctx.stroke();
        } else a.burst = -1;
      }

      // ---- objects and extra people
      const alert = (o: Tracked, c: RGB, label: string) => {
        const al = 1 - clamp((t - o.seen - 0.8) / 0.4);
        const x0 = o.x * W, x1 = (o.x + o.w) * W, y0 = o.y * H, y1 = (o.y + o.h) * H;
        glow(c, 12);
        ctx.strokeStyle = rgba(c, al); ctx.lineWidth = 2;
        brackets(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) * 0.24);
        ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 30; ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.55 * al);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); noGlow();
        chip(label, x0, Math.max(60, y0 - 14), c, "left", al);
      };
      a.objects.forEach((o) => alert(o, RED, `⚠ ${o.label} DETECTED`));
      a.others.forEach((o) => alert(o, AMBER, "⚠ EXTRA PERSON"));

      // ---- top bar
      const tb = ctx.createLinearGradient(0, 0, 0, 46);
      tb.addColorStop(0, "rgba(3,7,18,0.92)"); tb.addColorStop(1, "rgba(3,7,18,0)");
      ctx.fillStyle = tb; ctx.fillRect(0, 0, W, 46);
      const rec = online ? 0.55 + 0.45 * Math.sin(t * 4) : 0.3;
      ctx.fillStyle = rgba(online ? RED : WHITE, rec); ctx.beginPath(); ctx.arc(22, 22, 4.5, 0, Math.PI * 2); ctx.fill();
      text(online ? "LIVE" : feed.ended ? "ENDED" : "OFFLINE", 34, 22, 11, WHITE, 0.95, "left", 700);
      text(`· CAM-01 · ${meta.current.name.toUpperCase()}`, 34 + (online ? 36 : feed.ended ? 46 : 56), 22, 11, WHITE, 0.7);
      const start = meta.current.startedAt;
      text(start ? hms(Math.max(0, Date.now() / 1000 - start)) : "--:--:--", W - 18, 22, 12, ICE, 0.9, "right", 700);

      // ---- bottom bar
      const bb = ctx.createLinearGradient(0, H - 50, 0, H);
      bb.addColorStop(0, "rgba(3,7,18,0)"); bb.addColorStop(1, "rgba(3,7,18,0.92)");
      ctx.fillStyle = bb; ctx.fillRect(0, H - 50, W, 50);
      const feedBad = d?.checks.feed === "review";
      if (t - a.ecgAt > 0.05) {
        a.ecgAt = t;
        a.ecg.push(!online || feedBad ? 0 : a.blinkFlash > 0.5 ? 1 : (Math.random() - 0.5) * 0.15 + Math.sin(t * 5) * 0.12);
        a.ecg.shift();
      }
      ctx.strokeStyle = rgba(feedBad ? RED : GREEN, 0.95); ctx.lineWidth = 1.3; ctx.lineJoin = "round"; ctx.beginPath();
      a.ecg.forEach((v, i) => (i ? ctx.lineTo(18 + i * 1.6, H - 20 - v * 8) : ctx.moveTo(18, H - 20 - v * 8)));
      ctx.stroke();
      const lastEvent = feed.toasts.length ? feed.toasts[feed.toasts.length - 1].text.toUpperCase() : null;
      text(feedBad ? "FEED LOOKS FROZEN" : lastEvent ? `LAST ALERT · ${lastEvent}` : "ALL SYSTEMS NOMINAL", 104, H - 20, 10, feedBad ? RED : lastEvent ? AMBER : GREEN, 0.95);
      text(`LIGHT ${d?.hud?.light ?? 0}%   BLINKS ${a.blinks}`, W - 18, H - 20, 10, WHITE, 0.7, "right");

      // ---- head pose dial
      {
        const cx = W - 52, cy = H - 92, R = 32, safe = R * 0.55;
        ctx.fillStyle = "rgba(3,7,18,0.6)"; ctx.beginPath(); ctx.arc(cx, cy, R + 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(WHITE, 0.22); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
        const off = !!d?.hud?.head_away;
        ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(off ? AMBER : CYAN, 0.85);
        ctx.beginPath(); ctx.arc(cx, cy, safe, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        let dx = a.pose[0] * safe, dy = a.pose[1] * safe;
        const dd = Math.hypot(dx, dy);
        if (dd > R - 3) { dx *= (R - 3) / dd; dy *= (R - 3) / dd; }
        glow(off ? AMBER : GREEN, 8); ctx.fillStyle = rgba(off ? AMBER : GREEN, 1);
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 3.6, 0, Math.PI * 2); ctx.fill(); noGlow();
        text("HEAD", cx, cy - R - 12, 9, WHITE, 0.6, "center");
      }

      // ---- liveness challenge (the candidate is being asked to turn their head)
      if (challenge === "active" && d) {
        const side = d.challenge_progress === 0 ? d.challenge_first : d.challenge_first === "left" ? "right" : "left";
        const dir = side === "left" ? 1 : -1; // the candidate's left is the right of the picture
        for (let i = 0; i < 4; i++) {
          const al = clamp(Math.sin(clamp((((t * 1.8 - i * 0.35) % 1.4) + 1.4) % 1.4 / 1.4) * Math.PI));
          const x = W / 2 + dir * (W * 0.2 + i * W * 0.04), s = W * 0.02;
          glow(GREEN, 10); ctx.strokeStyle = rgba(GREEN, al); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(x - dir * s, H / 2 - s * 1.5); ctx.lineTo(x + dir * s, H / 2); ctx.lineTo(x - dir * s, H / 2 + s * 1.5); ctx.stroke();
          noGlow();
        }
        chip(`LIVENESS CHALLENGE · TURN ${side.toUpperCase()} · STEP ${Math.min(2, d.challenge_progress + 1)}/2`, W / 2, 22, GREEN, "center");
      }

      // ---- state banners
      if (!curr) {
        for (let i = 0; i < 3; i++) {
          const ph = calm ? 0.5 : (t * 0.35 + i / 3) % 1;
          ctx.strokeStyle = rgba(CYAN, (1 - ph) * 0.6); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(W / 2, H / 2, 10 + ph * Math.min(W, H) * 0.34, 0, Math.PI * 2); ctx.stroke();
        }
        chip(feed.ended ? "INTERVIEW ENDED" : "AWAITING CANDIDATE CAMERA…", W / 2, H / 2, CYAN, "center");
      } else if (feed.ended) chip("INTERVIEW ENDED", W / 2, H / 2, WHITE, "center");
      else if (!feed.online) chip("CANDIDATE DISCONNECTED · RECONNECTING…", W / 2, H / 2, AMBER, "center");
      if (blocked) {
        ctx.strokeStyle = rgba(RED, 0.4 + 0.5 * Math.abs(Math.sin(t * 3))); ctx.lineWidth = 5; ctx.strokeRect(3, 3, W - 6, H - 6);
        chip("CAMERA BLOCKED", W / 2, H / 2, RED, "center");
      } else if (flags.includes("low_light")) chip("LOW LIGHT", W / 2, 22, AMBER, "center");

      // ---- alert toasts slide in at the top right, clear of the face
      feed.toasts.forEach((toast, i) => {
        const age = t - toast.at;
        if (age > 4.5) return;
        const slide = smooth(clamp(age / 0.35)), fade = 1 - clamp((age - 3.8) / 0.7);
        const y = 74 + i * 40;
        ctx.font = font(12, 700);
        const label = `⚠ ${toast.text}   +${toast.points}`;
        const w = ctx.measureText(label).width + 30;
        const x = W - 16 - w + (1 - slide) * 40;
        glow(RED, 16); ctx.fillStyle = `rgba(30,6,12,${0.88 * fade})`; ctx.strokeStyle = rgba(RED, 0.95 * fade); ctx.lineWidth = 1.5;
        rrect(x, y - 15, w, 30, 15); ctx.fill(); ctx.stroke(); noGlow();
        text(label, x + w / 2, y + 0.5, 12, WHITE, fade * slide, "center", 700);
        if (age < 1.2) { ctx.strokeStyle = rgba(RED, (1 - age / 1.2) * 0.85); ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4); }
      });

      // ---- corner frame (draws itself in at start-up)
      ctx.strokeStyle = rgba(accent, 0.8); ctx.lineWidth = 1.5; brackets(8, 8, W - 8, H - 8, 24 * boot);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black shadow-[0_0_60px_-15px_rgba(34,211,238,0.55)] ring-1 ring-cyan-300/30">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
