export type Pt = [number, number];
export type RawItem = { frame: number; points: Pt[]; color: string; pixelArea: number };
export type FramePreview = { w: number; h: number; url: string };
export type ExportItem = { id: string; frame: number; points: Pt[]; color: string };
export type ExportJson = { base: { w: number; h: number }; items: ExportItem[] };

export type BatchOptions = {
  minArea?: number;
  epsilon?: number;
  frameRegex?: string; // np. (^[^_]+)_(\d+)|([0-9]+)
  colorMap?: Record<string, string>; // #RRGGBB -> nazwa (np. M101)
};

export const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const packIdx = (x: number, y: number, w: number) => y * w + x;

export function rdp(points: Pt[], epsilon = 1.5): Pt[] {
  if (!points || points.length < 3) return points || [];
  const distPointToSeg = (a: Pt, b: Pt, c: Pt) => {
    const [x1, y1] = a, [x2, y2] = b, [x3, y3] = c;
    const A = x3 - x1, B = y3 - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    const t = lenSq ? Math.max(0, Math.min(1, dot / lenSq)) : 0;
    const xx = x1 + C * t, yy = y1 + D * t;
    const dx = x3 - xx, dy = y3 - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };
  let maxD = 0, idx = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distPointToSeg(points[0], points[points.length - 1], points[i]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

export function traceBoundary(mask: Uint8Array, w: number, h: number): Pt[] {
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const isOn = (x: number, y: number) => inB(x, y) && mask[packIdx(x, y, w)] === 1;
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = packIdx(x, y, w);
      if (mask[i] !== 1) continue;
      if (!isOn(x - 1, y) || !isOn(x + 1, y) || !isOn(x, y - 1) || !isOn(x, y + 1)) { sx = x; sy = y; break outer; }
    }
  }
  if (sx < 0) return [];
  const dir: Pt[] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  let cx = sx, cy = sy, prevDir = 4;
  const contour: Pt[] = [[cx + 0.5, cy + 0.5]];
  const limit = w * h * 8; let steps = 0;
  do {
    let start = (prevDir + 6) % 8;
    let found = -1;
    for (let k = 0; k < 8; k++) {
      const d = (start + k) % 8;
      const nx = cx + dir[d][0];
      const ny = cy + dir[d][1];
      if (isOn(nx, ny)) { found = d; break; }
    }
    if (found < 0) break;
    cx += dir[found][0]; cy += dir[found][1];
    contour.push([cx + 0.5, cy + 0.5]);
    prevDir = found; steps++;
    if (steps > limit) break;
  } while (!(cx === sx && cy === sy && contour.length > 3));
  return contour;
}

export function floodRegion(
  data: Uint8ClampedArray,
  w: number, h: number,
  sx: number, sy: number,
  targetRGB: [number, number, number],
  visited: Uint8Array
) {
  const [tr, tg, tb] = targetRGB;
  const stack = [[sx, sy]] as number[][];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const pixels: number[] = [];
  const same = (x: number, y: number) => { const i = (y * w + x) * 4; return data[i] === tr && data[i + 1] === tg && data[i + 2] === tb; };
  const mark = (x: number, y: number) => { visited[y * w + x] = 1; pixels.push(y * w + x); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  mark(sx, sy);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const cand = [[x - 1, y],[x + 1, y],[x, y - 1],[x, y + 1]];
    for (const [nx, ny] of cand) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const idx = ny * w + nx; if (visited[idx]) continue;
      if (same(nx, ny)) { mark(nx, ny); stack.push([nx, ny]); } else { visited[idx] = 2; }
    }
  }
  const bw = maxX - minX + 1; const bh = maxY - minY + 1;
  const mask = new Uint8Array(bw * bh);
  for (const p of pixels) {
    const y = Math.floor(p / w); const x = p - y * w;
    const lx = x - minX; const ly = y - minY; mask[ly * bw + lx] = 1;
  }
  return { mask, bw, bh, minX, minY, pixelCount: pixels.length };
}

export function detectBackground(data: Uint8ClampedArray) {
  return [data[0], data[1], data[2]] as [number, number, number];
}

export async function readImageData(file: File) {
  const useCIB = typeof (window as any).createImageBitmap === "function";
  if (useCIB) {
    const bmp = await (window as any).createImageBitmap(file);
    const w = bmp.width, h = bmp.height;
    const cnv = document.createElement("canvas"); cnv.width = w; cnv.height = h;
    const ctx = cnv.getContext("2d"); if (!ctx) throw new Error("2D context not available");
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const url = URL.createObjectURL(file);
    return { data: img.data, w, h, url };
  } else {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url;
    await new Promise((res) => { img.onload = () => res(null); img.onerror = () => res(null); });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cnv = document.createElement("canvas"); cnv.width = w; cnv.height = h;
    const ctx = cnv.getContext("2d"); if (!ctx) throw new Error("2D context not available");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    return { data: id.data, w, h, url };
  }
}

export function parseFrameFromName(name: string, frameRegex: string) {
  const rx = new RegExp(frameRegex);
  const m = rx.exec(name);
  if (!m) return { prefix: "", frame: 0 };
  if (m[1] && m[2]) return { prefix: m[1], frame: parseInt(m[2], 10) };
  return { prefix: "", frame: parseInt(m[3], 10) };
}

export async function processWireBatch(files: File[], opts: BatchOptions) {
  const minArea = opts.minArea ?? 40;
  const epsilon = opts.epsilon ?? 1.5;
  const frameRegex = opts.frameRegex ?? '([^_]+)_(\\d+)';
  const colorMap = opts.colorMap ?? {};

  const sums: { name: string; frame: number; count: number }[] = [];
  const raw: Record<number, RawItem[]> = {};
  const imgs: Record<number, FramePreview> = {};
  let baseW = 0, baseH = 0, seriesPrefix = "";

  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const { prefix, frame } = parseFrameFromName(f.name, frameRegex);
    if (!seriesPrefix) seriesPrefix = prefix || seriesPrefix;
    const { data, w, h, url } = await readImageData(f);
    if (i === 0) { baseW = w; baseH = h; }
    const bg = detectBackground(data);
    const visited = new Uint8Array(w * h);
    const local: RawItem[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (visited[idx]) continue;
        const i4 = idx * 4;
        const r = data[i4], g = data[i4 + 1], b = data[i4 + 2], a = data[i4 + 3];
        if (a === 0 || (r === bg[0] && g === bg[1] && b === bg[2])) { visited[idx] = 2; continue; }
        const { mask, bw, bh, minX, minY, pixelCount } = floodRegion(data, w, h, x, y, [r, g, b], visited);
        if (pixelCount < minArea) continue;
        const rawContour = traceBoundary(mask, bw, bh);
        if (!rawContour.length) continue;
        const global = rawContour.map(([px, py]) => [px + minX, py + minY]) as Pt[];
        const simp = epsilon > 0 ? rdp(global, epsilon) : global;
        const hex = rgbToHex(r, g, b);
        local.push({ frame, points: simp, color: hex, pixelArea: pixelCount });
      }
    }

    raw[frame] = local;
    imgs[frame] = { w, h, url };
    sums.push({ name: f.name, frame, count: local.length });
  }

  const frames = Object.keys(raw).map(k => parseInt(k, 10)).sort((a, b) => a - b);

  const exportItems: ExportItem[] = [];
  for (const f of frames) {
    for (const it of raw[f]) {
      const id = (colorMap[it.color] || it.color) + ";" + it.frame;
      exportItems.push({ id, frame: it.frame, points: it.points, color: it.color });
    }
  }

  const json: ExportJson = { base: { w: baseW, h: baseH }, items: exportItems };
  const uniqueColors = Array.from(new Set(exportItems.map(i => i.color)));

  return { baseW, baseH, frames, rawByFrame: raw, imagesByFrame: imgs, seriesPrefix, sums, json, uniqueColors };
}
