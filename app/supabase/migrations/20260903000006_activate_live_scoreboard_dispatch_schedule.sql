select cron.schedule(
  'dispatch-live-scoreboard-every-minute',
  '* * * * *',
  $schedule$select private.dispatch_live_scoreboard_poll();$schedule$
);

select cron.schedule(
  'retain-live-scoreboard-dispatch-history',
  '15 5 * * *',
  $schedule$select private.cleanup_live_scoreboard_dispatch_history();$schedule$
);

