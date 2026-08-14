import Button from "@/components/ui/Button";
import type { League } from "@/types/database";
import type { LeagueRoster } from "@/services/membershipService";
import OwnerManagement from "./OwnerManagement";
import DraftSetup from "./DraftSetup";
import type { Draft } from "@/types/database";
import type { DraftParticipant } from "@/services/draftService";
import Link from "next/link";

interface CommissionerDashboardProps {
  league: League;
  roster?: LeagueRoster;
  draft?: Draft | null;
  participants?: DraftParticipant[];
  pickCount?: number;
}

export default function CommissionerDashboard({ league, roster, draft = null, participants = [], pickCount = 0 }: CommissionerDashboardProps) {
  const activeInvitations = roster?.invitations.filter(
    (invitation) => invitation.status === "pending" && new Date(invitation.expires_at) > new Date(),
  ) ?? [];
  const memberCount = roster?.members.length ?? 1;
  return (
    
    <main className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-blue-950 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <h1 className="text-3xl font-bold">
            🏈 Commissioner Portal
          </h1>

          <div className="flex flex-col items-end gap-2 text-right sm:flex-row sm:items-center">
            <Link href={`/league/${league.id}`} className="rounded-lg bg-white px-4 py-2 font-bold text-blue-950 transition hover:bg-blue-100">View My League</Link>
            <div>
              <p className="font-semibold">GameHeelTigerNeerRines HQ</p>
              <p className="text-sm text-slate-300">{league.season} Season</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-8">

        {/* League Overview */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-bold">
            League Overview
          </h2>

          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">League</p>
              <p className="text-xl font-bold">{league.name}</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Status</p>
              <p className="text-xl font-bold capitalize">{draft?.status.replace("_", " ") ?? "Preseason"}</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Owners</p>
              <p className="text-xl font-bold">{memberCount} / {league.owner_count}</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Teams Drafted</p>
              <p className="text-xl font-bold">
                {pickCount} / {league.owner_count * league.teams_per_owner}
              </p>
            </div>

          </div>
        </div>

        {/* Navigation Cards */}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">🏆 League Management</h3>

            <Button variant="primary" className="mb-2">
              Create League
            </Button>

            <Button variant="secondary">
              League Settings
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">👥 Owners</h3>

            <Button variant="success">
              Manage Owners
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">🎯 Draft</h3>

            {draft && draft.status !== "not_started" ? (
              <Link href={`/draft/${draft.id}`} className="block rounded-lg bg-orange-500 px-4 py-2 text-center font-semibold text-white transition hover:bg-orange-600">Draft Room</Link>
            ) : (
              <Button variant="sports" disabled>Draft Room</Button>
            )}
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">📊 Results</h3>
            <div className="space-y-2">
              <Link href={`/league/${league.id}/standings`} className="block rounded-lg bg-purple-600 px-4 py-2 text-center font-semibold text-white transition hover:bg-purple-700">Standings</Link>
              <Link href={`/league/${league.id}/score`} className="block rounded-lg bg-green-700 px-4 py-2 text-center font-semibold text-white transition hover:bg-green-800">My Score</Link>
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">⚙ Administration</h3>
            <Link href="/commissioner/scoring" className="block rounded-lg bg-red-600 px-4 py-2 text-center font-semibold text-white transition hover:bg-red-700">Scoring</Link>
          </div>

        </div>

        {roster && (
          <OwnerManagement
            leagueId={league.id}
            ownerCount={league.owner_count}
            members={roster.members}
            invitations={roster.invitations}
          />
        )}

        {roster && (
          <DraftSetup
            leagueId={league.id}
            ownerCount={league.owner_count}
            teamsPerOwner={league.teams_per_owner}
            members={roster.members}
            invitations={roster.invitations}
            draft={draft}
            participants={participants}
          />
        )}

        {roster && activeInvitations.length > 0 && (
          <p className="mt-4 text-sm text-slate-500">
            {activeInvitations.length} roster spot{activeInvitations.length === 1 ? " is" : "s are"} reserved by pending invitations.
          </p>
        )}

      </div>
    </main>
  );
}
