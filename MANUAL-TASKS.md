# Manual tasks (things only Jon can do)

Things that need real credentials or an account/dashboard Claude can't touch.
Check items off as they're done; add new ones here rather than burying them in a
HANDOFF.md entry.

## Open

(nothing right now)

## Done

- [x] **Verify iCloud CalDAV discovery against a real Apple ID** — done during
      the 1.84 beta cycle. "Find my calendars" lists the real calendar set;
      create (all-day / timed / multi-day), edit-in-place, and delete all
      propagate to the real "Family" calendar; a wrong app-specific password
      gives a clear error, not a hang. (BETA_CHECKLIST 1.84.0-beta.1, `[AV]`.)
- [x] **Verify Google Calendar push end-to-end** — done during the 1.84 beta
      cycle against a real Google account: connect flow → "Connected as
      <email>", create/timed/multi-day/edit/delete all propagate to the real
      primary calendar with the correct tz offset, non-blocking on failure.
      (BETA_CHECKLIST 1.84.0-beta.1 / beta.4, `[AV]`.)
- [x] **Reconfigure the Google OAuth client for the redirect flow** — done:
      mothership OAuth relay is live and the client is a "Web application"
      with `https://piazzahq.com/oauth/google/callback` registered.
      (BETA_CHECKLIST 1.84.0-beta.1, `[AV]`.)
