# Milestone 3B external-opponent QA

Do not run `seed.sql`. Apply the migrations in timestamp order; for an environment already at
Milestone 3A, apply `20260822000000_external_opponents.sql` followed by
`20260823000000_external_provider_privilege_repair.sql`.

## Migration and security

- Record pre-migration counts for `cfb_games`, `scoring_events`, and `team_ranking_snapshots`; apply the migration and confirm all counts and existing game UUIDs are unchanged.
- Confirm all existing FBS-vs-FBS games have one internal participant on each side and satisfy the new constraints.
- As a league member, confirm external opponent identities used by readable league games render.
- As an owner and anonymous user, confirm inserts/updates/deletes on `external_opponents` are denied and commissioner sync RPC authorization remains enforced.
- Confirm `external_opponents` never appears in draft selection, roster teams, or the manual scoring team selector.

## Full 2026 synchronization

- Run the first full sync and record: fetched **888**, supported/imported **888**, skipped **0**, subject only to a genuine provider/data failure.
- Confirm the existing 761 FBS-vs-FBS game UUIDs, overrides, scores, fingerprints, audit history, and scoring events were preserved.
- Confirm the 127 formerly skipped FBS-vs-FCS games now reference external opponents by CFBD ID.
- Confirm `South Carolina vs Furman (FCS)`-style display, score/status, and CFBD source in commissioner review and league-visible schedule surfaces.
- Run an identical second sync and confirm: created **0**, updated **0**, unchanged **888**, skipped **0**; confirm no duplicate `(cfbd, external_id)` opponents.
- Confirm synchronization itself creates no scoring events and standings do not change.

## Commissioner scoring

- For a final FBS win over FCS, explicitly select **Process Scoring** and confirm exactly one internal-team `WIN +1` event; confirm no external-opponent event.
- For a final FBS loss to FCS, explicitly select **Process Scoring** and confirm exactly one internal-team `LOSS -1` event.
- Confirm no `G5_WIN_OVER_P5`, `P5_LOSS_TO_G5`, or ranked-win bonus is awarded against FCS.
- Confirm no `FBS_LOSS_TO_FCS` rule or special penalty exists yet.
- Reprocess an unchanged game and confirm scoring idempotency; change a result and confirm prior events are voided and normal internal-team scoring is recalculated.
- Recheck representative FBS-vs-FBS WIN/LOSS, ranked-win, and G5/POWER cases for unchanged behavior.

## Manual workflow and visibility

- Create and edit an FBS-vs-FBS manual game using the existing selectors and confirm no external opponent is required.
- Confirm imported FBS-vs-FCS games appear for commissioner review but still require explicit scoring confirmation.
- As an owner, confirm the retained matchup and external display are visible through league-authorized reads; confirm sync and scoring remain commissioner-only.
