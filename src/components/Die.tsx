import { useEffect, useRef, useState } from 'react';

/** Cube rotation [x, y] (deg) that brings each face to the front. */
const FACE_ROT: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

/** Pip positions in a 3×3 grid (0..8). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface Props {
  value: number | null;
  /** Changes on every roll so repeated values still spin. */
  rollId: number;
  duration: number;
  size?: number;
  tone?: 'normal' | 'check';
  dim?: boolean;
}

export function Die({ value, rollId, duration, size = 92, tone = 'normal', dim }: Props) {
  const [rot, setRot] = useState<[number, number]>([-14, 18]);
  const turns = useRef(0);

  useEffect(() => {
    if (value == null || rollId === 0) return;
    turns.current += 1;
    const [x, y] = FACE_ROT[value];
    const spin = duration > 0 ? 720 * turns.current : 0;
    setRot([x + spin, y + spin]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);

  return (
    <div
      className={`die-scene ${tone === 'check' ? 'die-check' : ''} ${dim ? 'die-dim' : ''}`}
      style={{ ['--size' as string]: `${size}px` }}
      role="img"
      aria-label={value ? `Die showing ${value}` : 'Die'}
    >
      <div
        className="die-cube"
        style={{
          transform: `rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`,
          transition: `transform ${duration}ms cubic-bezier(.17,.67,.29,1.02)`,
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <div key={f} className={`die-face die-face-${f}`}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={PIPS[f].includes(i) ? 'pip' : 'pip pip-off'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
