import { useState } from 'react';
import { SettingsForm, TeamCard } from '../components/SettingsForm';
import { useGame } from '../store/useGameStore';

export function ExhibitionTeams() {
  const teams = useGame((s) => s.teams);
  const [pick, setPick] = [useGame((s) => s.exPick), useGame((s) => s.setExPick)];
  const go = useGame((s) => s.go);
  const [a, b] = pick;

  const choose = (id: string) => {
    if (a === id) setPick([b, null]);
    else if (b === id) setPick([a, null]);
    else if (!a) setPick([id, b]);
    else if (!b) setPick([a, id]);
    else setPick([a, id]);
  };

  const name = (id: string | null) => teams.find((t) => t.id === id)?.name ?? '—';

  return (
    <div className="screen">
      <Steps step={1} />
      <h2>Choose two teams</h2>
      <div className="versus">
        <span className={a ? '' : 'muted'}>{name(a)}</span>
        <span className="vs">vs</span>
        <span className={b ? '' : 'muted'}>{name(b)}</span>
      </div>
      <div className="team-grid">
        {teams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            selected={t.id === a || t.id === b}
            badge={t.id === a ? 'Team 1' : t.id === b ? 'Team 2' : undefined}
            onClick={() => choose(t.id)}
          />
        ))}
      </div>
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Back</button>
        <button className="btn btn-primary" disabled={!a || !b} onClick={() => go({ name: 'exSettings' })}>
          Next: Settings →
        </button>
      </div>
    </div>
  );
}

export function ExhibitionSettings() {
  const [a, b] = useGame((s) => s.exPick);
  const teams = useGame((s) => s.teams);
  const prefs = useGame((s) => s.prefs);
  const setPrefs = useGame((s) => s.setPrefs);
  const startMatch = useGame((s) => s.startMatch);
  const go = useGame((s) => s.go);
  const [settings, setSettings] = useState(prefs.lastSettings);
  const ta = teams.find((t) => t.id === a);
  const tb = teams.find((t) => t.id === b);

  if (!ta || !tb) {
    return (
      <div className="screen">
        <p>Pick two teams first.</p>
        <button className="btn btn-primary" onClick={() => go({ name: 'exTeams' })}>Choose teams</button>
      </div>
    );
  }

  return (
    <div className="screen">
      <Steps step={2} />
      <h2>Match settings</h2>
      <div className="versus">
        <span>{ta.name}</span>
        <span className="vs">vs</span>
        <span>{tb.name}</span>
      </div>
      <SettingsForm value={settings} onChange={setSettings} />
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'exTeams' })}>← Teams</button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setPrefs({ lastSettings: settings });
            startMatch(ta.id, tb.id, settings);
          }}
        >
          Toss & start match →
        </button>
      </div>
    </div>
  );
}

export function Steps({ step, labels = ['Teams', 'Settings', 'Play'] }: { step: number; labels?: string[] }) {
  return (
    <ol className="steps">
      {labels.map((l, i) => (
        <li key={l} className={i + 1 === step ? 'step-on' : i + 1 < step ? 'step-done' : ''}>
          <span>{i + 1}</span> {l}
        </li>
      ))}
    </ol>
  );
}
