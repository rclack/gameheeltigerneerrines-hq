import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({
  onNext,
}: WelcomeStepProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <div className="space-y-8 text-center">

          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-orange-300/40 bg-orange-500 text-4xl shadow-lg shadow-orange-950/30" aria-hidden="true">🏈</div>

          <div>
            <h1 className="text-4xl font-bold text-white">
              Your league starts here
            </h1>

            <h2 className="mt-2 text-3xl font-extrabold text-blue-400">
              GameHeelTigerNeerRines
            </h2>
          </div>

          <p className="mx-auto max-w-lg text-lg text-slate-300">
            Your command center for the most competitive
            college football pool you&apos;ll ever play.
          </p>

          <p className="text-slate-400">
            League creation takes only a moment. You&apos;ll invite owners and set the draft order from Commissioner HQ afterward.
          </p>

          <Button
            variant="sports"
            onClick={onNext}
          >
            Start League Setup
          </Button>

        </div>
      </Card>
    </div>
  );
}
