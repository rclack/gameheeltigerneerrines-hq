import type { ScoringEventDetail } from "@/services/scoringService";
import TeamLogo from "@/components/team/TeamLogo";

function pointsLabel(points: number) {
  return `${points > 0 ? "+" : ""}${points}`;
}

export default function ScoreActivityFeed({ events, limit }: { events: ScoringEventDetail[]; limit?: number }) {
  const visible = typeof limit === "number" ? events.slice(0, limit) : events;
  return (
    <div className="space-y-3">
      {visible.length ? visible.map((event) => (
        <article key={event.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100"><TeamLogo team={event.team} size="md" decorative /></span>
            <div className="min-w-0">
              <p className="font-bold text-slate-950">{event.team.school_name}</p>
              <p className="text-sm text-slate-600">{event.rule.display_name}{event.week !== null ? ` · Week ${event.week}` : " · Season"}</p>
              {event.notes && <p className="mt-1 text-sm text-slate-500">{event.notes}</p>}
            </div>
          </div>
          <span className={`${event.points > 0 ? "text-green-700" : "text-red-700"} text-lg font-black`}>{pointsLabel(event.points)}</span>
        </article>
      )) : <p className="rounded-lg bg-slate-100 p-4 text-slate-500">No scoring activity yet.</p>}
    </div>
  );
}
