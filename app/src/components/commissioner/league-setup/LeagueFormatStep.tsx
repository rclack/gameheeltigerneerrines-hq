import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { OWNER_COUNT_OPTIONS } from "@/lib/draft/config";

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
    <div className="mx-auto max-w-2xl">
      <Card title="League Format">
        <div className="space-y-6">

          <Select
            label="Number of Owners"
            value={ownerCount}
            options={OWNER_COUNT_OPTIONS}
            onChange={onOwnerCountChange}
          />

          <Select
            label="Teams Per Owner"
            value={teamsPerOwner}
            options={["4", "5", "6", "7", "8"]}
            onChange={onTeamsPerOwnerChange}
          />
          <div className="rounded-lg border border-blue-400/20 bg-blue-950/40 p-4">
            <p className="text-sm font-bold text-white">Draft board: {Number(ownerCount) * Number(teamsPerOwner)} total picks</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">Each owner drafts {teamsPerOwner} college teams across {teamsPerOwner} snake-draft rounds.</p>
            <p className="mt-1 text-xs leading-5 text-orange-200">Optional conference and Wild Card roster requirements are configured in Draft Setup before the draft starts.</p>
          </div>
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
            >
              Continue →
            </Button>
          </div>

        </div>
      </Card>
    </div>
  );
}
