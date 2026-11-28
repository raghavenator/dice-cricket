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
  /** Optional fixed [x, y] tilt (deg), so the die always rests at an angle showing its top and a side. */
  tilt?: [number, number];
}

export function Die({ value, rollId, duration, size = 92, tone = 'normal', dim, tilt }: Props) {
  // A tilted die starts squarely on its face, and the tilt shows it at an angle.
  const [rot, setRot] = useState<[number, number]>(() => (tilt ? FACE_ROT[value ?? 1] : [-14, 18]));
  const [animate, setAnimate] = useState(false);
  const rotRef = useRef(rot);
  rotRef.current = rot;

  useEffect(() => {
    if (value == null || rollId === 0) return;
    const [x, y] = FACE_ROT[value];
    setAnimate(false);
    if (duration <= 0) {
      setRot([x, y]);
      return;
    }
    // Snap to the same orientation within 0–360° before spinning, so angles never grow without bound;
    // huge angles make Chrome draw stray slivers of edge-on faces mid-spin.
    const norm = (a: number) => ((a % 360) + 360) % 360;
    setRot([norm(rotRef.current[0]), norm(rotRef.current[1])]);
    let f2 = 0;
    const f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        setAnimate(true);
        setRot([x + 720, y + 720]);
      });
    });
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
    };
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
          transform: `${tilt ? `rotateX(${tilt[0]}deg) rotateY(${tilt[1]}deg) ` : ''}rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`,
          transition: animate ? `transform ${duration}ms cubic-bezier(.17,.67,.29,1.02)` : 'none',
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
