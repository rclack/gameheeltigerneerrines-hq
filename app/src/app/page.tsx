import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/leagues");

  return (
    <main className="relative flex min-h-screen flex-1 items-center overflow-hidden bg-[#061a38] px-4 py-14 text-white sm:px-6 sm:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(249,115,22,0.23),transparent_27%),radial-gradient(circle_at_85%_70%,rgba(37,99,235,0.35),transparent_34%)]" />
      <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:items-center">
        <section>
          <div className="inline-flex items-center gap-3 rounded-full border border-orange-300/25 bg-orange-500/10 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-sm text-slate-950" aria-hidden="true">GH</span>
            2026 college football pool
          </div>
          <h1 className="mt-6 max-w-4xl text-4xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
            Draft your teams.<br /><span className="text-orange-400">Own Saturdays.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-blue-100 sm:text-xl">
            GameHeelTigerNeerRines turns a private college-football draft into a season-long race with live standings, team watchlists, and a scoring history everyone can follow.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-orange-500 px-7 py-3 font-black text-slate-950 shadow-lg shadow-orange-950/30 transition hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-950"
          >
            Sign In
          </Link>

          <Link
            href="/signup"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 bg-white/10 px-7 py-3 font-black transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-950"
          >
            Create Account
          </Link>
        </div>
          <p className="mt-4 text-sm text-blue-200">Private controlled beta · Invitation-based league play</p>
        </section>

        <section className="grid gap-3" aria-label="How the pool works">
          {[
            ["01", "Draft your programs", "Build a college-team roster in a live snake draft."],
            ["02", "Follow what matters", "See your teams' next games and the league race at a glance."],
            ["03", "Track every point", "Understand wins, losses, corrections, and your complete score history."],
          ].map(([number, title, copy]) => (
            <article key={number} className="rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-xl backdrop-blur-sm">
              <div className="flex gap-4"><span className="font-mono text-sm font-black text-orange-300">{number}</span><div><h2 className="text-lg font-black">{title}</h2><p className="mt-1 text-sm leading-6 text-blue-100/80">{copy}</p></div></div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
