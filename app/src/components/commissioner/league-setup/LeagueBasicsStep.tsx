import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

interface LeagueBasicsStepProps {
  leagueName: string;
  season: string;

  onLeagueNameChange: (value: string) => void;
  onSeasonChange: (value: string) => void;

  onBack: () => void;
  onNext: () => void;
}

export default function LeagueBasicsStep({
  leagueName,
  season,
  onLeagueNameChange,
  onSeasonChange,
  onBack,
  onNext,
}: LeagueBasicsStepProps) {
  return (
    <div className="mx-auto mt-16 max-w-2xl">
      <Card title="League Basics">
        <div className="space-y-6">

          <Input
            label="League Name"
            placeholder="Saturday Legends"
            value={leagueName}
            onChange={onLeagueNameChange}
          />

          <Select
            label="Season"
            value={season}
            options={[
                "2026",
                "2027",
                "2028",
            ]}
            onChange={onSeasonChange}
          />

          <div className="flex justify-between">
  <Button
    variant="secondary"
    onClick={onBack}
  >
    ← Back
  </Button>

  <Button
    variant="sports"
    onClick={onNext}
  >
    Continue →
  </Button>
</div>

        </div>
      </Card>
    </div>
  );
}