"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import RiskBadge from "@/components/RiskBadge";
import { adminFetch, API, EVENT_LABELS, SessionDetail } from "@/lib/api";

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");

  useEffect(() => {
    const k = sessionStorage.getItem("adminKey") ?? "";
    setKey(k);
    const load = () => adminFetch<SessionDetail>(`/api/admin/sessions/${id}`, k).then(setData).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  if (error) return <main className="p-6"><p className="text-red-600">{error}</p><Link href="/admin" className="underline">Back to login</Link></main>;
  if (!data) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-indigo-600 underline">← All sessions</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{data.student_name}</h1>
          <p className="text-slate-500">{data.student_email} · {data.finished_at ? `Score ${data.score}/${data.total}` : "Exam in progress"}</p>
        </div>
        <RiskBadge level={data.level} score={data.risk} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Timeline ({data.events.length})</h2>
      <ol className="mt-3 space-y-3">
        {data.events.map((e) => (
          <li key={e.id} className="flex gap-4 rounded-xl bg-white p-4 shadow">
            {e.evidence && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API}/api/admin/evidence/${id}/${e.evidence}?key=${encodeURIComponent(key)}`} alt="Camera snapshot"
                className="h-20 w-28 rounded-lg bg-slate-200 object-cover" />
            )}
            <div>
              <p className="font-medium">{EVENT_LABELS[e.type] ?? e.type} <span className="text-sm text-slate-500">+{e.points}</span></p>
              <p className="text-sm text-slate-500">{new Date(e.created_at * 1000).toLocaleTimeString()}</p>
            </div>
          </li>
        ))}
        {!data.events.length && <p className="text-slate-500">Nothing suspicious recorded.</p>}
      </ol>
    </main>
  );
}
