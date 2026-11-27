"use client";
import Link from "next/link";
import { MutableRefObject, useEffect, useState } from "react";
import LiveView from "@/components/LiveView";
import { EVENT_LABELS, Level } from "@/lib/api";
import { CheckState, deriveChecks, Feed, LiveEvent, WatchFrame } from "@/lib/hud";

/** Smoothly chases a number so gauges animate instead of jumping. */
function useEased(target: number) {
  const [v, setV] = useState(target);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setV((cur) => (Math.abs(target - cur) < 0.4 ? target : cur + (target - cur) * 0.12));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

const LEVEL = {
  low: { label: "NO CONCERNS", from: "#4ade80", to: "#22d3ee", text: "text-emerald-300" },
  medium: { label: "SOME CONCERNS", from: "#fbbf24", to: "#fb923c", text: "text-amber-300" },
  high: { label: "NEEDS REVIEW", from: "#f87171", to: "#f472b6", text: "text-red-300" },
} as const;

function Gauge({ value, level }: { value: number; level: Level }) {
  const v = useEased(value);
  const L = LEVEL[level];
  const R = 62, C = 2 * Math.PI * R;
  return (
    <div className="relative mx-auto h-[168px] w-[168px]">
      <svg viewBox="0 0 168 168" className="h-full w-full -rotate-90" style={{ filter: `drop-shadow(0 0 10px ${L.from}88)` }}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={L.from} /><stop offset="100%" stopColor={L.to} />
          </linearGradient>
        </defs>
        <circle cx="84" cy="84" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="11" />
        {Array.from({ length: 40 }, (_, i) => {
          const a = (i / 40) * Math.PI * 2;
          return <line key={i} x1={84 + Math.cos(a) * 74} y1={84 + Math.sin(a) * 74} x2={84 + Math.cos(a) * (i % 5 ? 77 : 80)} y2={84 + Math.sin(a) * (i % 5 ? 77 : 80)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />;
        })}
        <circle cx="84" cy="84" r={R} fill="none" stroke="url(#gaugeGrad)" strokeWidth="11" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, v) / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-4xl font-bold tabular-nums text-white">{Math.round(v)}</div>
        <div className={`mt-0.5 font-mono text-[10px] font-semibold tracking-[0.2em] ${L.text}`}>{L.label}</div>
      </div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 280, h = 44;
  const pts = values.length > 1 ? values : [0, 0];
  const max = Math.max(20, ...pts);
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 4 - (v / max) * (h - 10)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      <polygon points={`0,${h} ${xy.join(" ")} ${w},${h}`} fill="url(#sparkFill)" />
      <polyline points={xy.join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MatchRing({ score }: { score: number | null }) {
  const v = useEased(score === null ? 0 : Math.max(0, Math.min(1, score)) * 100);
  const R = 26, C = 2 * Math.PI * R;
  const label = score === null ? "—" : score >= 0.363 ? "MATCH" : score < 0.3 ? "NO MATCH" : "UNSURE";
  const color = score === null ? "#64748b" : score >= 0.363 ? "#4ade80" : score < 0.3 ? "#f87171" : "#fbbf24";
  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" style={{ filter: `drop-shadow(0 0 6px ${color}77)` }}>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
        <span className="text-sm font-bold text-white">{score === null ? "—" : score.toFixed(2)}</span>
        <span className="text-[7px] tracking-widest" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

const CHECK_BOX: Record<CheckState, string> = {
  ok: "border-emerald-400/25 text-emerald-200 shadow-[0_0_18px_-8px_rgba(52,211,153,0.6)]",
  warn: "border-amber-400/50 text-amber-200 shadow-[0_0_18px_-6px_rgba(251,191,36,0.7)]",
  alert: "border-red-400/60 text-red-200 shadow-[0_0_20px_-6px_rgba(248,113,113,0.8)]",
  pending: "border-cyan-400/25 text-cyan-200",
};
const CHECK_DOT: Record<CheckState, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", alert: "bg-red-400", pending: "bg-cyan-400 animate-pulse" };
const SCREEN_EVENTS = new Set(["tab_hidden", "window_blur", "fullscreen_exit"]);

export type ConsoleProps = {
  name: string; position: string; startedAt: number | null; backHref: string;
  feed: MutableRefObject<Feed>;
  latest: WatchFrame | null;
  conn: "connecting" | "open" | "closed"; online: boolean; ended: boolean;
  risk: { value: number; level: Level; history: number[] };
  events: LiveEvent[];
  referenceUrl: string | null; startPhotoUrl: string | null;
  evidenceUrl: (e: LiveEvent) => string | null;
  demo?: boolean;
  extra?: React.ReactNode; // e.g. the demo's scene buttons
};

export default function LiveConsole(p: ConsoleProps) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, []);
  const screenOk = !p.events.some((e) => SCREEN_EVENTS.has(e.type) && now - e.created_at < 20);
  const checks = deriveChecks(p.latest, screenOk);
  const L = LEVEL[p.risk.level];
  const status = p.ended ? ["ENDED", "bg-slate-400"] : p.conn !== "open" ? ["CONNECTING", "bg-amber-400"] : p.online ? ["LIVE", "bg-red-500 animate-pulse"] : ["WAITING FOR CANDIDATE", "bg-amber-400"];
  const score = p.latest?.identity_score ?? null;
  const similarity = p.latest?.similarity ?? null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040714] text-slate-100">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-cyan-500/20 blur-[120px]" style={{ animation: "floaty 18s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute -right-40 top-40 h-[520px] w-[520px] rounded-full bg-violet-600/20 blur-[130px]" style={{ animation: "floaty 24s ease-in-out infinite reverse" }} />

      <div className="relative mx-auto max-w-[1400px] p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={p.backHref} className="font-mono text-xs text-cyan-300/80 hover:text-cyan-200">← ALL INTERVIEWS</Link>
            <h1 className="title-gradient mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{p.name}</h1>
            <p className="text-sm text-slate-400">{p.position} · AI vision monitor{p.demo && <span className="ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] text-violet-200">DEMO DATA</span>}</p>
          </div>
          <div className="glass flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs font-semibold tracking-widest">
            <span className={`h-2.5 w-2.5 rounded-full ${status[1]}`} />{status[0]}
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* camera + checks */}
          <section className="space-y-4">
            <LiveView feed={p.feed} name={p.name} startedAt={p.startedAt} />
            <div className="grid grid-cols-3 gap-2">
              {checks.map((c, i) => (
                <div key={c.id} style={{ animation: `chipIn .5s ease both ${i * 60}ms` }}
                  className={`glass rounded-xl border px-3 py-2 transition-all duration-500 ${CHECK_BOX[c.state]}`}>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">
                    <span className={`h-1.5 w-1.5 rounded-full ${CHECK_DOT[c.state]}`} />{c.label}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-sm font-semibold uppercase">{c.detail}</div>
                </div>
              ))}
            </div>
            {p.extra}
          </section>

          {/* side panels */}
          <aside className="space-y-4">
            <div className="glass rounded-2xl p-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Integrity score</h2>
              <div className="mt-3"><Gauge value={p.risk.value} level={p.risk.level} /></div>
              <div className="mt-3"><Sparkline values={p.risk.history} color={LEVEL[p.risk.level].from} /></div>
              <p className={`mt-1 text-center font-mono text-[10px] tracking-widest ${L.text}`}>LAST {Math.max(p.risk.history.length, 1)} UPDATES</p>
            </div>

            <div className="glass rounded-2xl p-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Identity</h2>
              <div className="mt-3 flex items-center gap-3">
                {p.referenceUrl ? (
                  <figure className="text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.referenceUrl} alt="Reference" className="h-20 w-16 rounded-lg object-cover ring-1 ring-white/15" />
                    <figcaption className="mt-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">Reference</figcaption>
                  </figure>
                ) : (
                  <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-dashed border-white/15 text-center font-mono text-[8px] uppercase leading-tight text-slate-500">No reference</div>
                )}
                <MatchRing score={p.referenceUrl ? score : null} />
                <figure className="text-center">
                  {p.startPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.startPhotoUrl} alt="At start" className="h-20 w-16 rounded-lg object-cover ring-1 ring-white/15" />
                  ) : (
                    <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-dashed border-white/15 font-mono text-[8px] uppercase text-slate-500">Capturing…</div>
                  )}
                  <figcaption className="mt-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">At start</figcaption>
                </figure>
              </div>
              <div className="mt-4">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-slate-400">
                  <span>Same person since start</span><span className="text-slate-200">{similarity === null ? "—" : similarity.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-all duration-700" style={{ width: `${similarity === null ? 0 : Math.max(0, Math.min(1, similarity)) * 100}%` }} />
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl p-5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">Live event feed</h2>
              <ol className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {p.events.filter((e) => e.points > 0 || e.type === "liveness_passed").map((e) => {
                  const c = e.points >= 15 ? "border-red-400/60 bg-red-500/10" : e.points > 0 ? "border-amber-400/50 bg-amber-500/10" : "border-emerald-400/40 bg-emerald-500/10";
                  const img = p.evidenceUrl(e);
                  return (
                    <li key={e.id} style={{ animation: "slideIn .4s ease both" }} className={`flex items-center gap-3 rounded-xl border-l-2 p-2 ${c}`}>
                      {img && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover ring-1 ring-white/10" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">{EVENT_LABELS[e.type] ?? e.type}</p>
                        <p className="font-mono text-[10px] text-slate-400">{new Date(e.created_at * 1000).toLocaleTimeString()}</p>
                      </div>
                      {e.points > 0 && <span className="font-mono text-xs font-bold text-white/80">+{e.points}</span>}
                    </li>
                  );
                })}
                {!p.events.some((e) => e.points > 0 || e.type === "liveness_passed") && <li className="py-6 text-center font-mono text-xs text-slate-500">NOTHING UNUSUAL SO FAR</li>}
              </ol>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
