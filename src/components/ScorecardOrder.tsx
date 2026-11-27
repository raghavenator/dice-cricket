export type ScorecardOrder = 'charts-first' | 'tables-first';

/** "Show on top: Graphs | Tables" switch for the match screen's scorecard panel. */
export function ScorecardOrderToggle({ value, onChange }: { value: ScorecardOrder; onChange: (v: ScorecardOrder) => void }) {
  const option = (v: ScorecardOrder, label: string) => (
    <button className={`btn btn-sm${value === v ? ' btn-on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>
      {label}
    </button>
  );
  return (
    <div className="sc-order" role="group" aria-label="Scorecard layout">
      <span className="small muted">Show on top:</span>
      {option('charts-first', 'Graphs')}
      {option('tables-first', 'Tables')}
    </div>
  );
}
