"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import WelcomeStep from "./league-setup/WelcomeStep";

import LeagueBasicsStep from "./league-setup/LeagueBasicsStep";

import LeagueFormatStep from "./league-setup/LeagueFormatStep";

import ReviewStep from "./league-setup/ReviewStep";

import { createLeague } from "@/services/leagueService";
import { createClient } from "@/lib/supabase/client";

interface LeagueSetupWizardProps {
  userId: string;
}

export default function LeagueSetupWizard({ userId }: LeagueSetupWizardProps) {
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [leagueName, setLeagueName] = useState("");
  const [season, setSeason] = useState("2026");
  const [ownerCount, setOwnerCount] = useState("12");
  const [teamsPerOwner, setTeamsPerOwner] = useState("6");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateLeague() {
    if (isSubmitting) return;

  const trimmedName = leagueName.trim();
  if (trimmedName.length < 2) {
    setError("League name must contain at least 2 characters.");
    return;
  }

  setError(null);
  setIsSubmitting(true);

  try {
    await createLeague(createClient(), {
      name: trimmedName,
      commissioner_id: userId,
      season,
      owner_count: Number(ownerCount),
      teams_per_owner: Number(teamsPerOwner),
    });

    startRefreshTransition(() => router.refresh());
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Unknown error";
    setError(
      message.includes("duplicate key")
        ? "A league with this name already exists for that season."
        : "We couldn't create the league. Please check your details and try again.",
    );
  } finally {
    setIsSubmitting(false);
  }
  }

  const stepContent = step === 1 ? (
    <WelcomeStep onNext={() => setStep(2)} />
  ) : step === 2 ? (
    <LeagueBasicsStep
      leagueName={leagueName}
      season={season}
      onLeagueNameChange={setLeagueName}
      onSeasonChange={setSeason}
      onBack={() => setStep(1)}
      onNext={() => setStep(3)}
    />
  ) : step === 3 ? (
    <LeagueFormatStep
      ownerCount={ownerCount}
      teamsPerOwner={teamsPerOwner}
      onOwnerCountChange={setOwnerCount}
      onTeamsPerOwnerChange={setTeamsPerOwner}
      onBack={() => setStep(2)}
      onNext={() => setStep(4)}
    />
  ) : (
    <ReviewStep
      leagueName={leagueName}
      season={season}
      ownerCount={ownerCount}
      teamsPerOwner={teamsPerOwner}
      onBack={() => setStep(3)}
      onCreateLeague={handleCreateLeague}
      isSubmitting={isSubmitting || isRefreshing}
      error={error}
    />
  );
  const labels = ["Welcome", "League basics", "League format", "Review"];

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#061a38] px-4 py-10 text-white sm:px-6 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Commissioner setup</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Build your league for kickoff</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Choose the league format now. Invitations and draft order come next from Commissioner HQ.</p>
        </div>
        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label={`League setup, step ${step} of 4`}>
          {labels.map((label, index) => {
            const number = index + 1;
            return (
              <li key={label} className={`rounded-lg border px-2 py-2 text-center text-xs font-bold sm:px-3 ${number === step ? "border-orange-300 bg-orange-500 text-white" : number < step ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" : "border-white/15 bg-white/5 text-blue-200"}`} aria-current={number === step ? "step" : undefined}>
                <span className="block text-sm font-black">{number < step ? "✓" : number}</span>
                <span className="hidden sm:block">{label}</span>
              </li>
            );
          })}
        </ol>
        {stepContent}
      </div>
    </main>
  );
}
