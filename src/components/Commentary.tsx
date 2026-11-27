import { useLayoutEffect, useRef, type ReactNode } from 'react';

const HIGHLIGHT: Record<string, string> = { 'FOUR!': 'comm-four', 'SIX!': 'comm-six', 'OUT!': 'comm-out' };

function highlight(text: string): ReactNode[] {
  return text.split(/(FOUR!|SIX!|OUT!)/).map((part, i) =>
    HIGHLIGHT[part] ? <span key={i} className={HIGHLIGHT[part]}>{part}</span> : part,
  );
}

/**
 * Ball-by-ball commentary, newest first. The box has a fixed height (sized in
 * CSS for about two deliveries) so it doesn't jump while the game plays; older
 * lines scroll.
 */
export function Commentary({ lines, empty }: { lines: string[]; empty: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  // Keep the newest line in view when one arrives.
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [lines]);

  return (
    <div className="commentary" ref={box}>
      {lines.length === 0 && empty}
      {lines.map((c, i) => (
        <p key={`${lines.length - i}-${c}`} className={i === 0 ? 'comm-latest' : undefined}>
          {highlight(c)}
        </p>
      ))}
    </div>
  );
}
