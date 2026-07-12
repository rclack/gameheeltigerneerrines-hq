"use client";

import { useState } from "react";

import WelcomeStep from "./league-setup/WelcomeStep";

import LeagueBasicsStep from "./league-setup/LeagueBasicsStep";

import LeagueFormatStep from "./league-setup/LeagueFormatStep";

import ReviewStep from "./league-setup/ReviewStep";

import { createLeague } from "@/services/leagueService";

export default function LeagueSetupWizard() {
  const [step, setStep] = useState(1);
  const [leagueName, setLeagueName] = useState("");
  const [season, setSeason] = useState("2026");
  const [ownerCount, setOwnerCount] = useState("12");
  const [teamsPerOwner, setTeamsPerOwner] = useState("6");

async function handleCreateLeague() {
  try {
    const league = await createLeague({
      name: leagueName,
      commissioner_name: "Randy",
      season,
      owner_count: Number(ownerCount),
      teams_per_owner: Number(teamsPerOwner),
    });

    console.log("League created!", league);
  } catch (error) {
    console.error(error);
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
/>
  );
}
return null;
}