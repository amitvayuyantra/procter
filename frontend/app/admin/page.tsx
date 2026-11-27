"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RiskBadge from "@/components/RiskBadge";
import { adminFetch, SessionRow } from "@/lib/api";

export default function Admin() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (k: string) => {
    try {
      setRows(await adminFetch<SessionRow[]>("/api/admin/sessions", k));
      sessionStorage.setItem("adminKey", k);
      setAuthed(true);
      setError("");
    } catch (e) {
      setAuthed(false);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminKey");
    if (saved) { setKey(saved); load(saved); }
  }, [load]);

  // Refresh every 5 seconds so live exams update by themselves
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => load(key), 5000);
    return () => clearInterval(t);
  }, [authed, key, load]);

  if (!authed)
    return (
      <main className="mx-auto max-w-sm p-6 pt-24">
        <h1 className="text-2xl font-bold">Admin login</h1>
        <form onSubmit={(e) => { e.preventDefault(); load(key); }} className="mt-4 space-y-3">
          <input type="password" placeholder="Admin key" value={key} onChange={(e) => setKey(e.target.value)} className="w-full rounded-lg border p-2.5" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white">Sign in</button>
        </form>
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold">Exam sessions</h1>
      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-100 text-slate-600">
            <tr><th className="p-3">Student</th><th>Status</th><th>Score</th><th>Events</th><th>Risk</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-3"><div className="font-medium">{r.student_name}</div><div className="text-slate-500">{r.student_email}</div></td>
                <td>{r.finished_at ? "Finished" : <span className="font-semibold text-green-600">● Live</span>}</td>
                <td>{r.score !== null ? `${r.score}/${r.total}` : "—"}</td>
                <td>{r.event_count}</td>
                <td><RiskBadge level={r.level} score={r.risk} /></td>
                <td><Link href={`/admin/${r.id}`} className="text-indigo-600 underline">Review</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
