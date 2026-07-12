import CommissionerDashboard from "@/components/commissioner/CommissionerDashboard";
import LeagueSetupWizard from "@/components/commissioner/LeagueSetupWizard";

export default function CommissionerPage() {
  const hasLeague = false;

  return hasLeague
    ? <CommissionerDashboard />
    : <LeagueSetupWizard />;
}