import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-md p-6 pt-24 text-center">
      <h1 className="text-3xl font-bold">AI Interview Proctor</h1>
      <p className="mt-4 text-slate-600">
        <b>Candidates:</b> please open the personal interview link from your invitation email.
      </p>
      <p className="mt-6">
        <Link href="/admin" className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white">Recruiter dashboard</Link>
        <Link href="/demo" className="ml-3 rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700">See the AI vision demo</Link>
      </p>
    </main>
  );
}
