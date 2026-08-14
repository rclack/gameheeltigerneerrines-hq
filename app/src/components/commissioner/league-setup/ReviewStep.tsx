import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface ReviewStepProps {
  leagueName: string;
  season: string;
  ownerCount: string;
  teamsPerOwner: string;

  onBack: () => void;
  onCreateLeague: () => void;
  isSubmitting: boolean;
  error: string | null;
}

export default function ReviewStep({
  leagueName,
  season,
  ownerCount,
  teamsPerOwner,

    onBack,
    onCreateLeague,
    isSubmitting,
    error,
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
    disabled={isSubmitting}
  >
    {isSubmitting ? "Creating League…" : "Create League 🏈"}
  </Button>
</div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/50 bg-red-950/60 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

        </div>
      </Card>
    </div>
  );
}
