# Dice Cricket

A browser cricket game played with one die (rules are in README.md). React 18, TypeScript, Vite, Zustand, Dexie (IndexedDB). The offline game has no server; the online 1v1 mode runs on Cloudflare (Workers + Durable Objects).

## Hard rules

1. **Leave the offline game alone when working on online features.** Exhibition, Tournaments, Bilateral Series, Teams, Stats and Backup must keep working exactly as they do, fully offline. Online work lives in `online.html`, `src/online/` and `server/`. It may *import* from `src/engine/` and `src/components/` but must not change them. Online stats are kept separate from offline stats. Only change offline code when the task is explicitly about the offline game, or asks for a change in **both** modes.

   **Changes for both modes.** Shared components (`src/components/` Die, Scorecard, Charts, PlayerHover, SettingsForm) are used by both, so one edit updates both. Match screen layout is separate: offline is `src/screens/MatchScreen.tsx` and online is `src/online/OnlineMatch.tsx`, so change both and keep them consistent. If a request names only one mode but touches a shared component, say that the other mode will change too.
2. **Never expose this PC to the internet.** No tunnels (cloudflared, ngrok, etc.), port forwarding or public dev servers. Test locally, or deploy to Cloudflare.
3. **Protect the real match data.** It lives in Chrome's IndexedDB (database `dice-cricket`) at **http://localhost:5179**, not on the default port 5173 and not in Edge. A different port or browser shows an empty app; that is not data loss. Never clear site data, delete the database or run migrations without asking first.
4. **Ask before anything outward-facing.** Pushing to `main` deploys to GitHub Pages. `npm run deploy` in `server/` deploys to Cloudflare. Don't do either unless asked.

## Commands

```
npm install
npx vite --port 5179 --strictPort     # run the app on the port that holds the real data
npm test                               # vitest (engine, data, online)
npm run build                          # tsc --noEmit + vite build -> dist/
```

Open it with `Start-Process chrome "http://localhost:5179/"` (the default browser is Edge, which has no data).

Online server (run from `server/`):
```
npm run dev        # wrangler dev, allows localhost:5173 and :5179
npm run check      # type check
npm test           # smoke test
npm run rehearse   # check + build + wrangler deploy --dry-run
```

Run `npm test` and `npm run build` before calling a change done; CI runs both on every push to `main`.

## Layout

- `src/engine/`: pure game logic (dice, match state machine, series, tournaments, stats, story) with tests. Shared by both modes.
- `src/data/`: Dexie DB, presets, backup/restore, validation.
- `src/store/useGameStore.ts`: Zustand store for the offline app.
- `src/screens/`, `src/components/`: offline UI (`index.html` -> `src/main.tsx`).
- `src/online/`: online 1v1 client (`online.html` -> `src/online/main.tsx`), with its own store, DB, protocol and tests.
- `server/`: Cloudflare Worker (`index.ts`), lobby and room Durable Objects, `wrangler.jsonc`.

## Working with more than one Claude

This folder is used from Claude Code and from Claude Cowork (including phone tasks through Dispatch). Don't edit at the same time from both. Commit before handing off, and check `git status` / `git diff` when picking work back up.
