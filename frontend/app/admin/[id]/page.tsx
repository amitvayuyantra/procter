"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import RiskBadge from "@/components/RiskBadge";
import { adminFetch, API, EVENT_LABELS, SessionDetail, STATUS_LABELS, Verdict, VERDICT_LABELS } from "@/lib/api";

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [verdict, setVerdict] = useState<Verdict | "">("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadedReview, setLoadedReview] = useState(false);

  const load = useCallback((k: string) =>
    adminFetch<SessionDetail>(`/api/admin/sessions/${id}`, k).then((d) => {
      setData(d);
      // fill the review form once, so refreshes never overwrite what the reviewer is typing
      setLoadedReview((done) => {
        if (!done) { setVerdict(d.verdict ?? ""); setNotes(d.notes ?? ""); }
        return true;
      });
    }).catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    const k = sessionStorage.getItem("adminKey") ?? "";
    setKey(k);
    load(k);
    const t = setInterval(() => load(k), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function saveReview() {
    if (!verdict) return;
    await adminFetch(`/api/admin/sessions/${id}/review`, key, { method: "PUT", body: JSON.stringify({ verdict, notes }) });
    setSaved(true);
    load(key);
  }

  if (error) return <main className="p-6"><p className="text-red-600">{error}</p><Link href="/admin" className="underline">Back to login</Link></main>;
  if (!data) return <main className="p-6">Loading…</main>;

  const img = (name: string) => `${API}/api/admin/evidence/${id}/${name}?key=${encodeURIComponent(key)}`;
  const idPhoto = data.events.find((e) => e.type === "identity_check" && e.evidence);
  const concerns = data.events.filter((e) => e.points > 0);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link href="/admin" className="text-sm text-indigo-600 underline">← All interviews</Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{data.candidate_name}</h1>
            <p className="text-slate-500">{data.candidate_email} · {data.position} · {STATUS_LABELS[data.status]}</p>
          </div>
          {data.status !== "invited" && <RiskBadge level={data.level} score={data.risk} />}
        </div>
      </div>

      {data.status === "in_progress" && (
        <Link href={`/admin/${id}/live`} className="flex items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow">
          <span><b>● Interview in progress.</b> Watch the candidate with the live AI vision display.</span>
          <span className="rounded-lg bg-cyan-400 px-3 py-1.5 font-semibold text-slate-900">Watch live →</span>
        </Link>
      )}

      {data.status === "invited" ? (
        <p className="text-slate-500">The candidate has not started yet.</p>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-semibold">Identity &amp; liveness</h2>
            <p className="text-sm text-slate-500">Compare the start-of-interview photo with the reference photo or the candidate&apos;s ID.</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <figure>
                {idPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img(idPhoto.evidence!)} alt="Candidate at start" className="w-56 rounded-lg bg-slate-200" />
                ) : (
                  <div className="flex h-40 w-56 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">No clear photo yet</div>
                )}
                <figcaption className="mt-1 text-center text-sm text-slate-500">At interview start</figcaption>
              </figure>
              {data.has_reference && (
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API}/api/admin/reference/${id}?key=${encodeURIComponent(key)}`} alt="Reference" className="w-56 rounded-lg bg-slate-200" />
                  <figcaption className="mt-1 text-center text-sm text-slate-500">Reference photo</figcaption>
                </figure>
              )}
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              <li>
                <b>Face match:</b>{" "}
                {!data.has_reference ? (
                  <span className="text-slate-500">no reference photo was provided</span>
                ) : data.identity_score === null ? (
                  <span className="text-slate-500">not measured yet</span>
                ) : (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${data.identity_label === "match" ? "bg-green-100 text-green-800" : data.identity_label === "uncertain" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                    {{ match: "Match", uncertain: "Uncertain, check by eye", mismatch: "Does not match" }[data.identity_label ?? "uncertain"]} ({data.identity_score.toFixed(2)})
                  </span>
                )}
              </li>
              <li>
                <b>Head-turn liveness check:</b>{" "}
                <span className={data.liveness === "passed" ? "text-green-700" : data.liveness === "failed" ? "font-semibold text-red-700" : "text-slate-500"}>
                  {{ passed: "Passed", failed: "Not completed", not_run: "Not run" }[data.liveness]}
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Answers</h2>
            <div className="mt-2 space-y-3">
              {data.qa.map((x, i) => (
                <div key={i} className="rounded-xl bg-white p-4 shadow">
                  <p className="font-medium">{i + 1}. {x.question}</p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{x.answer || <span className="text-slate-400">(no answer)</span>}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Integrity timeline ({concerns.length})</h2>
            <ol className="mt-3 space-y-3">
              {concerns.map((e) => (
                <li key={e.id} className="flex gap-4 rounded-xl bg-white p-4 shadow">
                  {e.evidence && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img(e.evidence)} alt="Camera snapshot" className="h-20 w-28 rounded-lg bg-slate-200 object-cover" />
                  )}
                  <div>
                    <p className="font-medium">{EVENT_LABELS[e.type] ?? e.type} <span className="text-sm text-slate-500">+{e.points}</span></p>
                    <p className="text-sm text-slate-500">{new Date(e.created_at * 1000).toLocaleTimeString()}</p>
                  </div>
                </li>
              ))}
              {!concerns.length && <p className="text-slate-500">Nothing unusual recorded.</p>}
            </ol>
          </section>

          <section className="rounded-xl bg-white p-4 shadow">
            <h2 className="text-lg font-semibold">Your review</h2>
            <p className="text-sm text-slate-500">The AI only flags things. You decide what they mean.</p>
            <select value={verdict} onChange={(e) => { setVerdict(e.target.value as Verdict); setSaved(false); }} className="mt-3 w-full rounded-lg border p-2.5">
              <option value="">Choose an outcome…</option>
              {(Object.keys(VERDICT_LABELS) as Verdict[]).map((v) => <option key={v} value={v}>{VERDICT_LABELS[v]}</option>)}
            </select>
            <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} placeholder="Notes (optional)" className="mt-3 w-full rounded-lg border p-2.5" />
            <button onClick={saveReview} disabled={!verdict} className="mt-3 rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white disabled:opacity-40">
              {saved ? "Saved ✓" : "Save review"}
            </button>
          </section>
        </>
      )}
    </main>
  );
}
