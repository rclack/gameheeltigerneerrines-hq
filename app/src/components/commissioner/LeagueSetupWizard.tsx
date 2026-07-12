"use client";

import { useState } from "react";

import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";

export default function LeagueSetupWizard() {
  const [leagueName, setLeagueName] = useState("");

  return (
    <Card title="Kick Off a New Season">
      <div className="space-y-6">
        <Input
          label="League Name"
          placeholder="Saturday Legends"
          value={leagueName}
          onChange={setLeagueName}
        />

        <Button>
          Next →
        </Button>
      </div>
    </Card>
  );
}
