import { useState } from 'react';
import { SettingsForm, TeamCard } from '../components/SettingsForm';
import { StoryExport } from '../components/StoryExport';
import { leagueLabel, nextFixture, pointsTable, STRUCTURE_LABEL, type Structure, type Tournament } from '../engine/tournament';
import type { MatchSettings } from '../engine/types';
import { useGame } from '../store/useGameStore';
import { Steps } from './Exhibition';

const formatLabel = (s: MatchSettings) =>
  s.format === 'test' ? `Test${s.overs ? ` (${s.overs} ov/inns)` : ''}` : `${s.overs} overs`;

export function TournamentList() {
  const tournaments = useGame((s) => s.tournaments);
  const teams = useGame((s) => s.teams);
  const go = useGame((s) => s.go);
  const del = useGame((s) => s.deleteTournament);
  const name = (id?: string) => teams.find((t) => t.id === id)?.name ?? '—';

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Tournaments</h2>
        <button className="btn btn-primary" onClick={() => go({ name: 'tourNew' })}>+ New tournament</button>
      </div>
      {tournaments.length === 0 && <p className="muted">No tournaments yet. Create one to get started.</p>}
      <div className="list">
        {tournaments.map((t) => {
          const played = t.fixtures.filter((f) => f.result).length;
          return (
            <div key={t.id} className="list-item">
              <button className="list-main" onClick={() => go({ name: 'tourHub', id: t.id })}>
                <b>{t.name}</b>
                <span className="muted small">
                  {STRUCTURE_LABEL[t.structure]}{leagueLabel(t)} · {formatLabel(t.settings)} · {t.teamIds.length} teams
                </span>
                <span className="small">
                  {t.status === 'complete' ? `🏆 Champion: ${name(t.championId)}` : `In progress: ${played} matches played`}
                </span>
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (confirm(`Delete "${t.name}" and all its match records?`)) void del(t.id);
                }}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'home' })}>← Home</button>
      </div>
    </div>
  );
}

export function TournamentNew() {
  const teams = useGame((s) => s.teams);
  const prefs = useGame((s) => s.prefs);
  const go = useGame((s) => s.go);
  const create = useGame((s) => s.newTournament);
  const count = useGame((s) => s.tournaments.length);
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState(`Dice Cup ${count + 1}`);
  const [structure, setStructure] = useState<Structure>('roundRobinPlayoffs');
  const [settings, setSettings] = useState<MatchSettings>(prefs.lastSettings);
  const [legs, setLegs] = useState<1 | 2>(1);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const fixturesEstimate = () => {
    const n = picked.length;
    if (structure === 'knockout') return n - 1;
    const rr = ((n * (n - 1)) / 2) * legs;
    return structure === 'roundRobin' ? rr : rr + (n >= 4 ? 3 : 1);
  };

  return (
    <div className="screen">
      <Steps step={step} />
      {step === 1 ? (
        <>
          <div className="title-row">
            <h2>Pick the teams ({picked.length})</h2>
            <button
              className="btn btn-sm"
              onClick={() => setPicked(picked.length === teams.length ? [] : teams.map((t) => t.id))}
            >
              {picked.length === teams.length ? 'Clear' : 'Select all'}
            </button>
          </div>
          <div className="team-grid">
            {teams.map((t) => (
              <TeamCard key={t.id} team={t} selected={picked.includes(t.id)} onClick={() => toggle(t.id)} />
            ))}
          </div>
          <div className="nav-row">
            <button className="btn btn-ghost" onClick={() => go({ name: 'tournaments' })}>← Back</button>
            <button className="btn btn-primary" disabled={picked.length < 2} onClick={() => setStep(2)}>
              Next: Settings →
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Tournament settings</h2>
          <div className="form">
            <div className="field">
              <label htmlFor="tname">Name</label>
              <input id="tname" className="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Structure</label>
              <div className="seg">
                {(Object.keys(STRUCTURE_LABEL) as Structure[]).map((s) => (
                  <button key={s} className={`seg-btn ${structure === s ? 'seg-on' : ''}`} onClick={() => setStructure(s)}>
                    {STRUCTURE_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="hint">
                {structure === 'roundRobin' && 'Everyone plays everyone once. The top of the table wins.'}
                {structure === 'roundRobinPlayoffs' &&
                  (picked.length >= 4 ? 'League stage, then semi-finals (1v4, 2v3) and a final.' : 'League stage, then a final between the top two.')}
                {structure === 'knockout' && 'Random draw, with byes if needed. Ties and draws are settled by coin toss.'}{' '}
                About {fixturesEstimate()} matches.
              </p>
            </div>
            {structure !== 'knockout' && (
              <div className="field">
                <label>League games</label>
                <div className="seg">
                  <button className={`seg-btn ${legs === 1 ? 'seg-on' : ''}`} onClick={() => setLegs(1)}>Once</button>
                  <button className={`seg-btn ${legs === 2 ? 'seg-on' : ''}`} onClick={() => setLegs(2)}>Twice (home & away)</button>
                </div>
                <p className="hint">
                  {legs === 1
                    ? 'Each team plays every other team once in the league stage.'
                    : 'Each team plays every other team twice in the league stage, once at home and once away.'}
                </p>
              </div>
            )}
          </div>
          <SettingsForm value={settings} onChange={setSettings} />
          <div className="nav-row">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Teams</button>
            <button
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={async () => {
                const id = await create(name.trim(), picked, settings, structure, legs);
                go({ name: 'tourHub', id });
              }}
            >
              Create tournament →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TournamentHub({ id }: { id: string }) {
  const t = useGame((s) => s.tournaments.find((x) => x.id === id));
  const teams = useGame((s) => s.teams);
  const live = useGame((s) => s.live);
  const go = useGame((s) => s.go);
  const startMatch = useGame((s) => s.startMatch);
  const simFixture = useGame((s) => s.simFixture);
  const [busy, setBusy] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);

  if (!t) {
    return (
      <div className="screen">
        <p>Tournament not found.</p>
        <button className="btn" onClick={() => go({ name: 'tournaments' })}>Back</button>
      </div>
    );
  }

  const team = (tid?: string) => teams.find((x) => x.id === tid);
  const tname = (tid?: string) => team(tid)?.name ?? '(deleted team)';
  const next = nextFixture(t);
  const liveHere = live && !live.match.result && live.tournamentId === t.id ? live : null;
  const missingTeam = next && (!team(next.homeId) || !team(next.awayId));

  const simAll = async () => {
    setBusy(true);
    try {
      for (let guard = 0; guard < 500; guard++) {
        const cur: Tournament | undefined = useGame.getState().tournaments.find((x) => x.id === id);
        const f = cur && nextFixture(cur);
        if (!f) break;
        await simFixture(id, f.id);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setBusy(false);
    }
  };

  const groups = new Map<string, typeof t.fixtures>();
  for (const f of t.fixtures) {
    const key = f.stage === 'group' ? f.label : f.label.replace(/ \d+$/, '') + (f.stage === 'semi' ? 's' : '');
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  return (
    <div className="screen">
      <div className="title-row">
        <div>
          <h2>{t.name}</h2>
          <p className="muted small">
            {STRUCTURE_LABEL[t.structure]}{leagueLabel(t)} · {formatLabel(t.settings)} ·{' '}
            {t.settings.bowlerMode === 'manual' ? 'manual bowlers' : 'auto bowlers'}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => go({ name: 'stats', tournamentId: t.id })}>📊 Tournament stats</button>
          <button className={`btn ${storyOpen ? 'btn-on' : ''}`} aria-expanded={storyOpen} onClick={() => setStoryOpen((o) => !o)}>📖 Story export</button>
        </div>
      </div>

      {storyOpen && <StoryExport tournament={t} />}

      {t.status === 'complete' && (
        <div className="champion" style={{ ['--team' as string]: team(t.championId)?.color ?? '#888' }}>
          🏆 Champions: <b>{tname(t.championId)}</b>
        </div>
      )}

      {next && (
        <div className="card next-card">
          <div>
            <div className="muted small">{liveHere ? 'In progress' : 'Next match'} · {next.label}</div>
            <div className="next-teams">
              {tname(next.homeId)} <span className="vs">vs</span> {tname(next.awayId)}
            </div>
          </div>
          <div className="btn-row">
            {liveHere ? (
              <button className="btn btn-primary" onClick={() => go({ name: 'match' })}>Resume match</button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  disabled={busy || !!missingTeam}
                  onClick={() => {
                    if (live && !live.match.result && !confirm('Another match is in progress. Abandon it and start this one?')) return;
                    startMatch(next.homeId, next.awayId, t.settings, { tournamentId: t.id, fixtureId: next.id });
                  }}
                >
                  🎲 Play
                </button>
                <button className="btn" disabled={busy || !!missingTeam} onClick={() => { setBusy(true); void simFixture(t.id, next.id).finally(() => setBusy(false)); }}>
                  Simulate
                </button>
                <button className="btn" disabled={busy || !!missingTeam} onClick={simAll}>
                  {busy ? 'Simulating…' : 'Sim all remaining'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {t.structure !== 'knockout' && <PointsTable t={t} tname={tname} />}

      <h3>Fixtures & results</h3>
      {[...groups.entries()].map(([label, fs]) => (
        <div key={label} className="fixture-group">
          <div className="fixture-label">{label}</div>
          {fs.map((f) => (
            <button
              key={f.id}
              className={`fixture ${f.result ? 'fixture-done' : ''} ${f.id === next?.id ? 'fixture-next' : ''}`}
              disabled={!f.matchId}
              onClick={() => f.matchId && go({ name: 'matchView', matchId: f.matchId, back: { name: 'tourHub', id: t.id } })}
            >
              <span className={f.result?.advancedId === f.homeId || f.result?.winnerId === f.homeId ? 'strong' : ''}>
                {tname(f.homeId)}
              </span>
              <span className="vs">v</span>
              <span className={f.result?.advancedId === f.awayId || f.result?.winnerId === f.awayId ? 'strong' : ''}>
                {tname(f.awayId)}
              </span>
              <span className="fixture-res muted small">{f.result ? f.result.text : 'Upcoming'}</span>
            </button>
          ))}
        </div>
      ))}
      {t.byes.length > 0 && (
        <p className="muted small">Byes in round 1: {t.byes.map(tname).join(', ')}</p>
      )}

      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'tournaments' })}>← All tournaments</button>
      </div>
    </div>
  );
}

function PointsTable({ t, tname }: { t: Tournament; tname: (id: string) => string }) {
  const rows = pointsTable(t);
  const test = t.settings.format === 'test';
  const qualify = t.structure === 'roundRobinPlayoffs' ? (t.teamIds.length >= 4 ? 4 : 2) : 0;
  return (
    <div className="card">
      <div className="card-head"><h3>Points table</h3></div>
      <div className="table-wrap">
        <table className="sc">
          <thead>
            <tr>
              <th>#</th>
              <th className="l">Team</th>
              <th>P</th>
              <th>W</th>
              <th>L</th>
              <th>{test ? 'D' : 'T'}</th>
              {test && <th>T</th>}
              <th>Pts</th>
              {!test && <th>NRR</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.teamId} className={i < qualify ? 'row-qualify' : ''}>
                <td className="num">{i + 1}</td>
                <td className="l name">{tname(r.teamId)}</td>
                <td className="num">{r.played}</td>
                <td className="num">{r.won}</td>
                <td className="num">{r.lost}</td>
                <td className="num">{test ? r.drawn : r.tied}</td>
                {test && <td className="num">{r.tied}</td>}
                <td className="num strong">{r.points}</td>
                {!test && <td className="num">{r.played ? (r.nrr >= 0 ? '+' : '') + r.nrr.toFixed(3) : '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {test ? 'Win 12 · Tie 6 · Draw 4' : 'Win 2 · Tie 1 · NRR as tiebreaker'}
        {qualify ? ` · Top ${qualify} qualify` : ''}
      </p>
    </div>
  );
}
