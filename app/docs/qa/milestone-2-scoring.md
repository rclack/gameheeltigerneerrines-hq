# Milestone 2 scoring browser QA

Use the existing completed two-owner development league. Do not reset its draft.

## Authoritative data paths

- Manual add: `add_manual_scoring_event` → `scoring_rules` point snapshot → `scoring_events`.
- Manual void: `void_manual_scoring_event` → audit fields on the existing `scoring_events` row.
- Game save/update: `save_cfb_game` → `cfb_games` plus `team_ranking_snapshots`.
- Game scoring: `process_cfb_game_scoring` → classifications/rankings/rules → separate `scoring_events` rows.
- Game correction: changed game fingerprint → prior active events voided → replacement active events inserted atomically.
- Standings: `drafts`/`draft_picks` assign teams to `league_members`; active `scoring_events.points` are summed by drafted-team ownership.
- Manual team selector: league → draft → `draft_picks` → `teams`. Game opponent selectors intentionally use all active FBS teams.

## Commissioner

- Open **Scoring** from Commissioner Admin.
- Confirm **Choose team** contains exactly the four drafted college teams and identifies each drafting owner.
- Confirm **Scoring rule** contains active non-game rules.
- Add `HEISMAN_WINNER` and confirm the preview shows the team, rule, and `+10`.
- Confirm the ledger shows an independent `HEISMAN_WINNER +10` row.
- Confirm standings and the drafted owner’s score increase by 10.
- Void the event with a clear QA reason.
- Confirm the ledger retains a visibly voided row and active totals decrease by 10.
- Enter a completed game and process scoring.
- Confirm every awarded rule is a separate ledger row; never accept a combined unexplained game total.

## Owner

- Confirm Standings is readable.
- Confirm My Score shows the owner total and drafted college teams.
- Expand a college team and confirm individual events, weeks, notes, and signed points are readable.
- Confirm no commissioner scoring controls are visible.

## Navigation

- From Commissioner Admin, open **View My League**.
- From the commissioner’s league page, return through **Commissioner Admin**.
- Confirm Draft Room, Standings, My Score, and Scoring Admin are reachable through the expected role-aware paths.
- Confirm an ordinary owner does not see **Commissioner Admin**.

## Visual contrast

- Check landing, Commissioner Admin, league, draft results, standings, My Score, and scoring pages.
- Confirm primary text is dark on light surfaces.
- Confirm secondary text remains legible.
- Confirm dark surfaces retain light text.
- Confirm enabled form values and placeholders are readable and disabled controls remain visibly disabled.

## Database integration suite

Run against a non-production Supabase project with a service-role credential supplied only at runtime:

```bash
SUPABASE_SERVICE_ROLE_KEY="..." npm run test:scoring
```

The suite creates an isolated league and two temporary users, runs cases A–N through the real RPCs, and removes the fixture in `finally`. Never place the service-role key in `.env.local` or commit it.
