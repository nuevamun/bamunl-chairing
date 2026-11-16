# Chairing: bug analysis and red-team report

Date: 2026-11-15. Scope: `mun/chairing/` (live at chair.bamunl.org) and its tables in the league Supabase project (migrations 12 to 16 in `league-admin/supabase/`).

## How it was tested

- Type check of every script; 44 unit tests, including 400 random sessions and 600 sessions of hostile event records.
- Browser runs (Playwright) of every screen at 1280x720 and 1440x800, two windows (console and display) at once.
- Black-box probes with the public key (what any visitor's browser holds): anonymous reads, helper functions, sign-up setting.
- Live-site checks of headers and the sign-in gate (unauthenticated requests only).
- Code review of every trust boundary: sign-in gate, sign-in API, redirect, local storage, sync, row-level security SQL.

**Not tested:** anything that needs a real login. No password was used, so the signed-in database rules (a subadmin seeing only their own club, a conference login seeing only its conference) were checked by reading the SQL, not by running it. See "Still to do".

## Findings

| # | Severity | What | Status |
|---|---|---|---|
| 1 | High | **Open redirect after sign-in.** `/login?next=/%09/evil.com` passed the check, then the browser dropped the tab and went to `//evil.com`. A phishing link on the real login page could send someone to a look-alike site after they signed in. | Fixed in code (`src/lib/redirect.ts`, tested with 16 payloads). Live once this push deploys. |
| 2 | High | **A malformed event record could lock every chair out of a committee.** A score record with no category crashed the Performance tab; the same class of crash existed for any event type. Anyone with write access to a committee (a conference login, or a bug) could do it. | Fixed. Every event is validated and rebuilt before it touches state; bad ones are dropped. 600 hostile sessions now pass. |
| 3 | Medium | **Signing out offline silently deleted unsent work.** | Fixed. It now counts what hasn't been sent and asks first. If a different person signs in on the same device, unsent work is kept as a recovery copy (`chairing:recovered`) instead of being dropped. |
| 4 | Medium | **A club could put its committee inside another club's conference.** The database only checked that the conference exists, so that club's conference-only logins could then read and edit it. | Fix written: `migration-016`. **Not run yet.** |
| 5 | Medium | **A deleted conference still let its conference-only logins in** for the 30 days it can be restored. | Same migration 16. **Not run yet.** |
| 6 | Medium | **Double-clicking Start** ended the speaker and restarted them: a spurious 0-second speech that counted against the caucus limit. | Fixed, tested. |
| 7 | Medium | **Undo of a Stop** charged the time since the stop to the speaker (clock ran on). | Fixed: they come back paused where they stopped. Tested. |
| 8 | Medium | **The speakers-list dropdown was clipped by its card, covered the list, and every click threw the list back to the top.** | Fixed: free-floating popover beside the list; scroll positions kept. |
| 9 | Medium | **The display never synced on another device** and trusted that both clocks agree. | Fixed: polls every 2 s, shared clock correction, "Not updating" corner message. |
| 10 | Low | Removing a delegate who was on a list or speaking left a nameless row ("?"). | Fixed: they are taken off lists and stopped. |
| 11 | Low | Pasting more than 400 delegates made sync fail every minute (the database caps it). | Fixed: stops at 400 and says so. |
| 12 | Low | A full device storage failed silently. | Fixed: the header says changes aren't being kept. |
| 13 | Low | Long or odd names could break card layouts. | Fixed (wrapping). |

## Held up under attack (no change needed)

- Script injection: markup in every free-text field (conference, committee, delegate, topic, motion, note) is shown as plain text on the console and the projector. 0 alerts, 0 injected elements. There are no HTML-writing calls anywhere in the code.
- Sign-up is switched off on the project; the anonymous key reads nothing from any chairing table, `members`, or the applications and private tables; `revoke_sessions` is refused; the helper functions answer `false` to an anonymous caller.
- Every page redirects to sign-in; the API returns 401 without a session, with a forged cookie, and from a foreign origin.
- The server key is not in the repo, its history, or any script the browser downloads.
- Live headers: strict Content-Security-Policy (own scripts only), HSTS, nosniff, no-store on signed-in pages.

## Accepted or known risks

- The sign-in cookie is readable by page scripts (the browser needs it to sync). If a script injection ever existed, it could be read. The strict CSP and the no-HTML-sinks rule are the guard.
- The password prompt on delete is a screen guard. The database itself lets a signed-in owner delete their own club's rows.
- No sign-in throttling beyond Supabase's own. A sign-in tries the admin address, then the conference address, so each attempt counts twice.
- "That username is taken" reveals that a name exists.
- A new conference-login password is shown on screen once after it is made.
- Delegate feedback sits in the browser's storage on that device until sign-out. The browser keeps about 5 MB; a very long session on one device could fill it (the header then says so).
- Reloading the page with no network shows a browser error (no offline mode yet). Open pages keep working offline.
- Conference logins are not limited per minute, only 25 per conference.

## Random things likely to go wrong in a real committee

| Situation | What happens |
|---|---|
| Laptop sleeps while someone is speaking | The clock shows the whole sleep as speaking time (it is based on the wall clock). The chair presses Stop. |
| Two delegates with the same name | Both can exist; pasting a list skips the repeat. Use distinct names (e.g. "Germany (2)"). |
| Browser tab closed and reopened mid-speech | The speech carries on from the saved record. Nothing lost. |
| Projector opened in a different browser or profile | Needs its own sign-in; after signing in it returns to the display (fixed). Without it, the screen says "Not updating". |
| Two chairs on two devices press different things at once | Both actions are kept (the log only adds); the screens agree within a few seconds. |
| Browser blocks pop-ups | "Open display" opens a new window; allow it, or open `/c/<id>/display` yourself. |
| Safari older than 15.4 | No cross-window updates between the console and a display in the same browser (needs BroadcastChannel). |
| Someone deletes a committee on another device | It moves to Recently deleted everywhere within a minute. |

## Still to do (needs you)

1. Run migrations **16** (and confirm 12 to 15 are in) in the league project.
2. Make two test subadmins (different clubs) and one conference login, then check by hand: each subadmin sees only their own club; the conference login sees only its conference; deleting a conference locks its login. I can write the script for this if you give me throwaway logins.
3. Decide on an offline mode (service worker) before a conference with poor wifi.

## Offline mode (added after the report above)

The wifi may drop for a while mid-committee. A service worker (`public/sw.js`) now keeps a copy of every kind of page and its files on the device.

Tested in a production-style build with the network cut: reload the console (speaker and clock intact); pause, resume, stop and start speakers; open the display in a new window; move between pages; add a committee. Also tested with a connection that accepts requests but never answers: the kept page appears after 4 seconds, not a blank screen. When the network returns, pages come from the server first again.

- **Needs to happen once per device, online and signed in:** open the site. It then keeps every page automatically (about 20 files).
- **What still needs the internet:** signing in or out, deleting (the password check), creating or resetting a conference sign-in, and a committee that was created on another device and has never been opened on this one.
- **Sent later:** everything done offline is saved on the device and sent when the connection returns (it retries on its own). The header says "Offline · saved on this device · N to send".
- **Not tested:** the send after reconnecting needs a real login. The logic is unchanged and covered by the earlier tests.
