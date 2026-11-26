import { useState, type ReactNode } from 'react';
import { MatchupPanel } from '../components/MatchupPanel';
import { StoryExport } from '../components/StoryExport';
import { SettingsForm, TeamCard } from '../components/SettingsForm';
import {
  addLeg, legLabel, legStanding, nextSeriesFixture, seriesOutcome, type Leg, type Series, type TeamLabel,
} from '../engine/series';
import type { MatchSettings, Team } from '../engine/types';
import { useGame } from '../store/useGameStore';
import { Steps } from './Exhibition';

const MAX_GAMES = 25;

const legSummary = (legs: Leg[]) => legs.map((l) => `${l.games} × ${legLabel(l.settings)}`).join(' · ');

function useTeamLabel() {
  const teams = useGame((s) => s.teams);
  const team = (id?: string) => teams.find((t) => t.id === id);
  const label = (id: string): TeamLabel => {
    const t = team(id);
    return { name: t?.name ?? '(deleted team)', short: t?.short ?? '???' };
  };
  return { team, label };
}

export function SeriesList() {
  const series = useGame((s) => s.series);
  const go = useGame((s) => s.go);
  const del = useGame((s) => s.deleteSeries);
  const { label } = useTeamLabel();

  return (
    <div className="screen">
      <div className="title-row">
        <h2>Bilateral series</h2>
        <button className="btn btn-primary" onClick={() => go({ name: 'seriesNew' })}>+ New series</button>
      </div>
      {series.length === 0 && <p className="muted">No series yet. Create one to get started.</p>}
      <div className="list">
        {series.map((s) => {
          const played = s.fixtures.filter((f) => f.result).length;
          const o = seriesOutcome(s, label);
          return (
            <div key={s.id} className="list-item">
              <button className="list-main" onClick={() => go({ name: 'seriesHub', id: s.id })}>
                <b>{s.name}</b>
                <span className="muted small">
                  {label(s.homeId).short} v {label(s.awayId).short} · {legSummary(s.legs)}
                </span>
                <span className="small">
                  {o.complete ? `🏆 ${o.text}` : `In progress: ${played} of ${s.fixtures.length} played`}
                </span>
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (confirm(`Delete "${s.name}" and all its match records?`)) void del(s.id);
                }}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'localSim' })}>← Local Sim</button>
      </div>
    </div>
  );
}

export function SeriesNew() {
  const teams = useGame((s) => s.teams);
  const prefs = useGame((s) => s.prefs);
  const go = useGame((s) => s.go);
  const create = useGame((s) => s.newSeries);
  const count = useGame((s) => s.series.length);
  const [step, setStep] = useState(1);
  const [[a, b], setPick] = useState<[string | null, string | null]>([null, null]);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<MatchSettings>(prefs.lastSettings);
  const [games, setGames] = useState(3);
  const [legs, setLegs] = useState<Leg[]>([]);

  const team = (id: string | null) => teams.find((t) => t.id === id);
  const choose = (id: string) => {
    if (a === id) setPick([b, null]);
    else if (b === id) setPick([a, null]);
    else if (!a) setPick([id, b]);
    else setPick([a, id]);
  };
  const total = legs.reduce((s, l) => s + l.games, 0);
  const room = MAX_GAMES - total;
  const setLegGames = (i: number, n: number) =>
    setLegs((ls) => (n <= 0 ? ls.filter((_, j) => j !== i) : ls.map((l, j) => (j === i ? { ...l, games: n } : l))));

  return (
    <div className="screen">
      <Steps step={step} labels={['Teams', 'Schedule', 'Play']} />
      {step === 1 ? (
        <>
          <h2>Choose the host and the visitors</h2>
          <MatchupPanel home={team(a)} away={team(b)} onSwap={() => setPick([b, a])} />
          <div className="team-grid">
            {teams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                selected={t.id === a || t.id === b}
                badge={t.id === a ? 'Host' : t.id === b ? 'Visitors' : undefined}
                onClick={() => choose(t.id)}
              />
            ))}
          </div>
          <div className="nav-row">
            <button className="btn btn-ghost" onClick={() => go({ name: 'seriesList' })}>← Back</button>
            <button
              className="btn btn-primary"
              disabled={!a || !b}
              onClick={() => {
                if (!name) setName(`${team(a)!.short} v ${team(b)!.short} series ${count + 1}`);
                setStep(2);
              }}
            >
              Next: Schedule →
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Build the schedule</h2>
          <div className="form">
            <div className="field">
              <label htmlFor="sname">Name</label>
              <input id="sname" className="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Schedule · {total} {total === 1 ? 'match' : 'matches'}</h3></div>
            {legs.length === 0 ? (
              <p className="muted">Nothing scheduled yet. Choose a format below and add some matches.</p>
            ) : (
              <ol className="leg-list">
                {legs.map((l, i) => (
                  <li key={l.key} className="leg-row">
                    <span className="leg-n">{i + 1}</span>
                    <span className="leg-name">
                      <b>{l.games} × {legLabel(l.settings)}</b>
                      <span className="muted small">
                        {l.games === 1 ? 'one-off match' : `${l.games}-match series`}
                        {l.settings.format === 'test' && l.settings.overs ? ` · ${l.settings.overs} ov per innings` : ''}
                      </span>
                    </span>
                    <span className="stepper">
                      <button className="btn btn-sm" aria-label="One fewer" onClick={() => setLegGames(i, l.games - 1)}>−</button>
                      <button className="btn btn-sm" aria-label="One more" disabled={room <= 0} onClick={() => setLegGames(i, l.games + 1)}>+</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setLegGames(i, 0)}>Remove</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {legs.length > 1 && (
              <p className="hint">
                {legs.length} formats, so {legs.length} mini-series. Whoever wins more of them wins the series
                {legs.length % 2 === 0 ? ', and an equal split is a drawn series' : ''}.
              </p>
            )}
          </div>

          <h3>Add matches</h3>
          <SettingsForm value={draft} onChange={setDraft} />
          <div className="add-leg">
            <span className="inline">
              Games
              <span className="stepper">
                <button className="btn btn-sm" aria-label="Fewer games" disabled={games <= 1} onClick={() => setGames(games - 1)}>−</button>
                <b className="stepper-val">{games}</b>
                <button className="btn btn-sm" aria-label="More games" disabled={games >= 9} onClick={() => setGames(games + 1)}>+</button>
              </span>
            </span>
            <button
              className="btn btn-primary"
              disabled={games > room || (draft.format === 'limited' && draft.overs < 1)}
              onClick={() => setLegs((ls) => addLeg(ls, draft, games))}
            >
              + Add {games} × {legLabel(draft)}
            </button>
            {games > room && <span className="muted small">A series can have at most {MAX_GAMES} matches.</span>}
          </div>

          <div className="nav-row">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Teams</button>
            <button
              className="btn btn-primary"
              disabled={!total || !name.trim()}
              onClick={async () => {
                const id = await create(name.trim(), a!, b!, legs);
                go({ name: 'seriesHub', id });
              }}
            >
              Create series →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Crest({ team, trophy }: { team?: Team; trophy?: boolean }) {
  return (
    <span className="sb-crest" style={{ ['--team' as string]: team?.color ?? '#888' }}>
      {team?.short ?? '?'}
      {trophy && <span className="sb-trophy" aria-hidden>🏆</span>}
    </span>
  );
}

export function SeriesBanner({
  caption, winner, others, overall, children,
}: { caption: string; winner?: Team; others?: (Team | undefined)[]; overall?: boolean; children: ReactNode }) {
  return (
    <div
      className={`series-banner ${overall ? 'series-banner-overall' : ''} ${winner ? '' : 'series-banner-drawn'}`}
      style={winner ? { ['--team' as string]: winner.color } : undefined}
    >
      <span className="sb-crests">
        {winner ? <Crest team={winner} trophy /> : others?.map((t, i) => <Crest key={i} team={t} />)}
      </span>
      <span className="sb-body">
        <span className="sb-caption">{caption}</span>
        <span className="sb-text">{children}</span>
      </span>
    </div>
  );
}

function LegBanner({ s, legIdx }: { s: Series; legIdx: number }) {
  const { team, label } = useTeamLabel();
  const st = legStanding(s, legIdx, label);
  const w = st.winnerId ? team(st.winnerId) : undefined;
  const fmt = <b>{st.label}</b>;
  if (st.winnerId) {
    return (
      <SeriesBanner caption="Winner" winner={w}>
        <b>{label(st.winnerId).name}</b> won the{' '}
        {st.games === 1 ? <>one-off {fmt}{s.legs[legIdx].settings.format === 'test' ? '' : ' match'}</> : <>{st.games}-match {fmt} series <b>{st.score}</b></>}
      </SeriesBanner>
    );
  }
  return (
    <SeriesBanner caption={st.games === 1 ? 'Result' : 'Series drawn'} others={[team(s.homeId), team(s.awayId)]}>
      {st.games === 1 ? st.text : <>The {st.games}-match {fmt} series was drawn <b>{st.score}</b></>}
    </SeriesBanner>
  );
}

function OverallBanner({ s }: { s: Series }) {
  const { team, label } = useTeamLabel();
  const o = seriesOutcome(s, label);
  return o.winnerId ? (
    <SeriesBanner caption="Series winner" winner={team(o.winnerId)} overall>
      <b>{label(o.winnerId).name}</b> won the <b>{s.legs.length}-format</b> series <b>{o.score}</b>
    </SeriesBanner>
  ) : (
    <SeriesBanner caption="Series drawn" others={[team(s.homeId), team(s.awayId)]} overall>
      The <b>{s.legs.length}-format</b> series was drawn <b>{o.score}</b>
    </SeriesBanner>
  );
}

export function SeriesHub({ id }: { id: string }) {
  const s = useGame((st) => st.series.find((x) => x.id === id));
  const live = useGame((st) => st.live);
  const go = useGame((st) => st.go);
  const startMatch = useGame((st) => st.startMatch);
  const simFixture = useGame((st) => st.simSeriesFixture);
  const { team, label } = useTeamLabel();
  const [busy, setBusy] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);

  if (!s) {
    return (
      <div className="screen">
        <p>Series not found.</p>
        <button className="btn" onClick={() => go({ name: 'seriesList' })}>Back</button>
      </div>
    );
  }

  const next = nextSeriesFixture(s);
  const nextLeg = next ? s.legs[next.legIdx] : undefined;
  const liveHere = live && !live.match.result && live.seriesId === s.id ? live : null;
  const missingTeam = !team(s.homeId) || !team(s.awayId);
  const outcome = seriesOutcome(s, label);
  const doneLegs = s.legs.map((_, i) => i).filter((i) => legStanding(s, i, label).complete);

  const simAll = async () => {
    setBusy(true);
    try {
      for (let guard = 0; guard < 100; guard++) {
        const cur = useGame.getState().series.find((x) => x.id === id);
        const f = cur && nextSeriesFixture(cur);
        if (!f) break;
        await simFixture(id, f.id);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="title-row">
        <div>
          <h2>{s.name}</h2>
          <p className="muted small">
            {label(s.homeId).name} (host) v {label(s.awayId).name} · {legSummary(s.legs)}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => go({ name: 'stats', seriesId: s.id })}>📊 Series stats</button>
          <button className={`btn ${storyOpen ? 'btn-on' : ''}`} aria-expanded={storyOpen} onClick={() => setStoryOpen((o) => !o)}>📖 Story export</button>
        </div>
      </div>

      {storyOpen && <StoryExport series={s} />}

      {(doneLegs.length > 0 || outcome.complete) && (
        <div className="banners">
          {outcome.complete && outcome.multi && <OverallBanner s={s} />}
          {doneLegs.map((i) => <LegBanner key={i} s={s} legIdx={i} />)}
        </div>
      )}
      {!outcome.complete && outcome.multi && <p className="muted small">{outcome.text}</p>}

      {next && nextLeg && (
        <div className="card next-card">
          <div>
            <div className="muted small">
              {liveHere ? 'In progress' : 'Next match'} · Match {next.game} of {nextLeg.games} · {legLabel(nextLeg.settings)}
              {nextLeg.games > 1 ? ' series' : ''}
            </div>
            <div className="next-teams">
              {label(s.homeId).name} <span className="vs">vs</span> {label(s.awayId).name}
            </div>
          </div>
          <div className="btn-row">
            {liveHere ? (
              <button className="btn btn-primary" onClick={() => go({ name: 'match' })}>Resume match</button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  disabled={busy || missingTeam}
                  onClick={() => {
                    if (live && !live.match.result && !confirm('Another match is in progress. Abandon it and start this one?')) return;
                    startMatch(s.homeId, s.awayId, nextLeg.settings, { seriesId: s.id, fixtureId: next.id });
                  }}
                >
                  🎲 Play
                </button>
                <button className="btn" disabled={busy || missingTeam} onClick={() => { setBusy(true); void simFixture(s.id, next.id).finally(() => setBusy(false)); }}>
                  Simulate
                </button>
                <button className="btn" disabled={busy || missingTeam} onClick={simAll}>
                  {busy ? 'Simulating…' : 'Sim all remaining'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <h3>Schedule & results</h3>
      {s.legs.map((leg, li) => {
        const st = legStanding(s, li, label);
        return (
          <div key={leg.key} className="fixture-group">
            <div className="fixture-label">
              {legLabel(leg.settings)} {leg.games === 1 ? '· one-off' : `series · ${leg.games} matches`}
              <span className="leg-standing">{st.text}</span>
            </div>
            {s.fixtures.filter((f) => f.legIdx === li).map((f) => (
              <button
                key={f.id}
                className={`fixture fixture-series ${f.result ? 'fixture-done' : ''} ${f.id === next?.id ? 'fixture-next' : ''}`}
                disabled={!f.matchId}
                onClick={() => f.matchId && go({ name: 'matchView', matchId: f.matchId, back: { name: 'seriesHub', id: s.id } })}
              >
                <span className="muted small">Match {f.game}</span>
                <span className={f.result?.winnerId === s.homeId ? 'strong' : ''}>{label(s.homeId).short}</span>
                <span className="vs">v</span>
                <span className={f.result?.winnerId === s.awayId ? 'strong' : ''}>{label(s.awayId).short}</span>
                <span className="fixture-res muted small">{f.result ? f.result.text : 'Upcoming'}</span>
              </button>
            ))}
          </div>
        );
      })}

      <div className="nav-row">
        <button className="btn btn-ghost" onClick={() => go({ name: 'seriesList' })}>← All series</button>
      </div>
    </div>
  );
}
