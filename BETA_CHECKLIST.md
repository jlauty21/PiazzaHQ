# Beta Verification Checklist

A running list of everything touched during the **current beta cycle** that
The developer should actually check on real hardware before this cycle gets promoted
to stable. Unlike `CHANGELOG.md` (what changed, for a developer) or
`HANDOFF.md` (why/how, for picking this project back up later), this file
exists purely to answer one question: **"is it safe to promote this beta to
stable yet?"**

**How this file works:**
- Every beta build adds a new dated section below, listing what that
  specific build touched and what's worth checking about it.
- Items accumulate across the whole cycle — nothing gets removed just
  because a later beta shipped.
- **Checking an item off happens in the app** (Settings → Advanced → Beta
  Checklist, tap an item), not by hand-editing `[ ]` to `[x]` in this file.
  Checked state lives in the app's own database
  (`beta_checklist_checked`), NOT in this file's own `[ ]`/`[x]` markers —
  those markers are cosmetic/ignored by the app entirely. This file
  should always be AUTHORED with every item as `[ ]`; don't hand-check
  items here, it won't do anything. (Why the split: this file is treated
  as code and gets wholesale-replaced by every update, same as
  `server.js`; a checkmark stored IN it would silently vanish on the very
  next beta. The database isn't part of what an update replaces, so
  checking survives updates correctly.)
- **On promotion to stable, this file gets wiped back to this same clean
  state** — a fresh cycle starts with an empty list, not a growing
  backlog carried forward from the last one. Anything still unchecked at
  promotion time either got promoted anyway (the developer's call, same as any
  other beta → stable decision) or should have been called out
  explicitly in that promotion's own summary. **Promotion also clears
  `beta_checklist_checked`** (`DELETE FROM beta_checklist_checked;`) so
  the next cycle's items don't inherit stale checkmarks from indices that


## Currently open

No beta cycle in progress — this repo is at a stable release
(1.83.3). The next beta cycle's sections start here when one opens.
