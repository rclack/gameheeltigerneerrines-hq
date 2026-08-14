# Milestone 3A CFBD manual QA

Run this only after applying `20260820000000_cfbd_foundation.sql` followed by
`20260821000000_cfbd_sync_counter_ambiguity_repair.sql`. Use a disposable
league for mutation/security checks; do not reset the completed development draft.

## Configuration and connection

- With `CFBD_API_KEY` absent, `/commissioner/scoring` says **Not Configured**, sync is disabled, and no credential appears in HTML, browser bundles, Network payloads, or logs.
- With the key configured only in the server runtime, **Test Connection** reports Connected.
- Confirm invalid credentials, provider errors, and rate limits show safe messages without response headers or key material.

## Schedule synchronization

- Run the league-season schedule sync and record fetched/created/updated/unchanged/skipped totals.
- Confirm the audit row completes and mapping failures are counted without aborting valid games.
- Run the identical sync again: no duplicate `(league, cfbd, external id)` games; games are unchanged.
- Confirm CFBD games use internal team UUIDs through `external_team_mappings`.
- Review Miami (FL), Miami (OH), USC, UConn, NC State, and Ole Miss mappings; unresolved/ambiguous names must be reported, never guessed.
- Confirm a scheduled game becoming final updates the same internal UUID and displays **Final — Needs Scoring**.
- Confirm no scoring event or standings change occurs until **Process Scoring** is selected.
- Process the final game and confirm the existing separate scoring ledger events and **Final — Scored** state.
- Change the provider result in a controlled fixture, sync, and confirm **Final — Result Changed / Reprocess**; reprocess through the existing scoring RPC.

## Conflict and access behavior

- Create a manual game and confirm sync neither deletes nor updates it.
- Edit an imported game as commissioner; confirm it shows **manual override** and later sync skips it.
- Confirm manual pre-game ranking snapshots remain manual; CFBD sync creates no rankings.
- As an owner, read games but confirm sync actions/RPCs are unavailable and denied.
- As anonymous, confirm games, mappings, audit rows, and sync RPCs are unavailable/denied.
- Confirm API outage leaves manual game entry and manual scoring usable.
