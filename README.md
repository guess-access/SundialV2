# Prestige Dealer Alliance Timelogs

Single-file time-clock app (front end) — `app.html`, with the landing page now taking
over `index.html` at the site root.

Originally deployed as **Shift Clock** on `sundial-logs.netlify.app`; this copy adds:

## Big centre title
`Prestige Dealer Alliance` with a spaced `TIMELOGS` subtitle and accent rule at the top of
every screen (sign-in and app). The **logo** (`logo.png`, transparent background) sits
centred above the title, and the accent rule uses the logo's own colours — red `#FF0C04`
and blue `#4AB1E0` (`--brand-red` / `--brand-blue`) — instead of the old green/amber.

## Admin edit function
- Editing a shift writes an audit record: entry id, date, old → new times, timestamp and the
  **editor's username**.
- Each edited row is tagged `✎ edited by @username`.
- A **Change history** panel sits at the bottom of the timesheet listing every change with
  `by @username · date time`, plus a closing `Last change on this sheet by @username` line.
- The admin can **add**, **edit** and **delete** shifts on somebody else's behalf (the sheet
  has an *Add shift* button, every row has *Edit*, and the edit box has *Delete shift*).
- Deleting a shift and approving or declining a staff correction request are logged the same
  way, so the admin who did it is always named at the bottom of the sheet.
- The timesheet CSV gained an **Edited by** column; the punch log CSV now includes the
  edit/delete events alongside the punches.
- The record is written to both the shift object (`entry.audit`) and the shared settings log
  (`settings.audit`), so it survives if the backend only keeps one of them.
- **Break 1, Break 2 and Lunch are edited the same way.** The edit box carries a *From* and a
  *To* box for each of the three, prefilled with what is on file. A pair left blank is recorded
  as *not taken*; a *To* left blank on a shift that is still open means the break is still
  running. Only the pairs that really changed are written, and each one lands in the change
  history in the editor's own words:
  `Lunch 11:09 AM – 11:09 AM → 11:15 AM – 11:45 AM`, `added Break 1 3:00 PM – 3:15 PM`,
  `removed Lunch (12:00 PM – 1:00 PM)`.
- The boxes are checked before anything is saved: an end before its start (`The Lunch end time
  has to be after its start.`), a start without an end on a closed shift, or an end without a
  start each stop the save with the message under the form and leave the shift untouched.
  Breaks that were not touched are left exactly as recorded, even when they were written by
  the clock buttons within the same minute.

## Everything is approved by an admin
- Staff never change a logged shift directly: their rows only offer **Request edit**, which
  files a correction request with a note.
- The admin reviews requests under **Team → Edit requests**, can adjust the times being
  approved, and chooses **Approve** or **Decline**. The outcome and the admin's username are
  stored on the request (`resolvedBy`) and written into the change history at the bottom of
  that person's sheet.
- Break corrections go through the same door. A staff member's **Request edit** box carries the
  same three pairs of boxes for Break 1, Break 2 and Lunch, prefilled from their own sheet, so
  they can ask for a lunch that never got recorded. The pending list shows `· break times`
  next to those requests, and the review box is prefilled with exactly what they asked for,
  under a line saying so, with what is on file summarised above it. **Approve** writes the
  values shown; putting a box back to what is on file simply leaves that break alone, and the
  approval still lands in the history as `approved @username's request` followed by each
  change.
- Schedules work the same way: the clock screen has **Request schedule change**, the week is
  set out in the same day-by-day editor, and the admin sees the schedule on file beside the
  one requested before approving it. Approving saves it and logs the admin's username.
- The server enforces this, not just the page: a person may only ever *add* to their own
  shifts (clock in, break, clock out), may not delete a shift, may not write the change
  history, and may not approve or decline their own request. Only an admin can change
  accounts, passcodes or schedules.

## More than one admin
- **Team → Make admin** promotes somebody after a confirmation that spells out what an
  admin can do; the row then offers **Make staff** to take it away again. Either way the
  outcome is logged as `name is now an admin — logged as @username`.
- Creating a person, changing a role and resetting a passcode all **wait for the server**
  before they claim success. If the save has not landed the dialog says so plainly
  (`Not saved yet — … isn't on the server, so they can't sign in`) instead of announcing a
  login nobody can use, and the change retries by itself while the tab stays open.
- The server enforces the same thing: only an admin may change accounts, passcodes or
  roles, and it refuses to demote, switch off or delete the last active admin. A CSV
  import can create an admin with `role` = `admin`, but can never demote one.

## What a staff account cannot do
- **Change a passcode** — the button is admin-only and the server refuses; an admin resets
  it from **Team → Reset passcode**.
- **Export** a timesheet or a punch log — the export buttons are admin-only.
- Change somebody else's record, turn sign-ups on or off, or switch off the last admin.

## Eastern time, 12-hour
- Every clock, time, schedule and CSV value is **US Eastern (America/New_York, EST/EDT)**
  shown in **12-hour** form (`9:05 AM`, `6:00 PM`) — the big clock included.
- Schedule and correction fields are written the same way (`9:00 AM`); the CSV import and
  `parseTime` still accept `09:00-18:00` as well.

## More flexible schedules
- Per-day schedule editor: **Rest day / Fixed hours / Split shift / Flexible hours** with
  12-hour time fields, plus quick actions *Copy Monday to weekdays*, *Copy Monday to every
  day*, *All days off*.
- Split shifts keep both windows (`8:00 AM–12:00 PM + 1:00 PM–5:00 PM`) instead of being
  flattened into one span; overnight shifts still show `(next day)`.
- Flexible days are never counted as late and the clock reads
  “Flexible hours today — clock in whenever”.
- CSV import keeps both windows of a split shift and accepts `Flexible` per day.
- Saving a schedule goes to the server straight away and is written into the change history
  like any other edit.

## Day-by-day timesheet with a status
- The sheet lists **every date in the range as its own row**, Monday to Sunday — weekends
  appear whether or not anybody is rostered — instead of only the shifts that were punched.
- Each row carries a **Status**:
  - **Absent** — no clock in within **4 hours** of the scheduled start. Today's shift shows
    *Not clocked in yet* until that window closes, and a shift that has not started shows
    *Expected 9:00 AM*.
  - **Late (hh:mm:ss)** — clocked in after the scheduled start, e.g. `Late (00:12:30)`.
  - **Early logout (hh:mm:ss)** — clocked out before the scheduled end.
  - **On time**, **Still clocked in**, **Rest day**, **Flexible hours**, **No schedule** or
    **Worked on a rest day**. Two can appear together, e.g. `Late (00:05:00) · Early logout (00:12:00)`.
- The totals above the sheet gained an **Absent** count next to *Days worked*, *Break time*
  and *Total worked*.
- The timesheet CSV follows the same shape: one row per day — weekends and absences
  included — with `Day`, `Late (min)`, `Early out (min)` and a readable `Status` column.
  **Export every timesheet** does the same for everybody, day by day across the days each
  person has worked.
- Days without a shift show `—` in the time columns; *Edit* (admin) and *Request edit*
  (staff) only appear on days that have one. The view lists the first 400 days of a range
  and says so; exports cover up to 4000 days per person.

## Schedules carry their date
- **Team → Schedule** has a **Schedule effective from** date, because rosters often change
  weekly. Saving stores `{ from, days }` and **keeps the earlier dated schedules**, so last
  week's hours still judge last week and the new hours start on the date picked.
- The Team list shows `effective Mon, Oct 12` under the summary, a schedule request carries
  its date, and the review box shows `Requested · effective …` beside what is on file now.
- Records written before dates existed keep working: `u.sched` still mirrors the newest set
  and any day with no dated record falls back to it.
- CSV import takes an optional `schedule_from` column (`2026-10-05`) and stamps today's date
  when the column is missing; the downloadable template includes it.

## Wide layout, phone friendly
- The page runs up to **1440px** wide (was 1040px), so the status, times and action columns
  of the sheet sit side by side instead of being squeezed.
- Below **760px** everything drops to one column: smaller padding, a smaller clock, punch
  lists that wrap, tables inside their own horizontal scroller, 96%-width dialogs, and form
  fields set to 16px so iOS and Android do not zoom the page when a field gets focus.
- The `viewport` meta tag (`width=device-width, initial-scale=1, viewport-fit=cover`) keeps
  the layout honest on tablets and phones, and safe-area padding covers notched screens.

## Landing page

`index.html` is the front page, and it is what the site root serves: a headline on the left, and on the right the app itself — its **loading screen** with the mark still turning, and a **sign-in** directly underneath. Pressing Sign in lights a loading line under the mark — the same bar the video-intro frame uses — with *Warming up your timesheet…* beneath it, while the credentials travel across.

The hero sign-in performs the app's own login on the spot: username check, salt fetch, passcode hash, login call — the same exchange, byte for byte, that the app runs (the hash, the validator and the API shape are mirrored). The session lands in `localStorage` under the app's key, so `app.html` opens already inside. Whatever cannot sign in there — first setup, a missing backend — falls back to the handoff: the username and passcode travel to `app.html` through `sessionStorage`, never the query string, so a passcode never reaches a URL, a history entry or a server log, and the app fills its own form or explains why it cannot finish.

Everything else lives one click away on `about.html`: the mark in motion (the 16:9 **video intro** frame, the app loading screen, the reversed lockup), the feature list, the colour and motion spec, and the asset download. Both marketing pages share one stylesheet, `site.css`, so the dark/light switch paints them identically.

The app itself is `app.html`. Its seal-and-wordmark header is the way back to the front page.

The mark lives in `sundial-mark.svg` as one self-contained file: the two orbits slowly
counter-rotate (**16s** and **22s**, linear, so the loop point is invisible) while the lime
centre dot pulses (**2.4s**) with a halo pinging outward, after a one-off draw-in beat
(ring traces over 1.4s, orbits fade, dot pops). It is pure CSS — no JavaScript, no SMIL —
so it works as an `<img>`, as an inline `<svg>` you can restyle, and as a favicon. It
resolves to a finished static state under `prefers-reduced-motion`.

    http://localhost:8788/          # the front page, at the site root
    http://localhost:8788/about.html # about: the mark, the product, colours, assets
    http://localhost:8788/app.html # the app — any static server works, e.g. serve.ps1

Because all three pages are static, they publish anywhere this repository does — GitHub Pages
and Netlify alike — with no build step.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The site root — the front page: headline, the app's loading screen and sign-in. |
| `demo.js` | Demo backend the front page uses: the nine `/api/*` endpoints re-implemented in the browser against `localStorage`. The app carries its own copy inline, so `app.html` stands alone — change both together. |
| `about.html` | About us — the mark in motion, product, colours, asset download. Shares `site.css`. |
| `site.css` | The one stylesheet behind `index.html` and `about.html`, dark by default with a light switch. |
| `app.html` | The app — clock, timesheets, leave, payroll. Everything a signed-in person sees. Self-contained under the Sundial Solstice brand (own login, demo backend inlined); the PNG export still draws `logo.png` onto the sheet. Speaks the same design language as the front page: Jakarta display type with Inter body, the teal/coral/lime accents, pill buttons, 12px fields, 20px cards, and the same dark-by-default switch (the `sundial-theme` choice is shared, so the theme follows you between pages). |
| `sundial-mark.svg` | The animated mark on its own: rotating orbits, pulsing dot, self-contained CSS. |
| `netlify/functions/*.js` | The backend: `status`, `salt`, `signup`, `login`, `logout`, `state`, `sync`, `migrate`, `health`. |
| `lib/store.js` | Shared storage and permission code the functions are bundled with. |
| `package.json` | Pulls in `@netlify/blobs` when Netlify builds from git. |
| `netlify.toml`, `_redirects` | Publish the repository root, bundle the functions, and map `/api/*` onto them. |
| `index.test.html` + `_mock-api.html` | QA copy only: the page with an in-page mock of `/api/*`. **Not for production.** |
| `backend.test.html` | QA only: runs the real function files against an in-memory Blobs stand-in (64 checks). **Not for production.** |
| `serve.ps1` | Tiny local static server (`http://localhost:8787/`) for the QA copies. |
| `push-to-github.ps1` | Old helper that uploaded `index.html` and `README.md` through the GitHub Contents API (this machine has no git binary). |

## The backend

Everything the page asks of `/api/*` now lives in this repository, so one deploy ships the
page and the API together.

| Endpoint | Method | Needs a sign-in | What it does |
| --- | --- | --- | --- |
| `/api/status` | GET | no | `{ needsSetup, signup }` for the sign-in screen. |
| `/api/salt?u=name` | GET | no | The salt to hash the passcode with; unknown names get a stable one of their own. |
| `/api/signup` | POST | no | Creates an account — the first one becomes the admin; returns `{ token, userId }`. |
| `/api/login` | POST | no | Checks the hash, returns `{ token, userId }`; 401 keeps the message the page shows. |
| `/api/logout` | POST | yes | Drops this device's token. |
| `/api/state` | GET | yes | The whole timesheet; your own passcode hash, never anyone else's. |
| `/api/sync` | POST | yes | Folds this device's changes in, replies with the full state. |
| `/api/migrate` | POST | no | One-time move of data in — only while the server is empty, otherwise **409**. |
| `/api/health` | GET | no | `{ node, read, write, conditional, ok }` storage self-test. |

Storage is **Netlify Blobs** at site scope — the same service the original backend used.

**Existing data.** The store name and key the original code used are not known from the
outside, so on first use the backend lists every store on the site and reads the keys inside
until it finds data shaped like the app state (`users` / `entries` / `requests` /
`settings`), whether that is one key holding everything or one key per collection. It then
reads and writes in that same place, so existing accounts, passcodes and timesheets carry on
unchanged. If it finds nothing, it starts blank on a store named `sundial-timelogs`, and
`/api/migrate` can be used to seed it (see below).

**Permissions** are enforced server-side: an admin may change anything — including adding,
editing and deleting shifts for other people. Anyone else may only clock their own punches
and file requests; the server refuses a staff passcode change, a rewrite of an already
recorded shift, a deleted shift, a change to somebody else's record, and approving their own
request — and nobody can switch off the last admin.

The one exception is employee information: people may update their **own** profile
name (first, middle, last), birthday, photo, phone, address, emergency contact
and notes, all from the My Info tab. Age and tenure compute themselves from the
birthday and hire date. Position, hire date and employment status stay
admin-only, as do username, role, active state, passcode and schedule — the
server compares against what is on file, so sending a whole record back never
smuggles a promotion, and adding accounts stays admin-only. Photos upload
from the device and shrink to a 256px JPEG before saving.

## Demo mode (no backend)

On plain static hosting (GitHub Pages) there are no functions behind `/api/*`,
so both pages fall back to `demo.js`: the same nine endpoints, the same
validation and the same permission rules, running in the browser against
`localStorage` (`sundial-demo-db`). It engages automatically when `/api/status`
is missing, and a reload re-probes — so the moment a real backend is deployed,
it wins again with no code change.

Demo accounts (seeded on first use, sign-ups stay open for real ones):

| Username | Passcode | View |
| --- | --- | --- |
| `admin` | `admin1234` | Admin — Team, timesheets, schedules, exports, passcodes |
| `demo` | `demo1234` | Staff — Clock, My timesheet, leave and schedule requests |
| `rosa.diaz`, `jose.ramos`, `ana.cruz` | `test1234` | Sample staff with full profiles, seeded so the roster shows real information. Switch one off on the Team tab to retire it. |

The demo staff profile ships filled in, and older demo databases fill their
blanks on next load (tracked by `seedV`) — anything already typed is never
overwritten.

Be clear-eyed about what this is: demo sign-in is convenience, not security.
The passcodes and the data sit in the browser, readable by anyone with the
device. The app says so on screen ("Demo mode — no server connected"). Real
rosters belong on the Netlify backend, where the same rules are enforced
server-side and the data is shared across devices — demo data never leaves
its browser.

## Deploying

The live site is **https://sundial-logs.netlify.app**, connected to this repository
(`peterkingbrierlee01-maker/sundial-logs`, branch `App`) on the `peterlee101792` Netlify
team. Netlify installs `package.json` (which is where `@netlify/blobs` comes from), bundles
`lib/store.js` into every function with esbuild, publishes the repository root and wires
`/api/*` through `netlify.toml` — so a push to `App` rebuilds the site by itself. Confirm
`/api/status` and `/api/health` answer after a build, then sign in.

If a deploy is uploaded by drag-and-drop instead, dependencies are not installed and the
functions fail — build from git.

**Moving the data over.** The site was moved off the old `pda-opsmanager` team, whose 300
monthly build credits had run out, onto the `peterlee101792` team, which still had a full
window. The whole database is one key in Netlify Blobs — store `sundial-timelogs`, key
`state` — so it was copied with the Blobs REST API and checked by comparing SHA-256 of
both copies:

    GET /api/v1/blobs/<old site id>/site:sundial-timelogs/state   (old team token)
    PUT /api/v1/blobs/<new site id>/site:sundial-timelogs/state   (new team token)

`/api/status` then answers `needsSetup:false`, which proves the accounts, timesheets and
change history arrived. The old site was renamed `sundial-logs-retired` *before* the new
one took the name `sundial-logs`, so the URL never points at two sites at once; it still
serves the pre-move snapshot and can be renamed back if anything goes wrong. (Signing in
to the old deployment and posting its state to `/api/migrate` works too.)

After deploying, confirm once that the change history survives a reload on another device —
that proves the backend stores the extra `audit` fields.

## GitHub Pages mirror

The repository was renamed to `sundial-logs`, so GitHub Pages serves it at
**https://peterkingbrierlee01-maker.github.io/sundial-logs/** (the old
`sundial-timelogs` URLs redirect). Pages is switched on for the `App` branch at the
repository root, and `.nojekyll` makes it copy the files verbatim instead of running
Jekyll over them. It publishes the same `index.html` byte for byte, so the mirror always
shows the current interface — branding, EST 12-hour clock, day-by-day timesheet, dated
schedules and the wide phone layout.

Pages is a **static** host: it has no functions, so `/api/*` answers 404 there. The page
detects that and shows *The backend isn't installed on this site yet*, and **Sign in stays
disabled** — the mirror can be looked at but cannot clock anybody in. The working
deployment is `https://sundial-logs.netlify.app`, where the backend and its Blobs data
live. Making the Pages copy sign people in as well would need the browser to call that
backend cross-origin, which means adding CORS headers to the Netlify functions — and that
needs a Netlify deploy.
