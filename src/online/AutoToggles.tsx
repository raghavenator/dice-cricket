import type { AutoSettings } from './protocol';
import { useOnline } from './useOnlineStore';

const LABEL: Record<keyof AutoSettings, [string, string]> = {
  roll: ['Auto roll', 'Rolls for you when you are batting'],
  batter: ['Auto batsman', 'Sends in the next player in your batting order'],
  bowler: ['Auto bowler', 'Follows your bowling order, or chooses for you'],
};

/** On/off switches for what the game does for you. They can be changed at any time. */
export function AutoToggles({ auto, show, explain }: {
  auto: AutoSettings; show: (keyof AutoSettings)[]; explain?: boolean;
}) {
  const send = useOnline((s) => s.send);
  return (
    <div className={`on-autos ${explain ? 'on-explain' : ''}`}>
      {show.map((what) => (
        <button
          key={what}
          className={`btn ${explain ? '' : 'btn-sm'} ${auto[what] ? 'btn-on' : ''}`}
          aria-pressed={auto[what]}
          title={LABEL[what][1]}
          onClick={() => send({ t: 'setAuto', what, on: !auto[what] })}
        >
          <span>{LABEL[what][0]}: <b>{auto[what] ? 'On' : 'Off'}</b></span>
          {explain && <span className="muted small">{LABEL[what][1]}</span>}
        </button>
      ))}
    </div>
  );
}
