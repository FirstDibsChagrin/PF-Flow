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

1. **Supabase.** A free-tier project named `pf-flow` (ref `mlfarkjibpcnxcfozbly`) has already been created in your FirstDibs org, and `supabase/schema.sql` has been applied to it.
   * To use a different project, open its SQL Editor and run `supabase/schema.sql`. Then copy *Project URL* and the *publishable* (or legacy anon) key from **Settings → API**.
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
* **Round info** (the ⓘ button in the flow header) holds opponent, judge, tournament, round, my side, result, speaker points, ballot notes and judge feedback. It's synced live with your partner and merges character by character, like cells. Speaking order there is the same setting as the header toggle.
* **Dashboard filters:** chips for my side, result, speaking order, tournament, judge and opponent (the last three list the values in your flows). Filters combine with AND, and a flow with no result counts as Pending. Search also matches opponent, judge, tournament and round. Cards show the key round info and pick up your partner's edits from the server.
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
| Right-click | Cell menu |
| Mod+B | Bold |
| Mod+Shift+X | Cross out |
| Backspace (empty cell) | Delete the cell |
| Mod+Backspace | Delete the cell and its responses |
| Mod+Z / Mod+Shift+Z | Undo / redo (undoes only your own edits) |

**Tabs and timers**

| Keys | Action |
| --- | --- |
| Mod+Alt+↑ / ↓ | Previous / next tab |
| Alt+S | Start / pause the speech timer |
| Alt+N / Alt+P | Next / previous speech |
| Alt+R | Reset the speech timer |
| Alt+A / Alt+C | Start / pause Aff / Con prep |

## Choices where the spec and Flower differ

* **Grid model:** Flower uses a tree, not a fixed spreadsheet: each response is a child of the cell it answers. That is what keeps responses on the same row as their argument, so this app does the same. Multiple responses to one argument stack inside that argument's row.
* **Arrow keys always navigate between cells, as in Flower.** To move the caret inside a cell's text, use the mouse, Home/End, or Alt/Mod+arrows.
* **Shift+↵ appends** the new response after any existing responses. Flower inserts it first. Appending reads more naturally when you add a second response.
* **Flower's settings for Enter behavior** aren't exposed. Instead there are dedicated "always insert" shortcuts: Mod+↵ and Mod+Shift+↵.
* **Bold, cross-out, and the Mod+E extension cell** come from Flower. The dropped/extended/turned marks are separate from these.
* **Undo** works only on your own edits, so you never undo your partner's work.
