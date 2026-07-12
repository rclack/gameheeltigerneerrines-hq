import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

interface LeagueFormatStepProps {
  ownerCount: string;
  teamsPerOwner: string;

  onOwnerCountChange: (value: string) => void;
  onTeamsPerOwnerChange: (value: string) => void;

  onBack: () => void;
  onNext: () => void;
}

export default function LeagueFormatStep({
  ownerCount,
  teamsPerOwner,
  onOwnerCountChange,
  onTeamsPerOwnerChange,
    onBack,
  onNext,
}: LeagueFormatStepProps) {
  return (
    <div className="mx-auto mt-16 max-w-2xl">
      <Card title="League Format">
        <div className="space-y-6">

          <Select
            label="Number of Owners"
            value={ownerCount}
            options={["4","6", "8", "10", "12", "14", "16"]}
            onChange={onOwnerCountChange}
          />

          <Select
            label="Teams Per Owner"
            value={teamsPerOwner}
            options={["4", "5", "6", "7", "8"]}
            onChange={onTeamsPerOwnerChange}
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