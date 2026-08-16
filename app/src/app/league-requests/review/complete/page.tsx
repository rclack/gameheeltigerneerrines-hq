import Link from "next/link";

export default async function LeagueReviewCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string }>;
}) {
  const { decision } = await searchParams;
  const denied = decision === "deny";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-16 text-slate-950">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">
          Site administrator review
        </p>
        <h1 className="mt-2 text-3xl font-black text-blue-950">
          {denied ? "League request denied" : "League approved"}
        </h1>
        <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 font-bold text-emerald-900">
          {denied
            ? "No league was created. The review link can no longer be used."
            : "The league and commissioner membership were created. The review link can no longer be used."}
        </p>
        <Link
          href="/leagues"
          className="mt-5 inline-block rounded-lg bg-blue-950 px-4 py-2 font-bold text-white"
        >
          Return to My Leagues
        </Link>
      </div>
    </main>
  );
}
