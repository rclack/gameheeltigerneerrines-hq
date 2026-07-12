import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface ReviewStepProps {
  leagueName: string;
  season: string;
  ownerCount: string;
  teamsPerOwner: string;

  onBack: () => void;
  onCreateLeague: () => void;
}

export default function ReviewStep({
  leagueName,
  season,
  ownerCount,
  teamsPerOwner,

    onBack,
    onCreateLeague,
}: ReviewStepProps) {
  return (
    <div className="mx-auto mt-16 max-w-2xl">
      <Card title="Ready for Kickoff?">
        <div className="space-y-4">

          <div className="rounded-lg bg-slate-800 p-4">
            <p className="text-sm text-slate-400">League Name</p>
            <p className="text-xl font-bold text-white">{leagueName}</p>
          </div>

          <div className="rounded-lg bg-slate-800 p-4">
            <p className="text-sm text-slate-400">Season</p>
            <p className="text-xl font-bold text-white">{season}</p>
          </div>

          <div className="rounded-lg bg-slate-800 p-4">
            <p className="text-sm text-slate-400">Owners</p>
            <p className="text-xl font-bold text-white">{ownerCount}</p>
          </div>

          <div className="rounded-lg bg-slate-800 p-4">
            <p className="text-sm text-slate-400">Teams per Owner</p>
            <p className="text-xl font-bold text-white">{teamsPerOwner}</p>
          </div>

          <div className="flex justify-between pt-4">
  <Button
    variant="secondary"
    onClick={onBack}
  >
    ← Back
  </Button>

  <Button
    variant="success"
    onClick={onCreateLeague}
  >
    Create League 🏈
  </Button>
</div>

        </div>
      </Card>
    </div>
  );
}