import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/leagues");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-950 to-slate-900 px-6 text-white">
      <div className="max-w-3xl space-y-8 text-center">
        <h1 className="text-3xl font-extrabold md:text-5xl lg:text-6xl">
          🏈 GameHeelTigerNeerRines HQ
        </h1>

        <p className="text-2xl text-slate-300">
          Home of the Greatest College Football Draft League
        </p>

        <div className="space-y-2">
          <p className="text-xl">2026 Season</p>
          <p className="text-slate-400">Build your league. Draft your teams. Own Saturdays.</p>
        </div>

        <div className="flex flex-col justify-center gap-4 pt-6 sm:flex-row">
          <Link
            href="/login"
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-700"
          >
            Sign In
          </Link>

          <Link
            href="/signup"
            className="rounded-xl bg-orange-500 px-6 py-3 font-semibold transition hover:bg-orange-600"
          >
            Create Account
          </Link>
        </div>
      </div>
    </main>
  );
}
