import { maxOversPerBowler } from '../engine/match';
import type { MatchSettings, Team } from '../engine/types';

function Seg<T extends string | number>({
  options, value, onChange,
}: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={`seg-btn ${o.v === value ? 'seg-on' : ''}`} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsForm({ value, onChange }: { value: MatchSettings; onChange: (s: MatchSettings) => void }) {
  const set = (p: Partial<MatchSettings>) => onChange({ ...value, ...p });
  const limited = value.format === 'limited';
  const presets = limited ? [1, 2, 5, 10, 20, 50] : [0, 30, 60, 90];
  const cap = maxOversPerBowler(value);

  return (
    <div className="form">
      <div className="field">
        <label>Format</label>
        <Seg
          options={[
            { v: 'limited', label: 'Limited overs (1 innings each)' },
            { v: 'test', label: 'Test match (2 innings each)' },
          ]}
          value={value.format}
          onChange={(format) => set({ format, overs: format === 'limited' ? 20 : 0 })}
        />
      </div>

      <div className="field">
        <label>{limited ? 'Overs per innings' : 'Overs limit per innings'}</label>
        <Seg
          options={presets.map((n) => ({ v: n, label: n === 0 ? 'Unlimited' : String(n) }))}
          value={presets.includes(value.overs) ? value.overs : -1}
          onChange={(overs) => set({ overs })}
        />
        <div className="inline small">
          <span className="muted">Custom:</span>
          <input
            type="number"
            min={limited ? 1 : 0}
            max={200}
            value={value.overs}
            onChange={(e) => {
              const n = Math.max(limited ? 1 : 0, Math.min(200, Math.floor(Number(e.target.value) || 0)));
              set({ overs: n });
            }}
          />
        </div>
        <p className="hint">
          {limited
            ? `Each bowler may bowl at most ${cap} over${cap === 1 ? '' : 's'}.`
            : value.overs === 0
              ? 'Innings last until all out. A result is guaranteed (win or tie).'
              : 'If the side batting last runs out of overs without being bowled out, the match is drawn.'}
        </p>
      </div>

      <div className="field">
        <label>Bowler selection</label>
        <Seg
          options={[
            { v: 'auto', label: 'Automatic' },
            { v: 'manual', label: 'I pick each over' },
          ]}
          value={value.bowlerMode}
          onChange={(bowlerMode) => set({ bowlerMode })}
        />
        <p className="hint">No bowler may bowl two overs in a row.</p>
      </div>
    </div>
  );
}

export function TeamCard({
  team, selected, badge, onClick, disabled,
}: { team: Team; selected?: boolean; badge?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      className={`team-card ${selected ? 'team-on' : ''}`}
      style={{ ['--team' as string]: team.color }}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="team-badge">{team.short}</span>
      <span className="team-name">{team.name}</span>
      {badge && <span className="team-tag">{badge}</span>}
    </button>
  );
}
