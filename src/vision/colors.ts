// Sticker sampling from the camera and color classification.

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** A square region as fractions of the raw (unmirrored) frame's width and height. */
export interface NBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fixed guide square in the middle of a frame of the given aspect ratio (width / height). */
export function guideBox(aspect: number): NBox {
  const h = 0.46;
  const w = h / aspect;
  return { x: (1 - w) / 2, y: 0.42 - h / 2, w, h };
}

let canvas: HTMLCanvasElement | null = null;

/** Grab the current frame at reduced resolution. */
export function grabFrame(video: HTMLVideoElement, width = 240): ImageData | null {
  if (!video.videoWidth) return null;
  const h = Math.round((video.videoHeight / video.videoWidth) * width);
  canvas ??= document.createElement("canvas");
  canvas.width = width;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, width, h);
  return ctx.getImageData(0, 0, width, h);
}

/** Median color of the center patch of each of the 9 cells of `box`, row-major as seen by the camera. */
export function sampleGrid(img: ImageData, box: NBox): RGB[] {
  const x = box.x * img.width;
  const y = box.y * img.height;
  const cell = (box.w * img.width) / 3;
  const patch = Math.max(2, Math.round(cell * 0.32));
  const out: RGB[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const cx = Math.round(x + cell * (c + 0.5));
      const cy = Math.round(y + cell * (r + 0.5));
      const rs: number[] = [], gs: number[] = [], bs: number[] = [];
      for (let dy = -patch; dy <= patch; dy += 2)
        for (let dx = -patch; dx <= patch; dx += 2) {
          const px = Math.min(img.width - 1, Math.max(0, cx + dx));
          const py = Math.min(img.height - 1, Math.max(0, cy + dy));
          const k = (py * img.width + px) * 4;
          rs.push(img.data[k]);
          gs.push(img.data[k + 1]);
          bs.push(img.data[k + 2]);
        }
      out.push([median(rs), median(gs), median(bs)]);
    }
  return out;
}

function median(a: number[]): number {
  a.sort((p, q) => p - q);
  return a[a.length >> 1];
}

export function rgbToLab([r, g, b]: RGB): Lab {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** Color distance that downweights lightness, since lighting varies more than hue. */
export function labDist(a: Lab, b: Lab): number {
  const dl = (a[0] - b[0]) * 0.5;
  return Math.hypot(dl, a[1] - b[1], a[2] - b[2]);
}

/**
 * Classify all 54 scanned stickers. Centers (index 4 of each face) define the six colors;
 * stickers are assigned greedily by distance with a capacity of 9 per color, then the
 * color means are refined and the assignment repeated.
 * Returns the color index per sticker (color = index of the face whose center it matches)
 * and the refined color means for live tracking.
 */
export function classifyScan(samples: RGB[]): { colors: Uint8Array; means: Lab[] } {
  const labs = samples.map(rgbToLab);
  let means: Lab[] = [0, 1, 2, 3, 4, 5].map((f) => labs[f * 9 + 4]);
  let colors = new Uint8Array(54);
  for (let iter = 0; iter < 4; iter++) {
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < 54; i++) for (let c = 0; c < 6; c++) pairs.push([labDist(labs[i], means[c]), i, c]);
    pairs.sort((a, b) => a[0] - b[0]);
    const cap = new Array(6).fill(9);
    const assigned = new Array(54).fill(-1);
    for (let f = 0; f < 6; f++) {
      assigned[f * 9 + 4] = f;
      cap[f]--;
    }
    for (const [, i, c] of pairs) {
      if (assigned[i] >= 0 || cap[c] === 0) continue;
      assigned[i] = c;
      cap[c]--;
    }
    colors = Uint8Array.from(assigned);
    means = [0, 1, 2, 3, 4, 5].map((c) => {
      const members = labs.filter((_, i) => colors[i] === c);
      return [0, 1, 2].map((k) => members.reduce((s, m) => s + m[k], 0) / members.length) as Lab;
    });
  }
  return { colors, means };
}

/** Classify one live sample against calibrated means; -1 when unsure (e.g. a finger is covering it). */
export function classifyLive(rgb: RGB, means: Lab[]): number {
  const lab = rgbToLab(rgb);
  const d = means.map((m) => labDist(lab, m)).map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const [best, second] = d;
  if (best[0] > 28) return -1;
  if (best[0] > second[0] * 0.65) return -1;
  return best[1];
}

/** Sensible default means (for live preview before calibration). */
export const DEFAULT_MEANS: Lab[] = (
  [[235, 235, 235], [200, 30, 40], [30, 160, 70], [235, 215, 30], [245, 120, 20], [30, 80, 200]] as RGB[]
).map(rgbToLab);

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;
