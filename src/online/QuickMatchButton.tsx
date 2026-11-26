import { useState } from 'react';
import { goRoom } from './nav';
import { quickMatch } from './useOnlineStore';

/** Finds a stranger to play, or a room to wait in. `before` gives the name to play under. */
export function QuickMatchButton({
  label,
  disabled,
  before,
  className = 'btn btn-primary',
}: {
  label: string;
  disabled?: boolean;
  before: () => string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      goRoom(await quickMatch(before()));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <button className={className} disabled={disabled || busy} onClick={() => void find()}>{busy ? 'Finding…' : label}</button>
      {error && <p className="on-error" role="alert">{error}</p>}
    </>
  );
}
