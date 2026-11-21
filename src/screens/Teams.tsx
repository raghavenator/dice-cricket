import { useEffect, useState } from 'react';
import { TeamCard } from '../components/SettingsForm';
import { uid } from '../data/db';
import type { Team } from '../engine/types';
import { useGame } from '../store/useGameStore';

const COLORS = ['#1f6feb', '#8250df', '#d1242f', '#1a7f37', '#bf8700', '#57606a', '#0e8a83', '#c2185b', '#e36209', '#3b5bdb'];

function blankTeam(n: number): Team {
  const id = uid('t-');
  return {
    id,
    name: `New Team ${n}`,
    short: `NT${n}`.slice(0, 4),
    color: COLORS[n % COLORS.length],
    players: Array.from({ length: 11 }, (_, i) => ({ id: `${id}-${i + 1}`, name: `Player ${i + 1}`, bowler: i >= 6 })),
  };
}

export function TeamsScreen() {
  const teams = useGame((s) => s.teams);
  const tournaments = useGame((s) => s.tournaments);
  const saveTeam = useGame((s) => s.saveTeam);
  const deleteTeam = useGame((s) => s.deleteTeam);
  const restore = useGame((s) => s.restorePresets);
  const go = useGame((s) => s.go);
  const [selId, setSelId] = useState<string | null>(teams[0]?.id ?? null);
  const [draft, setDraft] = useState<Team | null>(null);
  const [saved, setSaved] = useState(false);

  const original = teams.find((x) => x.id === selId);
  useEffect(() => {
    setDraft(original ? structuredClone(original) : null);
  }, [original]);
  useEffect(() => setSaved(false), [selId]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original);
  const inActive = (id: string) => tournaments.some((t) => t.status === 'active' && t.teamIds.includes(id));

  const edit = (fn: (t: Team) => void) => {
    if (!draft) return;
    const t = structuredClone(draft);
    fn(t);
    setDraft(t);
    setSaved(false);
  };

  const move = (i: number, d: number) =>
    edit((t) => {
      const j = i + d;
      if (j < 0 || j >= t.players.length) return;
      [t.players[i], t.players[j]] = [t.players[j], t.players[i]];
    });

  const bowlers = draft?.players.filter((p) => p.bowler).length ?? 0;
  const valid = !!draft && draft.name.trim() !== '' && draft.short.trim() !== '' && draft.players.every((p) => p.name.trim() !== '');

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Teams</h2>
        <div className="btn-row">
          <button
            className="btn"
            onClick={async () => {
              const t = blankTeam(teams.length + 1);
              await saveTeam(t);
              setSelId(t.id);
            }}
          >
            + New team
          </button>
          <button className="btn btn-ghost" onClick={() => confirm('Restore the six sample teams to their original squads?') && void restore()}>
            Restore sample teams
          </button>
        </div>
      </div>

      <div className="teams-layout">
        <div className="team-list">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} selected={t.id === selId} onClick={() => {
              if (dirty && !confirm('Discard unsaved changes?')) return;
              setSelId(t.id);
            }} />
          ))}
        </div>

        {draft && (
          <div className="card team-editor">
            <div className="editor-top">
              <label className="field">
                <span>Name</span>
                <input className="text" value={draft.name} onChange={(e) => edit((t) => { t.name = e.target.value; })} />
              </label>
              <label className="field short">
                <span>Short</span>
                <input className="text" maxLength={4} value={draft.short} onChange={(e) => edit((t) => { t.short = e.target.value.toUpperCase(); })} />
              </label>
              <label className="field short">
                <span>Colour</span>
                <input type="color" value={draft.color} onChange={(e) => edit((t) => { t.color = e.target.value; })} />
              </label>
            </div>

            <p className="hint">
              Batting order runs from top to bottom. 🎯 marks a designated bowler ({bowlers} selected). Auto bowling
              uses these first. Aim for at least 5 in limited-overs games.
            </p>

            <ol className="squad">
              {draft.players.map((p, i) => (
                <li key={p.id}>
                  <span className="pos">{i + 1}</span>
                  <input className="text" value={p.name} onChange={(e) => edit((t) => { t.players[i].name = e.target.value; })} />
                  <label className={`bowl-toggle ${p.bowler ? 'on' : ''}`} title="Designated bowler">
                    <input type="checkbox" checked={p.bowler} onChange={(e) => edit((t) => { t.players[i].bowler = e.target.checked; })} />
                    🎯
                  </label>
                  <button className="btn btn-sm btn-ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn btn-sm btn-ghost" aria-label="Move down" disabled={i === 10} onClick={() => move(i, 1)}>↓</button>
                </li>
              ))}
            </ol>

            <div className="nav-row">
              <button
                className="btn btn-ghost danger"
                disabled={teams.length <= 2 || inActive(draft.id)}
                title={inActive(draft.id) ? 'Used in an active tournament' : undefined}
                onClick={async () => {
                  if (!confirm(`Delete ${draft.name}? Their past stats stay in history.`)) return;
                  await deleteTeam(draft.id);
                  setSelId(teams.find((t) => t.id !== draft.id)?.id ?? null);
                }}
              >
                Delete team
              </button>
              <span className="small muted">{saved ? 'Saved ✓' : dirty ? 'Unsaved changes' : ''}</span>
              <button
                className="btn btn-primary"
                disabled={!dirty || !valid}
                onClick={async () => {
                  await saveTeam({ ...draft, name: draft.name.trim(), short: draft.short.trim() });
                  setSaved(true);
                }}
              >
                Save team
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
      </div>
    </div>
  );
}
