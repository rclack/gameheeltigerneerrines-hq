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
    <div className="mx-auto max-w-2xl">
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

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
  <Button
    className="sm:w-auto"
    variant="secondary"
    onClick={onBack}
  >
    ← Back
  </Button>

  <Button
    className="sm:w-auto"
    variant="sports"
    onClick={onNext}
    disabled={leagueName.trim().length < 2}
  >
    Continue →
  </Button>
</div>

        </div>
      </Card>
    </div>
  );
}
