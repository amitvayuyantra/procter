"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { API } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_name: name, student_email: email }),
      });
      if (!res.ok) throw new Error();
      router.push(`/exam/${(await res.json()).session_id}`);
    } catch {
      setError("Could not reach the server. Is the backend running?");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-3xl font-bold">AI Proctored Exam</h1>
      <p className="mt-2 text-slate-600">Enter your details to begin. You will need a webcam.</p>

      <form onSubmit={start} className="mt-6 space-y-4 rounded-xl bg-white p-6 shadow">
        <input required placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border p-2.5" />
        <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border p-2.5" />
        <label className="flex gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
          <span>
            I agree to be monitored through my webcam and browser during the exam. The AI checks for my face,
            other people, phones and tab switching. Snapshots may be saved when something suspicious happens,
            and a human reviews them.
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={!agree || busy}
          className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white disabled:opacity-40">
          {busy ? "Starting…" : "Continue"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm"><Link href="/admin" className="text-indigo-600 underline">Admin dashboard</Link></p>
    </main>
  );
}
