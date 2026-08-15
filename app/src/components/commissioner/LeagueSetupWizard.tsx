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

  if (step === 1) {
    return (
      <WelcomeStep
        onNext={() => setStep(2)}
      />
    );
  }
if (step === 2) {
  return (
    <LeagueBasicsStep
  leagueName={leagueName}
  season={season}
  onLeagueNameChange={setLeagueName}
  onSeasonChange={setSeason}
  onBack={() => setStep(1)}
  onNext={() => setStep(3)}
/>
  );
}

if (step === 3) {
  return (
    <LeagueFormatStep
      ownerCount={ownerCount}
      teamsPerOwner={teamsPerOwner}
      onOwnerCountChange={setOwnerCount}
      onTeamsPerOwnerChange={setTeamsPerOwner}
      onBack={() => setStep(2)}
      onNext={() => setStep(4)}
    />
  );
}

if (step === 4) {
  return (
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
}
return null;
}
