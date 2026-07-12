import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({
  onNext,
}: WelcomeStepProps) {
  return (
    <div className="mx-auto mt-16 max-w-2xl">
      <Card>
        <div className="space-y-8 text-center">

          <div className="text-6xl">🏈</div>

          <div>
            <h1 className="text-4xl font-bold text-white">
              Welcome to
            </h1>

            <h2 className="mt-2 text-3xl font-extrabold text-blue-400">
              GameHeelTigerNeerRines HQ
            </h2>
          </div>

          <p className="mx-auto max-w-lg text-lg text-slate-300">
            Your command center for the most competitive
            college football pool you'll ever play.
          </p>

          <p className="text-slate-400">
            We'll have your league ready for kickoff in
            about two minutes.
          </p>

          <Button
            variant="sports"
            onClick={onNext}
          >
            Kick Off a New Season →
          </Button>

        </div>
      </Card>
    </div>
  );
}