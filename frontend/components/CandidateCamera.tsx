"use client";
import type { ReactNode } from "react";
import type { Status } from "@/lib/useProctoring";

/** What the candidate sees: just their own camera. No AI overlay. */
export default function CandidateCamera({ status, connected, children }: { status: Status; connected: boolean; children: ReactNode }) {
  const checking = status.challenge === "active";
  // The preview is mirrored like a mirror, so "your left" is the left of the picture
  const side = status.challengeProgress === 0 ? status.challengeFirst : status.challengeFirst === "left" ? "right" : "left";
  const dir = side === "left" ? -1 : 1;

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black shadow-lg ring-1 ring-slate-300">
      {children}
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
        <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
        {connected ? "Camera on" : "Reconnecting…"}
      </div>
      {checking && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <div className="flex items-center" aria-hidden>
            {[0, 1, 2].map((i) => (
              <svg key={i} viewBox="0 0 24 40" className="h-14 w-8 drop-shadow-[0_0_8px_rgba(52,211,153,0.9)]"
                style={{ animation: `chevron 1.2s ease-in-out ${i * 0.18}s infinite`, ["--to" as string]: `${dir * 30}px` }}>
                <path d={dir < 0 ? "M18 4 L6 20 L18 36" : "M6 4 L18 20 L6 36"} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
