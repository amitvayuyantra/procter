"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LiveConsole from "@/components/LiveConsole";
import { adminFetch, API, SessionDetail } from "@/lib/api";
import { LiveEvent } from "@/lib/hud";
import { useLiveFeed } from "@/lib/useLiveFeed";

/** The interviewer's live monitor: the candidate's camera with the AI vision display. Candidates never see this. */
export default function LivePage() {
  const { id } = useParams<{ id: string }>();
  const [key, setKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setKey(sessionStorage.getItem("adminKey") ?? ""), []);
  useEffect(() => {
    if (!key) return;
    const load = () => adminFetch<SessionDetail>(`/api/admin/sessions/${id}`, key).then(setDetail).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id, key]);

  const live = useLiveFeed(id, key ?? "");

  // events from the live connection arrive instantly; the periodic refresh adds the saved ones (with their snapshots)
  const events = useMemo(() => {
    const byId = new Map<number, LiveEvent>();
    [...(detail?.events ?? []), ...live.events].forEach((e) => byId.set(e.id, e));
    return [...byId.values()].sort((x, y) => y.created_at - x.created_at);
  }, [detail, live.events]);

  if (key === null) return null;
  if (!key || error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#040714] p-6 text-center text-slate-200">
        <div>
          <p className="text-red-300">{error || "Please sign in as a recruiter first."}</p>
          <Link href="/admin" className="mt-3 inline-block text-cyan-300 underline">Go to recruiter login</Link>
        </div>
      </main>
    );
  }

  const url = (path: string) => `${API}${path}?key=${encodeURIComponent(key)}`;
  const startPhoto = events.find((e) => e.type === "identity_check" && e.evidence);
  const risk = live.risk.history.length ? live.risk : { value: detail?.risk ?? 0, level: detail?.level ?? "low", history: [] };

  return (
    <LiveConsole
      name={detail?.candidate_name ?? "Loading…"} position={detail?.position ?? ""} startedAt={detail?.started_at ?? null}
      backHref="/admin" feed={live.feed} latest={live.latest} conn={live.conn} online={live.online}
      ended={live.ended || detail?.status === "completed"} risk={risk} events={events}
      referenceUrl={detail?.has_reference ? url(`/api/admin/reference/${id}`) : null}
      startPhotoUrl={startPhoto ? url(`/api/admin/evidence/${id}/${startPhoto.evidence}`) : null}
      evidenceUrl={(e) => (e.evidence ? url(`/api/admin/evidence/${id}/${e.evidence}`) : null)}
    />
  );
}
