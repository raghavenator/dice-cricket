# Dice Cricket

A browser cricket game that uses one die. Built with React, TypeScript and Vite. All data is stored in your browser (IndexedDB), so there's no server.

## Rules
- **1, 2, 3, 4, 6**: that many runs.
- **5**: wicket check. The die is rolled again:
  - **4 or more:** OUT. A 4 is bowled, a 5 is caught and a 6 is lbw.
  - **3 or less:** dot ball.
- 6 balls an over. Strike changes on odd runs and at the end of each over. An innings ends at 10 wickets, when the overs run out, or when the target is reached.
- **Limited overs:** 1 innings each. No bowler may bowl more than a fifth of the overs.
- **Test:** 2 innings each. Innings defeats count. With an overs limit per innings, draws are possible.

## Run
```
npm install
npm run dev      # http://localhost:5173
npm test         # engine unit tests
npm run build    # static site in dist/ (open from any static host)
```

## Layout
- `src/engine/`: pure game logic (dice, match state machine, stats, tournaments) with unit tests.
- `src/data/`: Dexie database and the preset teams.
- `src/store/`: Zustand store (screen flow, live match, persistence).
- `src/screens/`, `src/components/`: React UI.
