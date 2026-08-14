"use client";

import { useActionState } from "react";

import { updateOwnerTeamName, type TeamNameState } from "@/app/league/[leagueId]/actions";
import Button from "@/components/ui/Button";

export default function TeamNameForm({ leagueId, initialName }: { leagueId: string; initialName: string | null }) {
  const action = updateOwnerTeamName.bind(null, leagueId);
  const [state, formAction, pending] = useActionState(action, {} as TeamNameState);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm font-semibold text-slate-600" htmlFor="teamName">Your pool team name</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="teamName" name="teamName" defaultValue={initialName ?? ""} minLength={2} maxLength={80} required className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2 outline-none focus:border-blue-500" />
        <Button type="submit" disabled={pending} className="sm:w-auto">{pending ? "Saving…" : "Save Name"}</Button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700">{state.success}</p>}
    </form>
  );
}
