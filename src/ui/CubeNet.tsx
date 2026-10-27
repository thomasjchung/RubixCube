import { COLOR_HEX } from "../cube/model";

// Net layout (in sticker units): U above F, L F R B in a row, D below F.
const FACE_ORIGIN: [number, number][] = [
  [3, 0], // U
  [6, 3], // R
  [3, 3], // F
  [3, 6], // D
  [0, 3], // L
  [9, 3], // B
];

interface Props {
  state: ArrayLike<number>;
  size?: number;
  highlight?: Set<number>;
  onSticker?: (i: number) => void;
  /** optional raw colors to draw instead of palette colors */
  rawColors?: (string | null)[];
}

export function CubeNet({ state, size = 16, highlight, onSticker, rawColors }: Props) {
  const gap = size * 0.08;
  return (
    <svg className="net" width={size * 12} height={size * 9} viewBox={`0 0 ${size * 12} ${size * 9}`}>
      {Array.from({ length: 54 }, (_, i) => {
        const f = Math.floor(i / 9);
        const r = Math.floor((i % 9) / 3);
        const c = i % 3;
        const [ox, oy] = FACE_ORIGIN[f];
        const fill = rawColors?.[i] ?? COLOR_HEX[state[i]] ?? "#444";
        return (
          <rect
            key={i}
            x={(ox + c) * size + gap}
            y={(oy + r) * size + gap}
            width={size - 2 * gap}
            height={size - 2 * gap}
            rx={size * 0.15}
            fill={fill}
            stroke={highlight?.has(i) ? "#ff2bd6" : "rgba(0,0,0,.35)"}
            strokeWidth={highlight?.has(i) ? 3 : 1}
            style={onSticker ? { cursor: "pointer" } : undefined}
            onClick={onSticker ? () => onSticker(i) : undefined}
          />
        );
      })}
    </svg>
  );
}

