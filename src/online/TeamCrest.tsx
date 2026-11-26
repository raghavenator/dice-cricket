import { useId } from 'react';
import type { Team } from '../engine/types';

/** A placeholder crest: a shield in the team's colour with its short name. */
export function TeamCrest({ team, size = 160 }: { team: Pick<Team, 'short' | 'color'>; size?: number }) {
  const id = useId().replace(/:/g, '');
  const label = team.short.slice(0, 4).toUpperCase();
  return (
    <svg className="on-crest" width={size} height={size * 1.15} viewBox="0 0 100 115" aria-hidden>
      <defs>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <path d="M50 3 L94 16 V52 C94 80 74 100 50 112 C26 100 6 80 6 52 V16 Z" fill="#f2f4f1" />
      <path d="M50 9 L88 20 V52 C88 76 71 93 50 104 C29 93 12 76 12 52 V20 Z" fill={team.color} />
      <path d="M12 62 L88 38 V50 L12 74 Z" fill="#fff" opacity="0.22" />
      <path d="M50 9 L88 20 V52 C88 76 71 93 50 104 C29 93 12 76 12 52 V20 Z" fill={`url(#${id}-shine)`} />
      <text
        x="50"
        y="60"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="'Russo One', system-ui, sans-serif"
        fontSize={label.length > 3 ? 20 : 25}
        fill="#fff"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="0.8"
        paintOrder="stroke"
      >
        {label}
      </text>
    </svg>
  );
}
