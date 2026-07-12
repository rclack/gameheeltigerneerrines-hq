"use client";

import { useState } from "react";

import WelcomeStep from "./league-setup/WelcomeStep";

import LeagueBasicsStep from "./league-setup/LeagueBasicsStep";

export default function LeagueSetupWizard() {
  const [step, setStep] = useState(1);
  const [leagueName, setLeagueName] = useState("");
  const [season, setSeason] = useState("2026");

  if (step === 1) {
    return (
      <WelcomeStep
        onNext={() => setStep(2)}
      />
    );
  }

return (
  <LeagueBasicsStep
    leagueName={leagueName}
    season={season}
    onLeagueNameChange={setLeagueName}
    onSeasonChange={setSeason}
    onNext={() => setStep(3)}
  />
);
}