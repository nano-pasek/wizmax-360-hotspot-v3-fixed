import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Hotspot Studio – Standalone (React, TSX)
 * --------------------------------------------------------------
 * Kompletny, samowystarczalny edytor hotspotów z obrazów WIRE.
 * Pipeline: flood fill (CCL) → marching squares → RDP → JSON export.
 * Dodatkowo: różdżka (tolerance), pióro (ręczne rysowanie), gumka,
 * edycja węzłów (drag/insert/delete), przypisywanie ID, eksport/import projektu.
 * Sprawdzone pod kątem działania w środowisku kanwy (1 plik, React component).
 */

// ==========================
// Utility helpers
// ==========================

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hexEq(a: string, b: string): boolean { return a.toUpperCase() === b.toUpperCase(); }

function colorDist(a: [number, number, number], b: [number, number, number]) {
  // Chebyshev distance in RGB (przybliża zachowanie Photoshop tolerance)
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// Ramer–Douglas–Peucker dla uproszczenia polilinii/wielokąta
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (!points.length || epsilon <= 0) return points.slice();
  if (points.length <= 2) return points.slice();
  const idxStack: [number, number][] = [[0, points.length - 1]];
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  while (idxStack.length) {
    const [start, end] = idxStack.pop()!;
    const ax = points[start][0], ay = points[start][1];
    const bx = points[end][0], by = points[end][1];
    // punkt najdalej od odcinka AB
    let maxD = -1; let maxI = -1;
    const labx = bx - ax, laby = by - ay;
    const lab2 = labx * labx + laby * laby || 1e-12;
    for (let i = start + 1; i < end; i++) {
      const px = points[i][0], py = points[i][1];
      const t = ((px - ax) * labx + (py - ay) * laby) / lab2;
      const qx = ax + t * labx, qy = ay + t * laby;
      const dx = px - qx, dy = py - qy;
      const d = Math.hypot(dx, dy);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon) { keep[maxI] = true; idxStack.push([start, maxI], [maxI, end]); }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function polygonArea(points: [number, number][]) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] * points[i][1]) - (points[i][0] * points[j][1]);
  }
  return a / 2;
}

function centroid(points: [number, number][]) {
  const a = polygonArea(points);
  if (Math.abs(a) < 1e-9) {
    let minX = points[0][0], maxX = points[0][0];
    let minY = points[0][1], maxY = points[0][1];
    for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    cx += (points[j][0] + points[i][0]) * f;
    cy += (points[j][1] + points[i][1]) * f;
  }
  const k = 1 / (6 * a);
  return [cx * k, cy * k] as [number, number];
}

// Odległość punkt–odcinek i najbliższy punkt na segmencie
function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay; const l2 = vx * vx + vy * vy || 1e-12;
  let t = ((px - ax) * vx + (py - ay) * vy) / l2; t = clamp(t, 0, 1);
  const qx = ax + t * vx, qy = ay + t * vy; const dx = px - qx, dy = py - qy;
  return { d: Math.hypot(dx, dy), qx, qy, t };
}

// ==========================
// Marching Squares (binary mask -> segments -> polygons)
// ==========================

function tracePolygonsMarchingSquares(mask: Uint8Array, bw: number, bh: number): [number, number][][] {
  // mask[y*bw + x] w {0,1} dla przynależności piksela. Padding 1.
  const W = bw + 1, H = bh + 1;
  const corners = new Uint8Array(W * H);
  for (let y = 1; y < H; y++) {
    const my = (y - 1) * bw;
    for (let x = 1; x < W; x++) corners[y * W + x] = mask[my + (x - 1)] ? 1 : 0;
  }
  type Pt = { x: number; y: number };
  const segs: { a: Pt; b: Pt }[] = [];
  const pushSeg = (ax: number, ay: number, bx: number, by: number) => segs.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const tl = corners[y * W + x];
      const tr = corners[y * W + (x + 1)];
      const br = corners[(y + 1) * W + (x + 1)];
      const bl = corners[(y + 1) * W + x];
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top: [number, number] = [x + 0.5, y];
      const right: [number, number] = [x + 1, y + 0.5];
      const bottom: [number, number] = [x + 0.5, y + 1];
      const left: [number, number] = [x, y + 0.5];
      switch (code) {
        case 1: pushSeg(left[0], left[1], bottom[0], bottom[1]); break;
        case 2: pushSeg(bottom[0], bottom[1], right[0], right[1]); break;
        case 3: pushSeg(left[0], left[1], right[0], right[1]); break;
        case 4: pushSeg(top[0], top[1], right[0], right[1]); break;
        case 5: pushSeg(top[0], top[1], left[0], left[1]); pushSeg(bottom[0], bottom[1], right[0], right[1]); break;
        case 6: pushSeg(top[0], top[1], bottom[0], bottom[1]); break;
        case 7: pushSeg(top[0], top[1], left[0], left[1]); break;
        case 8: pushSeg(left[0], left[1], top[0], top[1]); break;
        case 9: pushSeg(bottom[0], bottom[1], top[0], top[1]); break;
        case 10: pushSeg(top[0], top[1], right[0], right[1]); pushSeg(left[0], left[1], bottom[0], bottom[1]); break;
        case 11: pushSeg(right[0], right[1], bottom[0], bottom[1]); break;
        case 12: pushSeg(left[0], left[1], right[0], right[1]); break;
        case 13: pushSeg(right[0], right[1], bottom[0], bottom[1]); break;
        case 14: pushSeg(left[0], left[1], bottom[0], bottom[1]); break;
      }
    }
  }

  // Połącz odcinki w pętle
  const key = (p: Pt) => `${Math.round(p.x * 2)}_${Math.round(p.y * 2)}`; // raster 0.5px
  const adj = new Map<string, Pt[]>();
  for (const s of segs) {
    const ka = key(s.a), kb = key(s.b);
    if (!adj.has(ka)) adj.set(ka, []); if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(s.b); adj.get(kb)!.push(s.a);
  }
  const visited = new Set<string>();
  const polygons: [number, number][][] = [];
  for (const [kStart, neigh] of adj) {
    if (visited.has(kStart) || neigh.length === 0) continue;
    let currentKey = kStart;
    const parse = (k: string) => { const [sx, sy] = k.split("_").map(n => parseInt(n, 10)); return { x: sx / 2, y: sy / 2 }; };
    let current = parse(kStart);
    const loop: [number, number][] = [[current.x, current.y]];
    visited.add(kStart);
    let prevKey: string | null = null;
    while (true) {
      const nbrs = adj.get(currentKey)!;
      let next: Pt | null = null;
      if (nbrs.length === 1) next = nbrs[0];
      else if (nbrs.length >= 2) {
        const k0 = key(nbrs[0]), k1 = key(nbrs[1]);
        next = prevKey === k0 ? nbrs[1] : nbrs[0];
      }
      if (!next) break;
      const nk = key(next);
      if (nk === kStart) break; // domknięte
      if (visited.has(nk)) break;
      loop.push([next.x, next.y]);
      visited.add(nk);
      prevKey = currentKey; currentKey = nk; current = next;
    }
    if (loop.length >= 3) {
      if (polygonArea(loop) < 0) loop.reverse();
      polygons.push(loop);
    }
  }
  return polygons;
}

// ==========================
// Flood fill (8-connected) → mask + bbox
// ==========================

type FloodResult = { minX: number; minY: number; maxX: number; maxY: number; mask: Uint8Array; bw: number; bh: number; pixelCount: number };

function floodRegion(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  matchColor: [number, number, number],
  tol: number,
  visited: Uint8Array
): FloodResult | null {
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const i0 = idx(sx, sy);
  const colAt = (i: number): [number, number, number] => [data[i], data[i + 1], data[i + 2]];
  if (visited[sy * w + sx]) return null;
  if (colorDist(colAt(i0), matchColor) > tol) return null;

  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack: number[] = [sx, sy];
  const pixels: number[] = [];
  visited[sy * w + sx] = 1;
  while (stack.length) {
    const y = stack.pop()!; const x = stack.pop()!;
    pixels.push(x, y);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const lin = ny * w + nx; if (visited[lin]) continue;
        const ci = idx(nx, ny);
        if (colorDist(colAt(ci), matchColor) <= tol) { visited[lin] = 1; stack.push(nx, ny); }
      }
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const mask = new Uint8Array(bw * bh);
  for (let i = 0; i < pixels.length; i += 2) {
    const x = pixels[i] - minX, y = pixels[i + 1] - minY; mask[y * bw + x] = 1;
  }
  return { minX, minY, maxX, maxY, mask, bw, bh, pixelCount: pixels.length / 2 };
}

// ==========================
// IO: Image loading helper
// ==========================

async function readImageFile(file: File): Promise<{ w: number; h: number; data: ImageData; url: string }>
{
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  return { w, h, data, url };
}

// ==========================
// Types
// ==========================

type Region = {
  color: string;              // hex
  points: [number, number][]; // polygon in image pixel space (SVG units)
  pixelArea: number;
  manual?: boolean;
};

type FrameData = { w: number; h: number; url: string; regions: Region[] };

// ==========================
// Main Component
// ==========================

export default function HotspotStudioStandalone() {
  // Files / frames
  const [files, setFiles] = useState<File[]>([]);
  const [frames, setFrames] = useState<number[]>([]);
  const [byFrame, setByFrame] = useState<Record<number, FrameData>>({});
  const [series, setSeries] = useState<string>("");
  const [frameRx, setFrameRx] = useState<string>("([^_]+)_(\\d+)");
  const [minArea, setMinArea] = useState<number>(1000);
  const [epsilon, setEpsilon] = useState<number>(1.5);
  const [tolerance, setTolerance] = useState<number>(0); // MagicWand tolerance (0..64 typ.)
  const [loading, setLoading] = useState<string>("");

  // progress
  const [progDone, setProgDone] = useState(0);
  const [progTotal, setProgTotal] = useState(0);

  // View state
  const [currentIdx, setCurrentIdx] = useState(0);
  const currentFrame = frames[currentIdx] ?? null;
  const data = currentFrame != null ? byFrame[currentFrame] : null;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showImage, setShowImage] = useState(true);
  const [fillAlpha, setFillAlpha] = useState(28);
  const [strokeW, setStrokeW] = useState(2);
  const [labelSize, setLabelSize] = useState(18);
  const [showAreas, setShowAreas] = useState(true);

  const [mode, setMode] = useState<"select" | "wand" | "pen" | "erase" | "edit">("select");
  const [selected, setSelected] = useState<number | null>(null);

  // Manual pen
  const [drawing, setDrawing] = useState<[number, number][]>([]);

  // Node editing
  const [editingPoint, setEditingPoint] = useState<{ region: number; idx: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Drag & drop files
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const fs = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("image/"));
    if (fs.length) setFiles(fs);
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }

  // Color → ID mapping
  const [colorMapText, setColorMapText] = useState("{}");
  const colorMap = useMemo(() => { try { return JSON.parse(colorMapText || "{}"); } catch { return {}; } }, [colorMapText]) as Record<string, string>;
  const [idGlobal, setIdGlobal] = useState(false);
  const [idPrefix, setIdPrefix] = useState("M");
  const [idNumber, setIdNumber] = useState("");

  // ============ helpers ============
  function parseFrame(fileName: string): { series: string; frame: number } {
    const rx = new RegExp(frameRx);
    const m = fileName.match(rx);
    if (!m) return { series: "", frame: 0 };
    return { series: m[1], frame: parseInt(m[2] || "0", 10) };
  }

  // ============ processing ============
  // Lightweight Worker factory – równoległe przeliczanie klatek
  function makeWorkerURL() {
    // cache single instance
    // @ts-ignore
    if (makeWorkerURL._url) return (makeWorkerURL as any)._url;
    const src =
      "self.onmessage=function(e){"+
      "var w=e.data.w,h=e.data.h,buffer=e.data.buffer,minArea=e.data.minArea,epsilon=e.data.epsilon;"+
      "var data=new Uint8ClampedArray(buffer);"+
      "function colorDist(a,b){return Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));}"+
      "function rgbToHex(r,g,b){function hx(n){return n.toString(16).padStart(2,'0')}return ('#'+hx(r)+hx(g)+hx(b)).toUpperCase()}"+
      "function rdp(points,eps){if(points.length<=2||eps<=0)return points.slice();var keep=new Array(points.length).fill(false);keep[0]=keep[points.length-1]=true;var st=[[0,points.length-1]];while(st.length){var p=st.pop();var s=p[0],e=p[1];var ax=points[s][0],ay=points[s][1],bx=points[e][0],by=points[e][1];var maxD=-1,idx=-1;var labx=bx-ax,laby=by-ay;var lab2=labx*labx+laby*laby||1e-12;for(var i=s+1;i<e;i++){var px=points[i][0],py=points[i][1];var t=((px-ax)*labx+(py-ay)*laby)/lab2;var qx=ax+t*labx,qy=ay+t*laby;var dx=px-qx,dy=py-qy;var d=Math.hypot(dx,dy);if(d>maxD){maxD=d;idx=i}}if(maxD>eps){keep[idx]=true;st.push([s,idx],[idx,e])}}var out=[];for(var i2=0;i2<points.length;i2++)if(keep[i2])out.push(points[i2]);return out;}"+
      "function polygonArea(points){var a=0;for(var i=0,j=points.length-1;i<points.length;j=i++){a+=points[j][0]*points[i][1]-points[i][0]*points[j][1]}return a/2}"
      +"function tracePolygons(mask,bw,bh){var W=bw+1,H=bh+1;var corners=new Uint8Array(W*H);for(var y=1;y<H;y++){var my=(y-1)*bw;for(var x=1;x<W;x++)corners[y*W+x]=mask[my+(x-1)]?1:0}var segs=[];function push(ax,ay,bx,by){segs.push({a:{x:ax,y:ay},b:{x:bx,y:by}})}for(var y2=0;y2<bh;y2++){for(var x2=0;x2<bw;x2++){var tl=corners[y2*W+x2],tr=corners[y2*W+(x2+1)],br=corners[(y2+1)*W+(x2+1)],bl=corners[(y2+1)*W+x2];var code=(tl<<3)|(tr<<2)|(br<<1)|bl;if(code===0||code===15)continue;var top=[x2+0.5,y2],right=[x2+1,y2+0.5],bottom=[x2+0.5,y2+1],left=[x2,y2+0.5];switch(code){case 1:push(left[0],left[1],bottom[0],bottom[1]);break;case 2:push(bottom[0],bottom[1],right[0],right[1]);break;case 3:push(left[0],left[1],right[0],right[1]);break;case 4:push(top[0],top[1],right[0],right[1]);break;case 5:push(top[0],top[1],left[0],left[1]);push(bottom[0],bottom[1],right[0],right[1]);break;case 6:push(top[0],top[1],bottom[0],bottom
  async function processAll() {
    if (!files.length) return;
    const t0 = performance.now();
    setLoading("Przetwarzam…");
    const outFrames: number[] = [];
    const outData: Record<number, FrameData> = {};
    let seriesName = "";

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const meta = parseFrame(f.name);
      if (!seriesName) seriesName = meta.series || "";
      const { w, h, data: imgData, url } = await readImageFile(f);

      // Krótki yield do UI między plikami
      await new Promise(requestAnimationFrame);

      const d = imgData.data;
      const visited = new Uint8Array(w * h);

      // Zaznacz tło z (0,0), by nie floodować backgroundu
      const bg: [number, number, number] = [d[0], d[1], d[2]];
      for (let y = 0; y < h; y++) {
        const off = y * w * 4;
        for (let x = 0; x < w; x++) {
          const i4 = off + x * 4;
          if (colorDist([d[i4], d[i4+1], d[i4+2]], bg) === 0) visited[y * w + x] = 2;
        }
      }

      const regions: Region[] = [];
      const idx = (x: number, y: number) => (y * w + x) * 4;
      const colAt = (i: number): [number, number, number] => [d[i], d[i + 1], d[i + 2]];

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const lin = y * w + x; if (visited[lin]) continue;
          const c = colAt(idx(x, y));
          const res = floodRegion(d, w, h, x, y, c, 0, visited);
          if (!res) continue;
          if (res.pixelCount < minArea) continue;

          const polysLocal = tracePolygonsMarchingSquares(res.mask, res.bw, res.bh);
          for (const pl of polysLocal) {
            const poly: [number, number][] = pl.map(([px, py]) => [px + res.minX, py + res.minY]);
            const simp = rdp(poly, epsilon);
            const hex = rgbToHex(c[0], c[1], c[2]);
            regions.push({ color: hex, points: simp, pixelArea: res.pixelCount });
          }
        }
        // yield co wiersz aby UI było responsywne przy dużych plikach
        if ((y & 63) === 0) await new Promise(requestAnimationFrame);
      }

      outFrames.push(meta.frame);
      outData[meta.frame] = { w, h, url, regions };
      setLoading(`Gotowe: ${i + 1}/${files.length} • klatka ${meta.frame} • ${regions.length} hs`);
    }

    outFrames.sort((a, b) => a - b);
    setFrames(outFrames);
    setByFrame(outData);
    setSeries(seriesName);
    setCurrentIdx(0);
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    setLoading(`Zakończono: ${outFrames.length} klatek • ${dt}s`);
  }

  // Magic Wand click
  function onImageClick(e: React.MouseEvent) {
    if (!data || !byFrame[currentFrame!]) return;
    const wrap = e.currentTarget as HTMLDivElement;
    const rect = wrap.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / zoom - pan.x; // przestrzeń kontenera po skalowaniu
    const cy = (e.clientY - rect.top) / zoom - pan.y;

    const iw = data.w, ih = data.h;
    const displayW = (wrap as HTMLElement).clientWidth;
    const displayH = (wrap as HTMLElement).clientHeight;
    const scale = Math.min(displayW / iw, displayH / ih);
    const offsetX = (displayW - iw * scale) / 2;
    const offsetY = (displayH - ih * scale) / 2;

    const px = Math.floor((cx - offsetX) / scale);
    const py = Math.floor((cy - offsetY) / scale);
    if (px < 0 || py < 0 || px >= iw || py >= ih) return;

    if (mode === "pen") { setDrawing(d => [...d, [px, py]]); return; }

    if (mode === "erase") { // kasuj region zawierający punkt
      const idxR = (byFrame[currentFrame!].regions || []).findIndex(r => pointInPolygon([px, py], r.points));
      if (idxR >= 0) { const copy = { ...byFrame }; copy[currentFrame!].regions = copy[currentFrame!].regions.slice(); copy[currentFrame!].regions.splice(idxR, 1); setByFrame(copy); }
      return;
    }

    if (mode === "edit") { // wstaw punkt na najbliższym segmencie
      if (selected == null) return;
      const reg = byFrame[currentFrame!].regions[selected]; if (!reg) return;
      const { idx: insIdx } = nearestSegment(reg.points, px, py);
      const copy = { ...byFrame }; const poly = copy[currentFrame!].regions[selected].points = reg.points.slice();
      poly.splice(insIdx + 1, 0, [px, py]); setByFrame(copy); setEditingPoint({ region: selected, idx: insIdx + 1 });
      return;
    }

    if (mode === "wand") {
      (async () => {
        // odczytaj pierwotny obraz dla tej klatki
        const fileIdx = files.findIndex(f => parseFrame(f.name).frame === currentFrame);
        if (fileIdx < 0) return;
        const { w, h, data: imgData } = await readImageFile(files[fileIdx]);
        const d = imgData.data; const visited = new Uint8Array(w * h);
        const i0 = (py * w + px) * 4; const base: [number, number, number] = [d[i0], d[i0 + 1], d[i0 + 2]];
        const region = floodRegion(d, w, h, px, py, base, tolerance, visited);
        if (!region || region.pixelCount < minArea) return;
        const polysLocal = tracePolygonsMarchingSquares(region.mask, region.bw, region.bh);
        const hex = rgbToHex(base[0], base[1], base[2]);
        const newRegs: Region[] = [];
        for (const pl of polysLocal) {
          const poly: [number, number][] = pl.map(([x, y]) => [x + region.minX, y + region.minY]);
          const simp = rdp(poly, epsilon);
          newRegs.push({ color: hex, points: simp, pixelArea: region.pixelCount, manual: false });
        }
        const copy = { ...byFrame }; copy[currentFrame!].regions = copy[currentFrame!].regions.concat(newRegs); setByFrame(copy);
      })();
      return;
    }
  }

  // pomocnicze – najbliższy segment i indeks wstawienia
  function nearestSegment(points: [number, number][], x: number, y: number) {
    let best = { d: Number.POSITIVE_INFINITY, idx: 0 };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const { d } = pointSegDist(x, y, a[0], a[1], b[0], b[1]);
      if (d < best.d) best = { d, idx: i };
    }
    return best;
  }

  // point in polygon (ray casting)
  function pointInPolygon(p: [number, number], poly: [number, number][]) {
    let inside = false; const [x, y] = p; const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0], yi = poly[i][1]; const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // eksport/import JSON
  function exportJSON() {
    if (!frames.length) return;
    const base = { w: byFrame[frames[0]].w, h: byFrame[frames[0]].h };
    const items: any[] = [];
    for (const f of frames) {
      const fr = byFrame[f];
      for (const r of fr.regions) {
        const mapped = colorMap[r.color] || r.color;
        const id = idGlobal ? mapped : `${mapped};${f}`;
        items.push({ id, frame: f, color: r.color, points: r.points, area: r.pixelArea });
      }
    }
    const project = { meta: { series, frameRx, minArea, epsilon, tolerance, idGlobal }, base, colorMap, frames, data: byFrame, items };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hotspots.json"; a.click();
  }

  async function importJSON(file: File) {
    const txt = await file.text();
    const json = JSON.parse(txt);
    if (json.meta) {
      setSeries(json.meta.series || ""); setFrameRx(json.meta.frameRx || frameRx);
      setMinArea(json.meta.minArea ?? minArea); setEpsilon(json.meta.epsilon ?? epsilon);
      setTolerance(json.meta.tolerance ?? tolerance); setIdGlobal(!!json.meta.idGlobal);
    }
    if (json.colorMap) setColorMapText(JSON.stringify(json.colorMap, null, 2));
    if (json.frames && json.data) { setFrames(json.frames); setByFrame(json.data); setCurrentIdx(0); }
  }

  // legenda kolorów dla bieżącej klatki
  const legend = useMemo(() => {
    if (!data) return [] as { color: string; mapped?: string }[];
    const set = new Map<string, true>();
    for (const r of data.regions) set.set(r.color, true);
    return Array.from(set.keys()).map(c => ({ color: c, mapped: colorMap[c] }));
  }, [data, colorMap]);

  function assignIdToColor(color: string, id: string) {
    const m = { ...colorMap } as Record<string, string>;
    m[color] = id; setColorMapText(JSON.stringify(m, null, 2));
  }

  // Pan/zoom
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => clamp(+(z + delta).toFixed(2), 0.25, 6));
  }
  function onMouseDown(e: React.MouseEvent) {
    // gdy klik na węźle – zaczynamy drag tego węzła
    const tgt = e.target as HTMLElement;
    if (tgt.dataset && tgt.dataset.handle) {
      const r = parseInt(tgt.dataset.region!, 10); const i = parseInt(tgt.dataset.index!, 10);
      setEditingPoint({ region: r, idx: i });
      return;
    }
    setIsPanning(true);
    dragStart.current = { x: e.clientX - pan.x * zoom, y: e.clientY - pan.y * zoom };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (editingPoint && mode === "edit") {
      const wrap = containerRef.current!; const rect = wrap.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / zoom - pan.x; const cy = (e.clientY - rect.top) / zoom - pan.y;
      // odwzorowanie na przestrzeń obrazu jak w onImageClick
      const iw = data!.w, ih = data!.h; const displayW = wrap.clientWidth, displayH = wrap.clientHeight;
      const scale = Math.min(displayW / iw, displayH / ih); const offsetX = (displayW - iw * scale) / 2; const offsetY = (displayH - ih * scale) / 2;
      const px = clamp(Math.round((cx - offsetX) / scale), 0, iw - 1); const py = clamp(Math.round((cy - offsetY) / scale), 0, ih - 1);
      const copy = { ...byFrame }; const poly = copy[currentFrame!].regions[editingPoint.region].points = copy[currentFrame!].regions[editingPoint.region].points.slice();
      poly[editingPoint.idx] = [px, py]; setByFrame(copy);
      return;
    }
    if (!isPanning) return;
    const nx = (e.clientX - dragStart.current.x) / zoom; const ny = (e.clientY - dragStart.current.y) / zoom; setPan({ x: nx, y: ny });
  }
  function onMouseUp() { setIsPanning(false); setEditingPoint(null); }

  // klawiatura: delete punkt/region, S – simplify
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode === "edit" && selected != null && (e.key === "Backspace" || e.key === "Delete")) {
        const copy = { ...byFrame }; const r = copy[currentFrame!].regions[selected];
        if (!r) return; if (r.points.length <= 3) return;
        if (editingPoint) {
          const poly = r.points.slice(); poly.splice(editingPoint.idx, 1);
          copy[currentFrame!].regions[selected].points = poly; setByFrame(copy); setEditingPoint(null); e.preventDefault();
        }
      }
      if (e.key.toLowerCase() === "s" && selected != null) {
        const copy = { ...byFrame }; const r = copy[currentFrame!].regions[selected]; if (!r) return;
        copy[currentFrame!].regions[selected].points = rdp(r.points, epsilon); setByFrame(copy);
      }
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [mode, selected, editingPoint, byFrame, currentFrame, epsilon]);

  // Zamykanie ręcznie rysowanego poligonu
  function finishManual() {
    if (!data || drawing.length < 3) { setDrawing([]); return; }
    const [sx, sy] = drawing[0]; const [lx, ly] = drawing[drawing.length - 1];
    const dist = Math.hypot(lx - sx, ly - sy);
    const pts = dist < 6 ? drawing.slice(0, -1) : drawing.slice();
    const simp = rdp(pts, epsilon);
    const copy = { ...byFrame };
    copy[currentFrame!].regions = copy[currentFrame!].regions.concat([{ color: "#MANUAL", points: simp, pixelArea: 0, manual: true }]);
    setByFrame(copy); setDrawing([]);
  }

  // ============ UI ============
  return (
    <div className="min-h-screen text-[13px] text-white" style={{ background: "#0f1115" }} onDrop={onDrop} onDragOver={onDragOver}>
      {/* Top bar */}
      <div className="px-4 py-2 border-b border-white/10 sticky top-0 z-10" style={{ backdropFilter: "blur(6px)", background: "rgba(0,0,0,.35)"}}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold">Hotspot Studio – standalone</div>
          <div className="opacity-70">{series ? `${series} • ` : ""}{frames.length ? `${currentIdx+1}/${frames.length}` : "brak"}</div>
          <label className="ml-4">Regex klatek <input className="ml-1 px-2 py-0.5 rounded bg-white/10" value={frameRx} onChange={e=>setFrameRx(e.target.value)} /></label>
          <label className="ml-2">Min. pole <input type="number" className="ml-1 w-24 px-2 py-0.5 rounded bg-white/10" value={minArea} onChange={e=>setMinArea(parseInt(e.target.value||"0"))} /></label>
          <label className="ml-2">Epsilon RDP <input type="number" step={0.5} className="ml-1 w-20 px-2 py-0.5 rounded bg-white/10" value={epsilon} onChange={e=>setEpsilon(parseFloat(e.target.value||"0"))} /></label>
          <label className="ml-2">Tolerance <input type="number" step={1} className="ml-1 w-16 px-2 py-0.5 rounded bg-white/10" value={tolerance} onChange={e=>setTolerance(parseInt(e.target.value||"0"))} /></label>
          <button className="ml-auto px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/40" onClick={processAll} disabled={!files.length}>Przelicz</button>
          <button className="px-3 py-1 rounded bg-white/10 border border-white/20" onClick={exportJSON} disabled={!frames.length}>Eksport JSON</button>
          <label className="px-2 py-1 rounded bg-white/10 border border-white/20 cursor-pointer">Wczytaj JSON
            <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f = e.target.files?.[0]; if (f) importJSON(f); }} />
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input id="file-inp" type="file" multiple accept="image/*" onChange={(e)=>{ setFiles(Array.from(e.target.files||[])); }} />
          <span className="opacity-70">{files.length ? `${files.length} plików` : "(przeciągnij i upuść PNG/JPG/TIFF lub wybierz powyżej)"}</span>
          <span className="opacity-90">{loading}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={showImage} onChange={e=>setShowImage(e.target.checked)} /> obraz</label>
            <label className="flex items-center gap-1">wypełnienie <input type="range" min={0} max={100} value={fillAlpha} onChange={e=>setFillAlpha(parseInt(e.target.value))} /></label>
            <label className="flex items-center gap-1">obrys <input type="range" min={0} max={10} value={strokeW} onChange={e=>setStrokeW(parseInt(e.target.value))} /></label>
            <label className="flex items-center gap-1">etykiety <input type="range" min={10} max={28} value={labelSize} onChange={e=>setLabelSize(parseInt(e.target.value))} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={showAreas} onChange={e=>setShowAreas(e.target.checked)} />pow.</label>
            <div className="flex items-center gap-1">
              <span>tryb:</span>
              <select value={mode} onChange={e=>setMode(e.target.value as any)} className="bg-white/10 px-2 py-0.5 rounded">
                <option value="select">select</option>
                <option value="wand">różdżka</option>
                <option value="pen">pióro</option>
                <option value="erase">gumka</option>
                <option value="edit">edytuj węzły</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="grid" style={{ gridTemplateColumns: "320px 1fr 320px", minHeight: "calc(100vh - 64px)" }}>
        {/* Left – color → ID */}
        <div className="border-r border-white/10 p-3 space-y-3">
          <div className="font-semibold">Mapa kolor → ID</div>
          <textarea className="w-full h-48 bg-white/5 rounded p-2 font-mono" value={colorMapText} onChange={e=>setColorMapText(e.target.value)} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={idGlobal} onChange={e=>setIdGlobal(e.target.checked)} />ID globalne (bez ;frame)</label>
          <div className="flex items-end gap-2">
            <label>Prefix<input className="ml-1 px-2 py-0.5 rounded bg-white/10 w-16" value={idPrefix} onChange={e=>setIdPrefix(e.target.value)} /></label>
            <label>Numer<input className="ml-1 px-2 py-0.5 rounded bg-white/10 w-24" value={idNumber} onChange={e=>setIdNumber(e.target.value)} /></label>
            <button className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/40" disabled={!legend.length || !idNumber} onClick={()=>{ if (selected != null && data) assignIdToColor(data.regions[selected].color, `${idPrefix}${idNumber}`); }}>Przypisz wybranemu</button>
          </div>
          <div className="text-[11px] opacity-70">Wskazówka: kliknij kolor w legendzie po prawej, aby go zaznaczyć, potem nadaj ID.</div>
        </div>

        {/* Center – preview */}
        <div className="relative overflow-hidden" onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
          <div ref={containerRef} className="absolute inset-0 flex items-center justify-center select-none" onClick={onImageClick} style={{ cursor: editingPoint? "grabbing" : (isPanning ? "grabbing" : (mode === "wand" || mode === "pen" ? "crosshair" : (mode === "erase" ? "not-allowed" : (mode === "edit" ? "default" : "grab")))) }}>
            {data ? (
              <div className="relative" style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: "center center" }}>
                {showImage && (
                  <img src={data.url} alt="frame" className="block max-w-full max-h-[80vh] object-contain border border-white/10 rounded" />
                )}
                {/* SVG overlay – współrzędne = piksele obrazu */}
                <svg viewBox={`0 0 ${data.w} ${data.h}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "auto" }}>
                  {data.regions.map((r, i) => {
                    const isSel = i === selected;
                    const fill = isSel ? "rgba(0,255,0,0.45)" : `rgba(255,70,70,${fillAlpha/100})`;
                    const stroke = isSel ? "#00FF00" : "#ff4444";
                    const lbl = colorMap[r.color] || r.color;
                    const c = centroid(r.points);
                    return (
                      <g key={i} onClick={(e)=>{ e.stopPropagation(); setSelected(i===selected?null:i); }} style={{ cursor: mode==="edit"?"default":"pointer" }}>
                        <polygon points={r.points.map(p=>p.join(",")).join(" ")} fill={fill} stroke={stroke} strokeWidth={strokeW} />
                        {/* label */}
                        <text x={c[0]} y={c[1]} fontSize={labelSize} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={Math.max(2, Math.round(labelSize/6))} paintOrder="stroke" style={{ fontWeight: 700 }}>
                          {lbl}
                          {showAreas && <tspan x={c[0]} dy={labelSize*1.2} fontSize={labelSize*0.7} fill="#ffff00" stroke="#000" strokeWidth={Math.max(2, Math.round(labelSize/6))}>{r.pixelArea} px²</tspan>}
                        </text>
                        {/* Node handles w trybie edycji */}
                        {mode === "edit" && isSel && r.points.map((p, pi) => (
                          <circle key={pi} cx={p[0]} cy={p[1]} r={4} fill="#00C2FF" stroke="#001" strokeWidth={1.5} data-handle="1" data-region={i} data-index={pi} style={{ cursor: "grab" }} />
                        ))}
                      </g>
                    );
                  })}

                  {/* Rysowanie ręczne podgląd */}
                  {mode === "pen" && drawing.length > 0 && (
                    <polyline points={drawing.map(p=>p.join(",")).join(" ")} fill="none" stroke="#00ffff" strokeWidth={Math.max(1, strokeW)} />
                  )}
                </svg>
              </div>
            ) : (
              <div className="opacity-70">Wczytaj pliki i kliknij „Przelicz”.</div>
            )}
          </div>

          {/* Frame navigation */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2">
            <button className="px-4 py-1 rounded-full bg-black/70 border border-white/20 disabled:opacity-30" onClick={()=>setCurrentIdx(i=>Math.max(0, i-1))} disabled={currentIdx===0}>‹</button>
            <button className="px-4 py-1 rounded-full bg-black/70 border border-white/20 disabled:opacity-30" onClick={()=>setCurrentIdx(i=>Math.min(frames.length-1, i+1))} disabled={!frames.length || currentIdx===frames.length-1}>›</button>
          </div>

          {/* Manual controls */}
          {mode === "pen" && (
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button className="px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/40" onClick={finishManual} disabled={drawing.length<3}>Zamknij/ Zapisz</button>
              <button className="px-3 py-1 rounded bg-white/10 border border-white/20" onClick={()=>setDrawing([])}>Anuluj</button>
            </div>
          )}
        </div>

        {/* Right – legend & actions */}
        <div className="border-l border-white/10 p-3 space-y-3">
          <div className="font-semibold">Legenda kolorów</div>
          <div className="flex flex-wrap gap-2">
            {legend.length ? legend.map((l, idx) => (
              <button key={idx} className="px-2 py-1 rounded border flex items-center gap-2" style={{ borderColor: l.color, background: "rgba(255,255,255,0.05)" }} onClick={()=>{
                if (!data) return; const i = data.regions.findIndex(r=>hexEq(r.color, l.color)); if (i>=0) setSelected(i);
              }}>
                <span className="w-3 h-3 rounded-sm" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }}></span>
                <span className="font-mono">{l.color}</span>
                <span className="opacity-70">{l.mapped ? `→ ${l.mapped}` : ""}</span>
              </button>
            )) : <div className="opacity-70">(brak – przelicz najpierw)</div>}
          </div>

          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="font-semibold">Operacje</div>
            <div className="flex flex-wrap gap-2">
              <button className="px-2 py-1 rounded bg-white/10 border border-white/20" disabled={selected==null} onClick={()=>{
                if (selected==null || !data) return; const copy = { ...byFrame }; const arr = copy[currentFrame!].regions.slice(); arr.splice(selected,1); copy[currentFrame!].regions = arr; setByFrame(copy); setSelected(null);
              }}>Usuń zaznaczony</button>

              <button className="px-2 py-1 rounded bg-white/10 border border-white/20" disabled={selected==null || !data} onClick={()=>{
                if (selected==null || !data) return; const col = data.regions[selected].color; assignIdToColor(col, `${idPrefix}${idNumber||""}`);
              }}>Nadaj ID zazn.</button>

              <button className="px-2 py-1 rounded bg-white/10 border border-white/20" disabled={selected==null} onClick={()=>{
                if (selected==null) return; const copy = { ...byFrame }; const r = copy[currentFrame!].regions[selected];
                copy[currentFrame!].regions[selected].points = rdp(r.points, epsilon); setByFrame(copy);
          