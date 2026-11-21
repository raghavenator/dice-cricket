import { useMemo } from 'react';
import type { MatchRecord } from '../data/db';
import { getTeam, oversLimit } from '../engine/match';
import { formatOvers, recentForm } from '../engine/stats';
import type { MatchState, Team } from '../engine/types';
import { useGame } from '../store/useGameStore';
import { HoverCard } from './PlayerHover';

const FORM_SLOTS = 5;

function teamScore(m: MatchState, teamId: string) {
  const inns = m.innings.filter((i) => i.battingTeamId === teamId);
  if (!inns.length) return 'DNB';
  return inns.map((i) => (i.wickets === 10 ? `${i.runs}` : `${i.runs}/${i.wickets}`)).join(' & ');
}

function chaseNote(m: MatchState, teamId: string) {
  const limit = oversLimit(m.settings);
  if (m.settings.format !== 'limited' || !limit) return null;
  const inn = m.innings.find((i) => i.battingTeamId === teamId && i.target);
  return inn ? `(${formatOvers(inn.legalBalls)}/${limit} ov, T:${inn.target})` : null;
}

export function ResultSummary({ record }: { record: MatchRecord }) {
  const tournaments = useGame((s) => s.tournaments);
  const m = record.match;
  const t = record.tournamentId ? tournaments.find((x) => x.id === record.tournamentId) : undefined;
  const fixture = t?.fixtures.find((f) => f.id === record.fixtureId);
  const comp = t ? `${t.name}${fixture ? ` · ${fixture.label}` : ''}` : 'Exhibition';
  const fmt = m.settings.format === 'test' ? 'Test' : `${m.settings.overs} ov`;
  return (
    <div className="rs">
      <div className="rs-head">
        <span>Result</span>
        <span>{comp} · {fmt}</span>
      </div>
      {m.order.map((id) => {
        const team = getTeam(m, id);
        const won = m.result?.kind === 'win' && m.result.winnerId === id;
        const lost = m.result?.kind === 'win' && !won;
        const note = chaseNote(m, id);
        return (
          <div key={id} className={`rs-row ${won ? 'rs-win' : ''} ${lost ? 'rs-loss' : ''}`}>
            <span className="rs-swatch" style={{ background: team.color }} />
            <span className="rs-team">{team.short}</span>
            {note && <span className="rs-note">{note}</span>}
            <span className="rs-score">{teamScore(m, id)}</span>
          </div>
        );
      })}
      <div className="rs-text">{m.result?.text}</div>
      <div className="rs-date">{new Date(record.completedAt).toLocaleDateString()}</div>
    </div>
  );
}

export function FormChips({ teamId }: { teamId: string }) {
  const history = useGame((s) => s.history);
  const form = useMemo(() => recentForm(history, teamId, FORM_SLOTS).reverse(), [history, teamId]);
  const empty = FORM_SLOTS - form.length;
  return (
    <div className="form-row" aria-label="Recent form, oldest to newest">
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="form-chip form-none" title="No match">–</span>
      ))}
      {form.map(({ letter, record }) => (
        <HoverCard key={record.id} delay={150} render={() => <ResultSummary record={record} />}>
          <span className={`form-chip form-${letter.toLowerCase()}`}>{letter}</span>
        </HoverCard>
      ))}
    </div>
  );
}

function Side({ team, label }: { team?: Team; label: 'Home' | 'Away' }) {
  return (
    <div
      className={`mu-side mu-${label.toLowerCase()} ${team ? '' : 'mu-empty'}`}
      style={team ? { ['--team' as string]: team.color } : undefined}
    >
      <span className="mu-label">{label}</span>
      {team ? (
        <>
          <span className="mu-name">{team.name}</span>
          <span className="crest">{team.short}</span>
          <span className="mu-sub">Recent form</span>
          <FormChips teamId={team.id} />
        </>
      ) : (
        <span className="mu-placeholder">Pick {label.toLowerCase()} team</span>
      )}
    </div>
  );
}

export function MatchupPanel({ home, away, onSwap }: { home?: Team; away?: Team; onSwap: () => void }) {
  return (
    <div className="matchup">
      <Side team={home} label="Home" />
      <div className="mu-mid">
        <span className="mu-v">V</span>
        <button className="btn btn-sm" onClick={onSwap} disabled={!home && !away} title="Swap home and away">⇄</button>
      </div>
      <Side team={away} label="Away" />
    </div>
  );
}
