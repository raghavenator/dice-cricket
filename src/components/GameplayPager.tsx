import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface PagerSection {
  id: string;
  label: string;
  content: ReactNode;
  /** The section scrolls inside itself when its content is taller than the screen (tables, graphs). */
  scroll?: boolean;
}

/** True while a media query matches (e.g. the desktop layout). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

/**
 * Full-screen sections, one per swipe / wheel notch / Page Down (CSS scroll-snap), like short-video feeds.
 * Dots on the right jump between sections; `fab` (e.g. a Roll button) floats over every section but the first.
 */
export function GameplayPager({ sections, fab }: { sections: PagerSection[]; fab?: ReactNode }) {
  const pager = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = pager.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx));
      },
      { root, threshold: 0.6 },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [sections.length]);

  const go = (i: number) => refs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="pager-wrap">
      <div ref={pager} className="pager" tabIndex={-1}>
        {sections.map((s, i) => (
          <section
            key={s.id}
            ref={(el) => (refs.current[i] = el)}
            data-idx={i}
            className={`pager-sec${s.scroll ? ' pager-sec-scroll' : ''}`}
            aria-label={s.label}
          >
            {s.content}
          </section>
        ))}
      </div>
      <nav className="pager-dots" aria-label="Sections">
        {sections.map((s, i) => (
          <button key={s.id} className="pager-dot" aria-label={s.label} aria-current={active === i} title={s.label} onClick={() => go(i)} />
        ))}
      </nav>
      {sections.length > 1 && active === 0 && (
        <button className="pager-hint" onClick={() => go(1)}>{sections[1].label} ↓</button>
      )}
      {fab && active > 0 && <div className="pager-fab">{fab}</div>}
    </div>
  );
}
