# PF Flow

A real-time, offline-capable flowing app for Public Forum debate, built for two partners who share one flow.
Cell editing and keyboard navigation follow [Flower](https://debate-flow.vercel.app/).

## Architecture

| Piece | Choice | Why |
| --- | --- | --- |
| App | Vite + React + TypeScript + Tailwind, static SPA | No server code. Fully offline-capable as a PWA (a service worker caches the app shell, so reloading offline works). |
| Data model | [Yjs](https://yjs.dev) CRDT, one `Y.Doc` per flow/template plus one dashboard doc per person | Concurrent edits merge character by character; nothing is overwritten. |
| Offline | `y-indexeddb` (every change is saved locally right away) plus a localStorage stash on page unload | Works with no Wi-Fi. Changes merge automatically when the connection comes back. |
| Live sync | Supabase Realtime **broadcast** (Yjs updates, cursors) plus **presence** (who's here) | Typical latency is about 60–100 ms. |
| Durable storage | Supabase Postgres append-only update log, compacted automatically | A new device or partner loads the full flow even when nobody else is online. |
| Access control | No auth. Tables have RLS on and **no policies**. All access goes through `SECURITY DEFINER` RPCs that require an 8-character code (31-symbol alphabet, ~8.5×10¹¹ codes). Each flow is stored under its own code; your dashboard and templates are stored under a private home code. | Sharing a flow's code gives access to that one flow only, never your dashboard. Codes can't be listed. |

Why not Next.js? Nothing here needs server rendering. A static SPA with a service worker gives much more reliable offline reloads.

If `VITE_SUPABASE_*` env vars are missing, the app falls back to a **local mode**: it syncs between tabs of one browser through BroadcastChannel. This is handy for development.

## Run locally

```bash
git clone https://github.com/FirstDibsChagrin/PF-Flow.git
cd PF-Flow
npm install
cp .env.example .env.local   # then fill in your Supabase URL + publishable key
npm run dev                  # http://localhost:5173
```

The service worker (offline reload) only runs in a production build:

```bash
npm run build
```

```bash
npm run preview              # http://localhost:4173
```

## Setup steps you do by hand

1. **Supabase.** A free-tier project named `pf-flow` (ref `mlfarkjibpcnxcfozbly`) has already been created in your FirstDibs org, and both SQL files have been applied to it: `supabase/schema.sql` (flows) and `supabase/002_history.sql` (version history).
   * To use a different project, open its SQL Editor and run `supabase/schema.sql`, then `supabase/002_history.sql`. Then copy *Project URL* and the *publishable* (or legacy anon) key from **Settings → API**.
   * Free projects pause after about a week of inactivity. Un-pause from the Supabase dashboard if the app shows "Connecting…" forever.
2. **Vercel.** Import the `FirstDibsChagrin/PF-Flow` GitHub repo (leave Root Directory blank) and set:
   * Framework preset: Vite (build `npm run build`, output `dist`). `vercel.json` already handles SPA routing.
   * Environment variables (Production + Preview):
     * `VITE_SUPABASE_URL=https://mlfarkjibpcnxcfozbly.supabase.co`
     * `VITE_SUPABASE_ANON_KEY=<publishable key from Supabase → Settings → API>`
3. Open the site. You land on your own dashboard. Create a flow, and send the code shown at the top of the flow to your partner.

## Using it

* **Your dashboard:** opening the site takes you straight to your own flows and templates. It's created automatically on your first visit and saved on this device.
  * To see the same dashboard on another computer, go to **Settings → Your dashboard on another device**, copy your private home code there, and enter it on the other computer.
* **Sharing a flow:** every flow has its own 8-character code, shown at the top of the flow (click to copy).
  * Your partner enters it in **Join your partner's flow** on their dashboard. The flow opens and is added to their dashboard (marked "Shared with you"). Opening a `/f/CODE` link does the same.
  * The code only unlocks that one flow. Your other flows and templates stay private.
  * Deleting a flow you created deletes it for everyone. Removing a flow that was shared with you only takes it off your dashboard; your partner keeps it.
  * Flows from the earlier shared-room version keep working: each one gets its own code the first time you open it.
* **Flows:** each flow has Aff and Con tabs. Add more with **+** (Weighing, Offs, Overview, Notes, or a custom name). Double-click a tab to rename it. Drag tabs to reorder. Use the tab's ⋯ menu to move, delete, or show and hide columns on extra tabs.
* **Modes:** "Aff speaks first" or "Con speaks first" is chosen when you create a flow and can be switched in the header.
  * First team's sheet: Const → opp. Rebuttal → Summaries → Final Focuses (6 columns).
  * Second team's sheet: Const → both Rebuttals → Summaries → Final Focuses (7 columns).
  * Extra tabs: all 8 speeches in speaking order. No crossfire columns.
  * Switching mode keeps every cell in its column position. If a sheet loses a column, cells in it are hidden (not deleted) until you switch back, and you're warned first.
* **Write anywhere:** click any empty spot in the grid and start typing. Whatever you write stays in the row of the argument it answers.
  * Any empty column to the right of an argument starts a response there. If you skip columns, they stay blank, and you can click them later to fill them in.
  * The empty area at the bottom has a spot in every column, for starting a new argument in any column (for example, a Con off-case that begins in the rebuttal column).
  * Pressing → in an argument with no response yet also starts one.
  * If you click and leave without typing, nothing is left behind.
* **Cells** work like Flower. A cell's responses sit in the next column on the same row, so a whole argument chain lines up horizontally.
* **Marks:** dropped (red, struck through), extended (green), and turned (purple). Use Alt+1/2/3, or right-click a cell.
* **Call evidence** (Alt+4, or right-click → Call evidence) flags a cell whose card you want to call.
  * It's separate from Dropped/Extended/Turned, so a cell can be both, for example Extended and Call evidence. It shows as a small badge in the cell's top-left corner.
  * Badge colors: amber = To call, blue = Called, green = Checked.
  * Click the badge (or right-click → Evidence status & note…) to set the status and write a short note, such as "Smith 24, does it say Russia would actually attack?". Alt+Shift+4 cycles the status.
  * The **Evidence calls** panel (Alt+V) lists every flagged cell by tab with its note and status. Filter by status or tick **Hide Checked**. Click an item to jump to the cell; click its status icon to cycle it.
  * Calls sync live, merge offline, show in version history, and each change is its own undo step (your own only).
  * Calls belong to one round: they're kept in versions and when you duplicate a flow, but never copied into a template or from a template into a new flow.
* **Partner joins and leaves:** a small note appears in the top-right corner, below the header: "Alex joined", "Alex left", "Alex lost connection", "Alex reconnected". It disappears after ~4 s and never takes keyboard focus or blocks clicks.
  * No note for a partner who was already in the flow when you opened it, and never about yourself.
  * The partner's avatar in the header shows their state: normal = here; dimmed with a pulse = reconnecting; grey = away, with "last seen 3 min ago" on hover (remembered per flow, on this device).
  * A goodbye from their tab (closing it, or navigating away) means **left**; a reload within ~4 s is ignored. Vanishing without a goodbye (heartbeat stops, or Realtime Presence drops them) first shows **reconnecting**. If they're back within ~10 s there's no note at all; otherwise it's **lost connection**, then **reconnected** when they return.
  * While *you* are offline there are no notes, and every avatar (yours included) is dimmed because their state is unknown. When you reconnect, you get one note only if your partner's status actually changed while you were away ("Alex left while you were offline").
  * Settings: **Notify when my partner joins or leaves** (default on) and **Sound for partner join/leave** (soft chime, default off). Both are per device. Avatars update either way.
  * Detection reuses the existing presence channel: heartbeats every 4 s carry a stable per-device id and whether the tab is visible. Background tabs are judged by Presence only, because browsers slow their timers. The rules are unit-tested in `src/lib/presenceMonitor.test.ts`.
* **Side panels:** the icon strip on the right edge of a flow opens Round info, the tracker, evidence calls, extensions, chat and history. Only one is open at a time, and the grid narrows to make room (it scrolls sideways as usual).
* **Round info** (the ⓘ button in the flow header, or Alt+I) holds opponent, judge, tournament, round, my side, result, speaker points, ballot notes and judge feedback. It's synced live with your partner and merges character by character, like cells. Speaking order there is the same setting as the header toggle.
* **Dashboard filters:** chips for my side, result, speaking order, tournament, judge and opponent (the last three list the values in your flows). Filters combine with AND, and a flow with no result counts as Pending. Search also matches opponent, judge, tournament and round. Cards show the key round info and pick up your partner's edits from the server.
* **Undo/redo** only ever undoes *your own* edits (Yjs per-origin undo), so you can't undo your partner's work. Quick typing in a cell is one step; moving to another cell, or pausing, starts a new one. Restores from history are undoable too.
* **Version history** (Alt+H):
  * A version is saved automatically about every 5 minutes while someone is editing. **Save version** makes a named one.
  * Each version shows when it was made and who changed what since the one before, for example "Bea edited Con tab (Con Summary)". This comes from a compact activity log kept in the flow (newest ~300 entries).
  * Click a version for a read-only preview of any tab. **Restore this tab** or **Restore whole flow** first saves a version named "Before restore", then applies the restore as a normal synced edit, and your partner gets a notice. Whole-flow restore replaces the tabs and speaking order; Round info, chat, extensions and tracker checkboxes are kept.
  * Retention (enforced by the server): every automatic version for 48 hours, then the newest one per hour up to 14 days, then one per day, capped at 150 automatic versions per flow. Named versions (including "Before restore") are never deleted automatically.
  * Versions are stored online. Saving one while offline queues it on the device and uploads it when you reconnect.
* **Partner chat** (Alt+M): a per-flow chat that only people in the flow can see. It persists with the flow and works offline (messages send when you reconnect).
  * A dot on the chat icon means your partner wrote while the panel was closed.
  * To attach a message to a cell, select the cell, open chat and tick **Attach to cell**. A small marker appears on the cell: click it to open the message. Click the cell link under a message to jump to the cell.
* **Extensions** (Alt+E): prewritten extensions for your own constructive, read aloud in Summary and Final Focus.
  * Aff and Con lists, switched inside the panel (it starts on "My side" from Round info). Each entry has an optional title plus a plain-text Summary version and Final Focus version. Reorder with the arrows; delete with the bin.
  * Click an entry for a large reading view with a Summary/Final Focus switch. **Edit** changes the text, live for both of you. **A− / A+** sets the reading size on this device (default 24 px; it's separate from the grid font size).
  * Extensions are part of templates (the template editor has the same panel). A flow made from a template gets its own copy, so edits during a round only change the flow. **Push changes to template** (bottom of the panel) overwrites the template's extensions with the flow's after a confirmation. It only appears for your own templates, because templates are personal. Otherwise **Save as template** saves the flow, extensions included.
* **Drop/extend tracker** (Alt+T): lists every argument on every tab and how far each side carried it.
  * Each argument and each response gets chips for Rebuttal, Summary and Final Focus. Green = marked Extended. Grey = written but not marked. Dashed = missing. Struck through = not applicable on that tab. Red **!** = a gap (extended earlier, not here).
  * By default it lists arguments extended at least once (or whose responses were). **Show all** adds the rest.
  * Click an argument or a chip to jump to that cell. The **Covered: Sum / FF** boxes and the short **note** are a checklist that syncs live.
* **Templates** are personal (on your dashboard). Build one in the Templates tab, or click **Save as template** in any flow. Start a flow from a template in the New flow dialog or with a template's **New flow from this** button. The copy is independent of the template. A template used in the other mode keeps column positions, so constructives stay in column 1.
* **Timers:** these sit in the bottom bar and are synced through the flow, using a server-calibrated clock. They cover every PF speech and crossfire, plus Aff and Con prep. Default lengths are 4/4/3/2 minutes for speeches, 3:00 for crossfires, and 3:00 prep. Change lengths in Settings: inside a flow you edit that flow's lengths, which are shared with your partner. On the dashboard you edit the defaults for your new flows. When time runs out the bar flashes, and there's an optional beep (speaker icon).
* **Settings** (gear icon): your name and cursor color, theme (system/light/dark), cell font size (12–20 px), reset column widths (drag a column header's right edge to resize), timer sound, and timer lengths.

## Keyboard shortcuts

`Mod` = ⌘ on macOS, Ctrl elsewhere. `Alt` = ⌥ on macOS. Press **Mod + /** for this list in the app.

**Navigate** (a cell is focused)

| Keys | Action |
| --- | --- |
| ↑ / ↓ | Cell above / below in the same column (crosses argument boundaries) |
| ← | Parent (the argument this responds to) |
| → | First response in the next column. If there's none yet, starts one in the same row |
| Tab / Shift+Tab | Next / previous sibling |
| Esc | Leave the cell |
| ↑ ↓ ← → or ↵ (no cell focused) | Jump back into the flow |

**Create**

| Keys | Action |
| --- | --- |
| ↵ | Go to the next sibling, or create a new cell below if there is none |
| Shift+↵ | Add a response (next column) |
| Mod+↵ | Insert a new cell directly below |
| Mod+Shift+↵ | Insert a new cell directly above |
| Alt+↵ | Go to the previous sibling, or create a new cell above if there is none |
| Alt+Shift+↵ | Respond to the next argument |
| Mod+E | Extend: carry the argument into the next column with an → cell |
| Click any empty spot | Write there; it stays in that argument's row |
| Click a line between cells | Insert there |
| Bottom row of any column (or **+** on a column header) | Start a new argument in that column |

**Edit and mark**

| Keys | Action |
| --- | --- |
| Alt+1 / Alt+2 / Alt+3 | Mark dropped / extended / turned (press again to clear) |
| Alt+0 | Clear mark |
| Alt+4 | Call evidence on / off (independent of the other marks) |
| Alt+Shift+4 | Evidence status: To call → Called → Checked |
| Right-click | Cell menu |
| Mod+B | Bold |
| Mod+Shift+X | Cross out |
| Backspace (empty cell) | Delete the cell |
| Mod+Backspace | Delete the cell and its responses |
| Mod+Z | Undo your own last edit (never your partner's); quick typing in a cell undoes as one step |
| Mod+Shift+Z or Mod+Y | Redo |

**Tabs and timers**

| Keys | Action |
| --- | --- |
| Mod+Alt+↑ / ↓ | Previous / next tab |
| Alt+S | Start / pause the speech timer |
| Alt+N / Alt+P | Next / previous speech |
| Alt+R | Reset the speech timer |
| Alt+A / Alt+C | Start / pause Aff / Con prep |

**Side panels** (one open at a time, on the right)

| Keys | Action |
| --- | --- |
| Alt+I | Round info |
| Alt+T | Drop/extend tracker |
| Alt+V | Evidence calls |
| Alt+E | Extensions (also in the template editor) |
| Alt+M | Partner chat |
| Alt+H | Version history |
| Esc | Close the panel, or leave a version preview |

**Extensions panel** (panel open, not typing)

| Keys | Action |
| --- | --- |
| ↑ / ↓ (or K / J) | Select previous / next extension |
| ↵ or Space | Open / close the selected extension |
| S / F | Show the Summary / Final Focus version |
| E | Edit the open extension |
| Esc | Stop editing, then back to the list |

**Chat box**

| Keys | Action |
| --- | --- |
| ↵ | Send |
| Shift+↵ | New line |

## How the tracker infers "extended"

The tracker only reads the Extended and Dropped marks plus row alignment. The rules (unit-tested in `src/lib/tracker.test.ts`, run with `npm test`):

1. **Argument** = the first cell with text along a row. Usually that's the top-level cell; for a row that starts in a later column (blank placeholders before it), it's the first cell with text. Its column decides which side made it.
2. **The arguing side's later cells** are all cells of that side anywhere in the argument's row, including frontlines written under a response.
3. **Response** = the first cell of the other side along a branch under the argument. The other side's later cells under it are that response's own extensions.
4. A side **extended** an item in a speech if some cell of that speech in the item's row is marked Extended, or is an Extend (→, Mod+E) cell. A cell that's there but not marked counts as "written, not marked", not as extended. Speeches before the item, or that aren't a column on that tab, are n/a. (For example, on the first-speaking team's own tab there is no column for its own Rebuttal.)
5. **Gap** = a speech that isn't extended after an earlier speech that was (Rebuttal → Summary → Final Focus).
6. **Dropped** cells never count. Dropped arguments and responses aren't listed.

## Where data lives

* Flows (cells, tabs, Round info, chat, extensions, tracker checkboxes, activity log) are one shared document per flow code: live sync over Supabase Realtime, saved in Postgres, and cached on each device for offline use.
* Versions are rows in `flow_snapshots`, reachable only with the flow's code.
* **Your dashboard and templates are per person, not shared with your partner.** They live under your private home code (Settings → "Your dashboard on another device"). Your partner sees a flow only after joining it by its code, and never sees your templates.
* Per-device settings (theme, font sizes, column widths, name, cursor color) stay in the browser.

## Choices where the spec and Flower differ

* **Grid model:** Flower uses a tree, not a fixed spreadsheet: each response is a child of the cell it answers. That is what keeps responses on the same row as their argument, so this app does the same. Multiple responses to one argument stack inside that argument's row.
* **Arrow keys always navigate between cells, as in Flower.** To move the caret inside a cell's text, use the mouse, Home/End, or Alt/Mod+arrows.
* **Shift+↵ appends** the new response after any existing responses. Flower inserts it first. Appending reads more naturally when you add a second response.
* **Flower's settings for Enter behavior** aren't exposed. Instead there are dedicated "always insert" shortcuts: Mod+↵ and Mod+Shift+↵.
* **Bold, cross-out, and the Mod+E extension cell** come from Flower. The dropped/extended/turned marks are separate from these.
* **Undo** works only on your own edits, so you never undo your partner's work.
