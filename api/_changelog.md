# VibeBullish changelog

Source of the dashboard's Changelog tab, served only to verified admins through
`/api/ops/reads?view=changelog`. Newest first. Add a section at the top:

    ## YYYY-MM-DD · Short title
    - [surface] **Feature name**: what changed for someone using it. (#PR)

Surfaces: web, ios, backend, pipeline, dashboard. Dates are Pacific time.

Add an entry only once the change has shipped: web, dashboard, backend and
pipeline changes are live in production; ios changes are merged to main, and
reach phones with the next TestFlight upload. A merged backend PR that is still
waiting for its deploy lane does not count. Say so when a change ships switched
off. Never put secrets, tokens or credentials here.

## 2026-11-07 · Blurred Buy and Sell bar
- [dashboard] **Overview reads cleanly**: times are in Pacific, each reading's time sits on its own row and says its age once it's a day old, the status appears once instead of twice, the counts say stages and lines, and names read as words. No status changed. (#46)
- [ios] **Buy and Sell bar**: on iOS 26, tiles on the ticker page now blur behind the Buy and Sell buttons instead of running straight behind them. (#135)

## 2026-11-06 · Flat ticker page, prices that say what they are
- [backend] **Measured books under SUPERVISE**: when a measured book (63, 64) is in supervise mode, a buy that was waiting to fill is now cancelled at fill time, a failed dispatch step no longer skips fills or risk checks, and a missing or stale session run now reads as supervise. (#578)
- [dashboard] **Changelog tab**: this tab, a hand-written list of what shipped, newest first, for signed-in admins. (#40)
- [dashboard] **Overview tab**: the first ops tab shows the status of each monitored stage, with the time of each reading and whether a failure paged anyone. A view older than 5 minutes turns grey. Admin only. (#35)
- [dashboard] **Changelog source file**: direct requests for `_changelog.md` now redirect to the home page, so the tab is the way to read it. (#41)
- [ios] **Live prices, inactive**: the app can read live price ticks for Watchlist, ticker details, Portfolio and Quant from the admin-only socket, and does nothing until the backend switch is on. Reaches phones with the next TestFlight upload. (#130)
- [web] **Admin pages during a backend failure**: when the backend answers with a 5xx, `/internal` and the `/v2` docs pages say they're unavailable instead of "Admin only". Access stays refused. (#105)
- [ios] **Flat ticker page**: ticker details is now one flat scroll of tiles in the style of the Weather app, with no pushed screens or "›" rows. (#129)
- [ios] **Price caption**: the ticker header says when the price was observed, for example "After hours · Nov 5, 2:45 PM". It stays hidden for a fresh regular-session trade, and a snapshot's fetch time reads "Last checked". (#132)
- [web] **Retired books hidden**: the Auto-Pilot scoreboard no longer lists retired books, and the "Show all" reveal is gone. Active and paused books are unchanged. (#101)
- [backend] **Deploys wait for the Quant scoreboard**: a new container takes traffic only after its first standings refresh, capped at 120 s, which targets the 15–20 s of "scoreboard unavailable" after each deploy. (#589)
- [backend] **Authenticated live-price socket, switched off**: the admin-only `/ws/events` route is deployed but answers 503 until its switch is turned on, so no live ticks flow yet. (#587)
- [web] **Live price client, inactive**: the web can read live prices from that socket, and does nothing until the switch is on. (#102)

## 2026-11-05 · Quant keeps the page when a refresh fails
- [web] **Failed refresh keeps the page**: on desktop, a failed Quant poll no longer replaces the tab with "Quant feed unavailable". It keeps the last good data and says when that update was from, as the phone layout already did. (#99)

## 2026-11-04 · Quant pages by strategy
- [ios] **Swipe Quant by strategy**: the whole Quant tab pages sideways by strategy, under a fixed pill bar that follows the swipe. (#127)

## 2026-11-03 · iOS tab redesigns
- [ios] **Portfolio account cards**: Portfolio opens on swipeable, Wallet-style account cards. (#116)
- [ios] **Orders matches Holdings**: the Orders segment now uses the same native list style as Holdings. (#124)
- [ios] **Watchlist redesign**: Watchlist is one native list with a filter for the verdicts present, such as Buy now and Sell now. (#117)
- [ios] **Profile redesign**: every Profile row now shows real state or goes somewhere. (#118)
- [web] **Closed-trade split**: the Auto-Pilot scoreboard shows the breakdown of a book's closed trades. (#98)
- [dashboard] **Agent scorecards**: the Agents tab gained risk-flagger coverage, curated-picks and tripwire cards. (#34)
- [dashboard] **Label audit removed**: the tab is gone now that its review round has closed. (#37)
