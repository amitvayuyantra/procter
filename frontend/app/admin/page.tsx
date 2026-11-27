"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RiskBadge from "@/components/RiskBadge";
import { adminFetch, SessionRow, STATUS_LABELS, VERDICT_LABELS } from "@/lib/api";

type Template = { key: string; title: string };

export default function Admin() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ candidate_name: "", candidate_email: "", position: "", template: "" });
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!authed || templates.length) return;
    adminFetch<Template[]>("/api/admin/templates", key).then((t) => {
      setTemplates(t);
      setForm((f) => ({ ...f, template: t[0]?.key ?? "" }));
    });
  }, [authed, key, templates.length]);

  // Refresh every 5 seconds so live interviews update by themselves
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => load(key), 5000);
    return () => clearInterval(t);
  }, [authed, key, load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { session_id } = await adminFetch<{ session_id: string }>("/api/admin/invites", key, { method: "POST", body: JSON.stringify(form) });
      setLink(`${window.location.origin}/interview/${session_id}`);
      setCopied(false);
      setForm({ ...form, candidate_name: "", candidate_email: "", position: "" });
      load(key);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!authed)
    return (
      <main className="mx-auto max-w-sm p-6 pt-24">
        <h1 className="text-2xl font-bold">Recruiter login</h1>
        <form onSubmit={(e) => { e.preventDefault(); load(key); }} className="mt-4 space-y-3">
          <input type="password" placeholder="Admin key" value={key} onChange={(e) => setKey(e.target.value)} className="w-full rounded-lg border p-2.5" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white">Sign in</button>
        </form>
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <section>
        <h1 className="text-2xl font-bold">New interview</h1>
        <form onSubmit={invite} className="mt-3 grid gap-3 rounded-xl bg-white p-4 shadow sm:grid-cols-2">
          <input required placeholder="Candidate name" value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} className="rounded-lg border p-2.5" />
          <input required type="email" placeholder="Candidate email" value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} className="rounded-lg border p-2.5" />
          <input required placeholder="Position (e.g. Backend Engineer)" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="rounded-lg border p-2.5" />
          <select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} className="rounded-lg border p-2.5">
            {templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
          <button className="rounded-lg bg-indigo-600 py-2.5 font-semibold text-white sm:col-span-2">Create interview link</button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {link && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-green-50 p-3 text-sm">
            <code className="flex-1 break-all">{link}</code>
            <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); }} className="rounded-lg bg-green-700 px-3 py-1.5 font-semibold text-white">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-bold">Interviews</h2>
        <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-100 text-slate-600">
              <tr><th className="p-3">Candidate</th><th>Position</th><th>Status</th><th>Concerns</th><th>Integrity</th><th>Review</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3"><div className="font-medium">{r.candidate_name}</div><div className="text-slate-500">{r.candidate_email}</div></td>
                  <td>{r.position}</td>
                  <td>{r.status === "in_progress" ? <span className="font-semibold text-green-600">● Live</span> : STATUS_LABELS[r.status]}</td>
                  <td>{r.event_count}</td>
                  <td>{r.status === "invited" ? "—" : <RiskBadge level={r.level} score={r.risk} />}</td>
                  <td className="text-slate-600">{r.verdict ? VERDICT_LABELS[r.verdict] : "—"}</td>
                  <td><Link href={`/admin/${r.id}`} className="text-indigo-600 underline">Open</Link></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No interviews yet. Create one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
