import '@fontsource/russo-one';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { MatchStage, usePrefersReducedMotion, type StageDelivery } from '../components/MatchStage';
import { DEFAULT_KITS, kitsFor } from './kits';
import type { ClipKind, Outcome } from './outcome';
import { planDelivery } from './plan';
import type { StageInfo } from './scene/engine';
import { timeline, type Speed } from './timing';

// Dev-only page for tuning the 3D clips: pick an outcome, a seed and a speed.
const CASES: { label: string; o: Outcome }[] = [
  { label: '1', o: { kind: 'ground', runs: 1, check: false, cAndB: false } },
  { label: '2', o: { kind: 'ground', runs: 2, check: false, cAndB: false } },
  { label: '3', o: { kind: 'ground', runs: 3, check: false, cAndB: false } },
  { label: '4', o: { kind: 'four', runs: 4, check: false, cAndB: false } },
  { label: '6', o: { kind: 'six', runs: 6, check: false, cAndB: false } },
  { label: 'Bowled', o: { kind: 'bowled', runs: 0, check: true, how: 'bowled', cAndB: false } },
  { label: 'Caught', o: { kind: 'caught', runs: 0, check: true, how: 'caught', cAndB: false } },
  { label: 'C & B', o: { kind: 'caught', runs: 0, check: true, how: 'caught', cAndB: true } },
  { label: 'LBW', o: { kind: 'lbw', runs: 0, check: true, how: 'lbw', cAndB: false } },
  { label: 'Dot', o: { kind: 'survive', runs: 0, check: true, cAndB: false } },
];
const SPEEDS: Speed[] = ['normal', 'fast', 'online', 'instant', 'reduced'];

function Lab() {
  const reduced = usePrefersReducedMotion();
  const [seed, setSeed] = useState(1);
  const [speed, setSpeed] = useState<Speed>(reduced ? 'reduced' : 'normal');
  const [teamKits, setTeamKits] = useState(true);
  const [d, setD] = useState<StageDelivery | null>(null);
  const [info, setInfo] = useState<StageInfo | null>(null);
  const kits = teamKits ? kitsFor('#c0392b', '#f1c40f') : DEFAULT_KITS;

  const play = (o: Outcome, s = seed) => {
    const plan = planDelivery(o, s);
    setD({ key: `${o.kind}-${s}-${performance.now()}`, plan, timeline: timeline(o.kind as ClipKind, speed), startedAt: performance.now(), numbers: { striker: 4, nonStriker: 7, bowler: 10, fielder: 3 } });
  };

  return (
    <div className="screen" style={{ maxWidth: 1100 }}>
      <h2>3D clip lab</h2>
      <MatchStage delivery={d} kits={kits} onSkip={() => d && setD({ ...d, skipped: true })} onInfo={setInfo} />
      <div className="sim-row" style={{ marginTop: 10 }}>
        {CASES.map((c) => (
          <button key={c.label} className="btn btn-sm" onClick={() => play(c.o)}>{c.label}</button>
        ))}
        <button className="btn btn-sm" onClick={() => { const s = seed + 1; setSeed(s); if (d) play(CASES.find((c) => c.o.kind === d.plan.kind && c.o.cAndB === d.plan.cAndB && (c.o.kind !== 'ground' || c.o.runs === d.plan.runs))!.o, s); }}>Next seed</button>
      </div>
      <div className="sim-row">
        <label className="small">Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} style={{ width: 80 }} /></label>
        <label className="small">Speed{' '}
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>{SPEEDS.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="small"><input type="checkbox" checked={teamKits} onChange={(e) => setTeamKits(e.target.checked)} /> Team kits (red v yellow)</label>
        {d && <span className="small muted">result at {d.timeline.resultAt} ms · {d.plan.label.text} {d.plan.label.sub ?? ''}</span>}
        {info && <span className="small muted">{info.fps} fps · {info.calls} draw calls · {Math.round(info.triangles / 1000)}k triangles</span>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Lab />);
