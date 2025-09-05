import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Hotspot Studio – Advanced (React, TSX)
 * --------------------------------------------------------------
 * – Poprawione błędy obliczeń hotspotuków
 * – Szybsze przeliczanie z WebWorkerami 
 * – Pasek postępu
 * – Uproszczenia: RDP i angle-aware (min kąt + min krawędź)
 * – Różdżka, pióro, gumka, edycja węzłów
 * – Import/eksport JSON
 * – Tolerancja kolorów (rozwiązuje problem z niebieskim)
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
  // Chebyshev distance in RGB (zbliżone do tolerance w PS)
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// RDP – uproszczenie polilinii/wielokąta
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (!points.length || epsilon <= 0) return points.slice();
  if (points.length <= 2) return points.slice();
  const stack: [number, number][] = [[0, points.length - 1]];
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = points[s][0], ay = points[s][1];
    const bx = points[e][0], by = points[e][1];
    let maxD = -1, maxI = -1;
    const vx = bx - ax, vy = by - ay; const l2 = vx*vx + vy*vy || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const px = points[i][0], py = points[i][1];
      const t = ((px - ax) * vx + (py - ay) * vy) / l2; const qx = ax + t * vx, qy = ay + t * vy;
      const dx = px - qx, dy = py - qy; const d = Math.hypot(dx, dy);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon) { keep[maxI] = true; stack.push([s, maxI], [maxI, e]); }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Angle-aware simplify (chroni narożniki i usuwa bardzo krótkie krawędzie)
function angleBetween(ax: number, ay: number, bx: number, by: number) {
  const la = Math.hypot(ax, ay) || 1e-12; const lb = Math.hypot(bx, by) || 1e-12;
  let c = (ax * bx + ay * by) / (la * lb); c = Math.max(-1, Math.min(1, c));
  return Math.acos(c); // radiany
}

function simplifyClosedPolygon(
  pts: [number, number][],
  opts: { epsilon: number; minAngle: number; minEdge: number; mode: "angle" | "rdp" | "none" }
): [number, number][] {
  if (pts.length < 4) return pts.slice();
  if (opts.mode === "none") return pts.slice();

  // zacznij od „najostrzejszego" narożnika – stabilniejsze
  let bestI = 0, bestScore = -1, n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const a1 = angleBetween(p1[0] - p0[0], p1[1] - p0[1], p2[0] - p1[0], p2[1] - p1[1]);
    const dev = Math.PI - a1; if (dev > bestScore) { bestScore = dev; bestI = i; }
  }
  const rot = pts.slice(bestI).concat(pts.slice(0, bestI));

  let simp: [number, number][];
  if (opts.mode === "rdp") {
    simp = rdp(rot.concat([rot[0]]), opts.epsilon).slice(0, -1);
  } else {
    simp = rdp(rot.concat([rot[0]]), Math.max(0.25, opts.epsilon * 0.6)).slice(0, -1);
    const keep: boolean[] = new Array(simp.length).fill(false);
    const deg = (r: number) => r * 180 / Math.PI;
    for (let i = 0; i < simp.length; i++) {
      const a = simp[(i - 1 + simp.length) % simp.length];
      const b = simp[i];
      const c = simp[(i + 1) % simp.length];
      const ang = deg(angleBetween(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]));
      const dev = 180 - ang; if (dev >= opts.minAngle) keep[i] = true; // zachowaj narożnik
    }
    const out: [number, number][] = [];
    for (let i = 0; i < simp.length; i++) {
      const p = simp[i]; const prev = out.length ? out[out.length - 1] : null;
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= opts.minEdge || keep[i]) out.push(p);
    }
    if (out.length >= 2 && Math.hypot(out[0][0]-out[out.length-1][0], out[0][1]-out[out.length-1][1]) < opts.minEdge) out.pop();
    simp = out;
  }
  if (simp.length < 3) return rot; // fallback
  return simp;
}

function polygonArea(points: [number, number][]) {
  let a = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j][0] * points[i][1]) - (points[i][0] * points[j][1]);
  return a / 2;
}

function centroid(points: [number, number][]) {
  const a = polygonArea(points);
  if (Math.abs(a) < 1e-9) {
    let minX = points[0][0], maxX = points[0][0]; let minY = points[0][1], maxY = points[0][1];
    for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return [(minX + maxX) / 2, (minY + maxY) / 2] as [number, number];
  }
  let cx = 0, cy = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const f = points[j][0] * points[i][1] - points[i][0] * points[j][1]; cx += (points[j][0] + points[i][0]) * f; cy += (points[j][1] + points[i][1]) * f; }
  const k = 1 / (6 * a); return [cx * k, cy * k] as [number, number];
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay; const l2 = vx*vx + vy*vy || 1e-12; let t = ((px - ax) * vx + (py - ay) * vy) / l2; t = clamp(t, 0, 1);
  const qx = ax + t * vx, qy = ay + t * vy; const dx = px - qx, dy = py - qy; return { d: Math.hypot(dx, dy), qx, qy, t };
}

// Opcjonalna kwantyzacja kolorów - pomaga z antyaliasingiem
function snapToGridRGB(data: Uint8ClampedArray, step = 2) {
  // zaokrąglenie kanałów do wielokrotności 'step' (2–3 najczęściej wystarcza)
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.round(data[i]   / step) * step;
    data[i+1] = Math.round(data[i+1] / step) * step;
    data[i+2] = Math.round(data[i+2] / step) * step;
  }
}

// --- RGB -> Lab (CIE76) i deltaE ---
function srgbToLinear(c: number) { c/=255; return c<=0.04045? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
function linearToXyz(r: number, g: number, b: number) {
  const x = r*0.4124 + g*0.3576 + b*0.1805;
  const y = r*0.2126 + g*0.7152 + b*0.0722;
  const z = r*0.0193 + g*0.1192 + b*0.9505;
  return {x,y,z};
}
function xyzToLab(x: number, y: number, z: number) {
  // D65
  const X=0.95047, Y=1.00000, Z=1.08883;
  let fx = x/X, fy = y/Y, fz = z/Z;
  const f = (t: number)=> t>0.008856? Math.cbrt(t) : (7.787*t + 16/116);
  fx=f(fx); fy=f(fy); fz=f(fz);
  return { L: 116*fy - 16, a: 500*(fx-fy), b: 200*(fy-fz) };
}
function rgbToLab(r: number, g: number, b: number) {
  const {x,y,z} = linearToXyz(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return xyzToLab(x,y,z);
}
function deltaE76(a: {L:number;a:number;b:number}, b: {L:number;a:number;b:number}) {
  const dL=a.L-b.L, da=a.a-b.a, db=a.b-b.b;
  return Math.hypot(dL,da,db);
}
const packRGB = (r:number,g:number,b:number)=> (r<<16)|(g<<8)|b;

// --- Prosty grupownik kolorów w Lab (centroidy rosnące) ---
class ColorGrouper {
  centers: {L:number;a:number;b:number}[] = [];
  repr: {r:number;g:number;b:number}[] = [];
  cache = new Map<number, number>();
  tol: number;
  constructor(tol:number) {
    this.tol = tol;
  }
  idForRGB(r:number,g:number,b:number) {
    const key = packRGB(r,g,b);
    const cached = this.cache.get(key); if (cached!=null) return cached;
    const lab = rgbToLab(r,g,b);
    for (let i=0;i<this.centers.length;i++){
      const d = deltaE76(lab, this.centers[i]);
      if (d<=this.tol){ this.cache.set(key,i); return i; }
    }
    // nowa grupa
    this.centers.push(lab);
    this.repr.push({r,g,b});
    const id = this.centers.length-1;
    this.cache.set(key,id);
    return id;
  }
  idAtPixel(data:Uint8ClampedArray, i:number){ return this.idForRGB(data[i],data[i+1],data[i+2]); }
  hexFor(id:number){ const c=this.repr[id]; return rgbToHex(c.r,c.g,c.b); }
}

// ==========================
// Marching Squares: mask -> polygons
// ==========================

function tracePolygonsMarchingSquares(mask: Uint8Array, bw: number, bh: number): [number, number][][] {
  const W = bw + 1, H = bh + 1; const corners = new Uint8Array(W * H);
  for (let y = 1; y < H; y++) { const my = (y - 1) * bw; for (let x = 1; x < W; x++) corners[y * W + x] = mask[my + (x - 1)] ? 1 : 0; }
  type Pt = { x: number; y: number }; const segs: { a: Pt; b: Pt }[] = [];
  const pushSeg = (ax: number, ay: number, bx: number, by: number) => segs.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const tl = corners[y * W + x], tr = corners[y * W + (x + 1)], br = corners[(y + 1) * W + (x + 1)], bl = corners[(y + 1) * W + x];
    const code = (tl << 3) | (tr << 2) | (br << 1) | bl; if (code === 0 || code === 15) continue;
    const top: [number, number] = [x + 0.5, y], right: [number, number] = [x + 1, y + 0.5], bottom: [number, number] = [x + 0.5, y + 1], left: [number, number] = [x, y + 0.5];
    switch (code) {
      case 1: pushSeg(left[0], left[1], bottom[0], bottom[1]); break; case 2: pushSeg(bottom[0], bottom[1], right[0], right[1]); break; case 3: pushSeg(left[0], left[1], right[0], right[1]); break;
      case 4: pushSeg(top[0], top[1], right[0], right[1]); break; case 5: pushSeg(top[0], top[1], left[0], left[1]); pushSeg(bottom[0], bottom[1], right[0], right[1]); break; case 6: pushSeg(top[0], top[1], bottom[0], bottom[1]); break;
      case 7: pushSeg(top[0], top[1], left[0], left[1]); break; case 8: pushSeg(left[0], left[1], top[0], top[1]); break; case 9: pushSeg(bottom[0], bottom[1], top[0], top[1]); break;
      case 10: pushSeg(top[0], top[1], right[0], right[1]); pushSeg(left[0], left[1], bottom[0], bottom[1]); break; case 11: pushSeg(right[0], right[1], bottom[0], bottom[1]); break;
      case 12: pushSeg(left[0], left[1], right[0], right[1]); break; case 13: pushSeg(right[0], right[1], bottom[0], bottom[1]); break; case 14: pushSeg(left[0], left[1], bottom[0], bottom[1]); break;
    }
  }
  const key = (p: Pt) => `${Math.round(p.x * 2)}_${Math.round(p.y * 2)}`; const adj = new Map<string, Pt[]>();
  for (const s of segs) { const ka = key(s.a), kb = key(s.b); if (!adj.has(ka)) adj.set(ka, []); if (!adj.has(kb)) adj.set(kb, []); adj.get(ka)!.push(s.b); adj.get(kb)!.push(s.a); }
  const visited = new Set<string>(); const polygons: [number, number][][] = [];
  for (const [kStart, neigh] of adj) {
    if (visited.has(kStart) || neigh.length === 0) continue; let currentKey = kStart;
    const parse = (k: string) => { const [sx, sy] = k.split("_").map(n => parseInt(n, 10)); return { x: sx / 2, y: sy / 2 }; };
    let current = parse(kStart); const loop: [number, number][] = [[current.x, current.y]]; visited.add(kStart); let prevKey: string | null = null;
    while (true) {
      const nbrs = adj.get(currentKey)!; let next: Pt | null = null;
      if (nbrs.length === 1) next = nbrs[0]; else if (nbrs.length >= 2) { const k0 = key(nbrs[0]); next = prevKey === k0 ? nbrs[1] : nbrs[0]; }
      if (!next) break; const nk = key(next); if (nk === kStart) break; if (visited.has(nk)) break; loop.push([next.x, next.y]); visited.add(nk); prevKey = currentKey; currentKey = nk; current = next;
    }
    if (loop.length >= 3) { if (polygonArea(loop) < 0) loop.reverse(); polygons.push(loop); }
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
  const idx = (x: number, y: number) => (y * w + x) * 4; const i0 = idx(sx, sy);
  const colAt = (i: number): [number, number, number] => [data[i], data[i + 1], data[i + 2]];
  if (visited[sy * w + sx]) return null; if (colorDist(colAt(i0), matchColor) > tol) return null;
  
  let minX = sx, maxX = sx, minY = sy, maxY = sy; 
  const stack: number[] = [sx, sy]; 
  const pixels: number[] = []; 
  visited[sy * w + sx] = 1;
  
  // Zabezpieczenie przed nieskończoną pętlą
  const MAX_ITERATIONS = w * h; // maksymalnie wszystkie piksele
  let iterations = 0;
  
  while (stack.length && iterations < MAX_ITERATIONS) {
    iterations++;
    const y = stack.pop()!; const x = stack.pop()!; pixels.push(x, y);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue; 
      const nx = x + dx, ny = y + dy; 
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const lin = ny * w + nx; 
      if (visited[lin]) continue; 
      const ci = idx(nx, ny);
      if (colorDist(colAt(ci), matchColor) <= tol) { 
        visited[lin] = 1; 
        stack.push(nx, ny); 
      }
    }
    
    // Loguj co 10000 iteracji
    if (iterations % 10000 === 0) {
      console.log(`⚠️ FloodRegion: ${iterations} iteracji, stack: ${stack.length}, pikseli: ${pixels.length/2}`);
    }
  }
  
  if (iterations >= MAX_ITERATIONS) {
    console.error(`❌ FloodRegion przerwany po ${MAX_ITERATIONS} iteracjach! Możliwa nieskończona pętla.`);
    return null;
  }
  
  const bw = maxX - minX + 1, bh = maxY - minY + 1; const mask = new Uint8Array(bw * bh);
  for (let i = 0; i < pixels.length; i += 2) { const x = pixels[i] - minX, y = pixels[i + 1] - minY; mask[y * bw + x] = 1; }
  return { minX, minY, maxX, maxY, mask, bw, bh, pixelCount: pixels.length / 2 };
}

function floodRegionByGroup(
  data: Uint8ClampedArray,
  w: number, h: number,
  sx: number, sy: number,
  seedGroup: number,
  grouper: ColorGrouper,
  visited: Uint8Array
): FloodResult | null {
  const idx=(x:number,y:number)=>(y*w+x)*4;
  const lin0=sy*w+sx;
  if (visited[lin0]) return null;
  if (grouper.idAtPixel(data, idx(sx,sy)) !== seedGroup) return null;

  let minX=sx, maxX=sx, minY=sy, maxY=sy;
  const stack:number[]=[sx,sy]; const pixels:number[]=[];
  visited[lin0]=1;

  while (stack.length){
    const y=stack.pop()!, x=stack.pop()!;
    pixels.push(x,y);
    if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++){
      if (!dx && !dy) continue;
      const nx=x+dx, ny=y+dy; if (nx<0||ny<0||nx>=w||ny>=h) continue;
      const lin=ny*w+nx; if (visited[lin]) continue;
      if (grouper.idAtPixel(data, idx(nx,ny)) === seedGroup){ visited[lin]=1; stack.push(nx,ny); }
    }
  }
  const bw=maxX-minX+1, bh=maxY-minY+1;
  const mask=new Uint8Array(bw*bh);
  for (let i=0;i<pixels.length;i+=2){
    const x=pixels[i]-minX, y=pixels[i+1]-minY; mask[y*bw+x]=1;
  }
  return {minX,minY,maxX,maxY,mask,bw,bh,pixelCount:pixels.length/2};
}

function morphClose1(mask: Uint8Array, w: number, h: number) {
  // dilate 1px
  const tmp = new Uint8Array(mask);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    if (mask[y*w+x]) continue;
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++){
      const nx=x+dx, ny=y+dy; if (nx<0||ny<0||nx>=w||ny>=h) continue;
      if (mask[ny*w+nx]) { tmp[y*w+x]=1; dy=2; break; }
    }
  }
  // erode 1px
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    if (!tmp[y*w+x]) continue;
    let keep=false;
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++){
      const nx=x+dx, ny=y+dy; if (nx<0||ny<0||nx>=w||ny>=h) continue;
      if (tmp[ny*w+nx]) { keep=true; dy=2; break; }
    }
    mask[y*w+x] = keep ? 1 : 0;
  }
}

// ==========================
// IO: Image loading helper
// ==========================

async function readImageFile(file: File): Promise<{ w: number; h: number; data: ImageData; url: string }>
{
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w = img.naturalWidth, h = img.naturalHeight; const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h); return { w, h, data, url };
}

// ==========================
// Types
// ==========================

type Region = { color: string; points: [number, number][]; pixelArea: number; manual?: boolean };

type FrameData = { w: number; h: number; url: string; regions: Region[] };

// ==========================
// (WebWorkers temporarily disabled for debugging)
// ==========================

// ==========================
// Main Component
// ==========================

export default function HotspotStudioAdvanced() {
  // Files / frames
  const [files, setFiles] = useState<File[]>([]);
  const [frames, setFrames] = useState<number[]>([]);
  const [byFrame, setByFrame] = useState<Record<number, FrameData>>({});
  const [series, setSeries] = useState<string>("");
  const [frameRx, setFrameRx] = useState<string>("([^_]+)_(\\d+)");
  const [minArea, setMinArea] = useState<number>(1000);
  const [epsilon, setEpsilon] = useState<number>(0.8);
  const [tolerance, setTolerance] = useState<number>(10); // KLUCZ: tolerancja kolorów!
  const [groupDeltaE, setGroupDeltaE] = useState<number>(10); // Grupowanie kolorów ΔE Lab
  const [loading, setLoading] = useState<string>("");
  const [minAngleDeg, setMinAngleDeg] = useState<number>(10);
  const [minEdgePx, setMinEdgePx] = useState<number>(2);
  const [simplifyMode, setSimplifyMode] = useState<"angle" | "rdp" | "none">("angle");
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

  // ============ processing (Workers pool + fallback) ============
  async function processAll() {
    if (!files.length) return;
    console.log("🚀 Rozpoczynam processAll z", files.length, "plikami");
    setLoading("Przetwarzam z tolerancją kolorów…");
    setProgTotal(files.length); setProgDone(0);

    const outFrames: number[] = [];
    const outData: Record<number, FrameData> = {};
    let seriesName = "";

    // TYMCZASOWO: używaj tylko fallback dla debugowania
    let useWorkers = false;
    let workers: Worker[] = [];
    
    console.log("🔧 Używam fallback na głównym wątku dla debugowania problemu");
    
    /*
    try {
      workerURL = makeWorkerURL();
      const poolSize = Math.min((navigator.hardwareConcurrency || 4), 4);
      workers = Array.from({ length: poolSize }, () => new Worker(workerURL));
      console.log("✅ WebWorkers utworzone:", workers.length);
    } catch (error) {
      console.warn("WebWorkers niedostępne, używam fallback na głównym wątku:", error);
      useWorkers = false;
    }
    */

    if (useWorkers && workers.length > 0) {
      // WebWorkers path
      let next = 0; let finished = 0; let terminated = 0;

      await new Promise<void>((resolve) => {
        const launch = (worker: Worker) => {
          if (next >= files.length) { worker.terminate(); terminated++; if (terminated === workers.length) resolve(); return; }
          const index = next++;
          const f = files[index];
          const meta = parseFrame(f.name);
          if (!seriesName) seriesName = meta.series || "";
          readImageFile(f).then(({ w: iw, h: ih, data: imgData, url }) => {
            const buf = imgData.data.buffer; // przekaż własność
            const handler = (ev: MessageEvent) => {
              const regions: Region[] = (ev.data && ev.data.regions) || [];
              // angle-aware simplify na głównym wątku
              const simplified = regions.map(r => ({
                ...r,
                points: simplifyClosedPolygon(r.points, { epsilon, minAngle: minAngleDeg, minEdge: minEdgePx, mode: simplifyMode })
              }));
              outFrames.push(meta.frame);
              outData[meta.frame] = { w: iw, h: ih, url, regions: simplified };
              finished++; setProgDone(finished);
              setLoading(`Gotowe: ${finished}/${files.length} • klatka ${meta.frame} • ${simplified.length} hs`);
              worker.removeEventListener('message', handler);
              launch(worker);
            };
            worker.addEventListener('message', handler);
            try { worker.postMessage({ w: iw, h: ih, buffer: buf, minArea, epsilon, tolerance }, [buf]); }
            catch {
              const copy = new Uint8ClampedArray(imgData.data); worker.postMessage({ w: iw, h: ih, buffer: copy.buffer, minArea, epsilon, tolerance }, [copy.buffer]);
            }
          });
        };
        workers.forEach(worker => launch(worker));
      });
    } else {
      // Fallback: przetwarzanie sekwencyjne na głównym wątku
      console.log("🔄 Rozpoczynam fallback dla", files.length, "plików");
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        console.log(`📁 Przetwarzam plik ${i + 1}/${files.length}: ${f.name}`);
        const meta = parseFrame(f.name);
        if (!seriesName) seriesName = meta.series || "";
        
        setLoading(`Przetwarzam: ${i + 1}/${files.length} • ${f.name}`);
        
        try {
          console.log("📷 Ładuję obraz:", f.name);
          const { w: iw, h: ih, data: imgData, url } = await readImageFile(f);
          const d = imgData.data;
          console.log(`📐 Obraz załadowany: ${iw}x${ih}, dane: ${d.length} bajtów`);
          
          // Opcjonalna kwantyzacja - zmniejsza problemy z antyaliasingiem
          snapToGridRGB(d, 2);
          console.log("🔧 Zastosowano kwantyzację kolorów (step=2)");
          
          // Nowy algorytm z grupowaniem kolorów w Lab
          const visited = new Uint8Array(iw * ih);
          const bg: [number, number, number] = [d[0], d[1], d[2]];
          console.log(`🎨 Kolor tła: RGB(${bg[0]}, ${bg[1]}, ${bg[2]}), grupowanie ΔE: ${groupDeltaE}`);
          
          // przed pętlami:
          const grouper = new ColorGrouper(groupDeltaE);

          // globalne maski dla grup (po nich policzymy kontury „raz na grupę")
          const groupMasks: Uint8Array[] = []; // indeks = groupId

          // tło – jak było (zostaw 0 tolerancji/==0)
          let bgPixels = 0;
          for (let y=0;y<ih;y++){
            const off=y*iw*4;
            for (let x=0;x<iw;x++){
              const i4=off+x*4;
              if (colorDist([d[i4],d[i4+1],d[i4+2]], bg)===0) {
                visited[y*iw+x]=2;
                bgPixels++;
              }
            }
          }
          console.log(`🌅 Oznaczono ${bgPixels} pikseli tła z ${iw * ih} (${((bgPixels / (iw * ih)) * 100).toFixed(1)}%)`);

          for (let y=0;y<ih;y++){
            // Loguj postęp co 10% wysokości
            if (y % Math.max(1, Math.floor(ih / 10)) === 0) {
              console.log(`📊 Postęp grupowania: wiersz ${y}/${ih} (${((y/ih)*100).toFixed(1)}%)`);
            }
            
            for (let x=0;x<iw;x++){
              const lin=y*iw+x; if (visited[lin]) continue;

              const seedGroup = grouper.idAtPixel(d, (y*iw+x)*4);
              const res = floodRegionByGroup(d, iw, ih, x, y, seedGroup, grouper, visited);
              if (!res || res.pixelCount < minArea) continue;

              // OR-ujemy lokalną maskę do maski globalnej grupy
              if (!groupMasks[seedGroup]) groupMasks[seedGroup] = new Uint8Array(iw*ih);
              const gmask = groupMasks[seedGroup];
              for (let yy=0; yy<res.bh; yy++){
                for (let xx=0; xx<res.bw; xx++){
                  if (res.mask[yy*res.bw+xx]) gmask[(res.minY+yy)*iw + (res.minX+xx)] = 1;
                }
              }
            }
            if ((y & 63)===0) await new Promise(requestAnimationFrame);
          }

          // Na końcu: raz na grupę liczymy kontury
          const regions: Region[] = [];
          console.log(`🎯 Przetwarzanie ${groupMasks.length} grup kolorów...`);
          
          for (let gid=0; gid<groupMasks.length; gid++){
            const gmask = groupMasks[gid]; if (!gmask) continue;
            
            // Opcjonalne domknięcie 1px
            morphClose1(gmask, iw, ih);
            
            const polys = tracePolygonsMarchingSquares(gmask, iw, ih);
            for (const pl of polys){
              const simp = simplifyClosedPolygon(pl, { epsilon, minAngle: minAngleDeg, minEdge: minEdgePx, mode: simplifyMode });
              regions.push({ color: grouper.hexFor(gid), points: simp, pixelArea: 0 });
            }
          }
          
          console.log(`✅ Grupowanie zakończone: ${regions.length} regionów`);
          
          outFrames.push(meta.frame);
          outData[meta.frame] = { w: iw, h: ih, url, regions };
          setProgDone(i + 1);
          setLoading(`Gotowe: ${i + 1}/${files.length} • klatka ${meta.frame} • ${regions.length} hs (grupowanie)`);
        } catch (error) {
          console.error(`❌ Błąd przetwarzania ${f.name}:`, error);
          setLoading(`Błąd: ${f.name} - pomijam`);
        }
      }
    }

    console.log("📊 Końcowe wyniki:", {
      outFrames: outFrames.length,
      totalRegions: Object.values(outData).reduce((sum, frame) => sum + frame.regions.length, 0),
      seriesName,
      useWorkers
    });

    outFrames.sort((a, b) => a - b);
    setFrames(outFrames);
    setByFrame(outData);
    setSeries(seriesName);
    setCurrentIdx(0);
    setLoading(`Zakończono: ${outFrames.length} klatek (z tolerancją: ${tolerance}${useWorkers ? "" : " - fallback"})`);
    setProgTotal(0); setProgDone(0);
    console.log("✅ processAll zakończone pomyślnie");
  }

  // Magic Wand click & edycja
  function onImageClick(e: React.MouseEvent) {
    if (!data || !byFrame[currentFrame!]) return;
    const wrap = e.currentTarget as HTMLDivElement;
    const rect = wrap.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / zoom - pan.x;
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

    if (mode === "erase") {
      const idxR = (byFrame[currentFrame!].regions || []).findIndex(r => pointInPolygon([px, py], r.points));
      if (idxR >= 0) { const copy = { ...byFrame }; copy[currentFrame!].regions = copy[currentFrame!].regions.slice(); copy[currentFrame!].regions.splice(idxR, 1); setByFrame(copy); }
      return;
    }

    if (mode === "edit") {
      if (selected == null) return; const reg = byFrame[currentFrame!].regions[selected]; if (!reg) return;
      const { idx: insIdx } = nearestSegment(reg.points, px, py);
      const copy = { ...byFrame }; const poly = copy[currentFrame!].regions[selected].points = reg.points.slice();
      poly.splice(insIdx + 1, 0, [px, py]); setByFrame(copy); setEditingPoint({ region: selected, idx: insIdx + 1 });
      return;
    }

    if (mode === "wand") {
      (async () => {
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
          const simp = simplifyClosedPolygon(poly, { epsilon, minAngle: minAngleDeg, minEdge: minEdgePx, mode: simplifyMode });
          newRegs.push({ color: hex, points: simp, pixelArea: region.pixelCount, manual: false });
        }
        const copy = { ...byFrame }; copy[currentFrame!].regions = copy[currentFrame!].regions.concat(newRegs); setByFrame(copy);
      })();
      return;
    }
  }

  function nearestSegment(points: [number, number][], x: number, y: number) {
    let best = { d: Number.POSITIVE_INFINITY, idx: 0 };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const { d } = pointSegDist(x, y, a[0], a[1], b[0], b[1]);
      if (d < best.d) best = { d, idx: i };
    }
    return best;
  }

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
    const txt = await file.text(); const json = JSON.parse(txt);
    if (json.meta) { setSeries(json.meta.series || ""); setFrameRx(json.meta.frameRx || frameRx); setMinArea(json.meta.minArea ?? minArea); setEpsilon(json.meta.epsilon ?? epsilon); setTolerance(json.meta.tolerance ?? tolerance); setIdGlobal(!!json.meta.idGlobal); }
    if (json.colorMap) setColorMapText(JSON.stringify(json.colorMap, null, 2));
    if (json.frames && json.data) { setFrames(json.frames); setByFrame(json.data); setCurrentIdx(0); }
  }

  // legenda kolorów
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

  // Pan/zoom + edycja

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1; setZoom(z => clamp(+(z + delta).toFixed(2), 0.25, 6));
  }
  function onMouseDown(e: React.MouseEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt.dataset && tgt.dataset.handle) {
      const r = parseInt(tgt.dataset.region!, 10); const i = parseInt(tgt.dataset.index!, 10);
      setEditingPoint({ region: r, idx: i }); return;
    }
    setIsPanning(true); dragStart.current = { x: e.clientX - pan.x * zoom, y: e.clientY - pan.y * zoom };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (editingPoint && mode === "edit") {
      const wrap = containerRef.current!; const rect = wrap.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / zoom - pan.x; const cy = (e.clientY - rect.top) / zoom - pan.y;
      const iw = data!.w, ih = data!.h; const displayW = wrap.clientWidth, displayH = wrap.clientHeight;
      const scale = Math.min(displayW / iw, displayH / ih); const offsetX = (displayW - iw * scale) / 2; const offsetY = (displayH - ih * scale) / 2;
      const px = clamp(Math.round((cx - offsetX) / scale), 0, iw - 1); const py = clamp(Math.round((cy - offsetY) / scale), 0, ih - 1);
      const copy = { ...byFrame }; const poly = copy[currentFrame!].regions[editingPoint.region].points = copy[currentFrame!].regions[editingPoint.region].points.slice();
      poly[editingPoint.idx] = [px, py]; setByFrame(copy); return;
    }
    if (!isPanning) return; const nx = (e.clientX - dragStart.current.x) / zoom; const ny = (e.clientY - dragStart.current.y) / zoom; setPan({ x: nx, y: ny });
  }
  function onMouseUp() { setIsPanning(false); setEditingPoint(null); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode === "edit" && selected != null && (e.key === "Backspace" || e.key === "Delete")) {
        const copy = { ...byFrame }; const r = copy[currentFrame!].regions[selected]; if (!r) return; if (r.points.length <= 3) return;
        if (editingPoint) { const poly = r.points.slice(); poly.splice(editingPoint.idx, 1); copy[currentFrame!].regions[selected].points = poly; setByFrame(copy); setEditingPoint(null); e.preventDefault(); }
      }
      if (e.key.toLowerCase() === "s" && selected != null) { const copy = { ...byFrame }; const r = copy[currentFrame!].regions[selected]; if (!r) return; copy[currentFrame!].regions[selected].points = rdp(r.points, epsilon); setByFrame(copy); }
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [mode, selected, editingPoint, byFrame, currentFrame, epsilon]);

  function finishManual() {
    if (!data || drawing.length < 3) { setDrawing([]); return; }
    const [sx, sy] = drawing[0]; const [lx, ly] = drawing[drawing.length - 1]; const dist = Math.hypot(lx - sx, ly - sy);
    const pts = dist < 6 ? drawing.slice(0, -1) : drawing.slice();
    const simp = simplifyClosedPolygon(pts, { epsilon, minAngle: minAngleDeg, minEdge: minEdgePx, mode: simplifyMode });
    const copy = { ...byFrame }; copy[currentFrame!].regions = copy[currentFrame!].regions.concat([{ color: "#MANUAL", points: simp, pixelArea: 0, manual: true }]); setByFrame(copy); setDrawing([]);
  }

  // ============ UI ============
  return (
    <div className="min-h-screen text-[13px] text-white" style={{ background: "#0f1115" }} onDrop={onDrop} onDragOver={onDragOver}>
      {/* Top bar */}
      <div className="px-4 py-2 border-b border-white/10 sticky top-0 z-10" style={{ backdropFilter: "blur(6px)", background: "rgba(0,0,0,.35)"}}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold">Hotspot Studio – Advanced</div>
          <div className="opacity-70">{series ? `${series} • ` : ""}{frames.length ? `${currentIdx+1}/${frames.length}` : "brak"}</div>
          <label className="ml-4">Regex klatek <input className="ml-1 px-2 py-0.5 rounded bg-white/10" value={frameRx} onChange={e=>setFrameRx(e.target.value)} /></label>
          <label className="ml-2">Min. pole <input type="number" className="ml-1 w-24 px-2 py-0.5 rounded bg-white/10" value={minArea} onChange={e=>setMinArea(parseInt(e.target.value||"0"))} /></label>
          <label className="ml-2">Epsilon <input type="number" step={0.2} className="ml-1 w-20 px-2 py-0.5 rounded bg-white/10" value={epsilon} onChange={e=>setEpsilon(parseFloat(e.target.value||"0"))} /></label>
          <label className="ml-2">Min. kąt° <input type="number" step={1} className="ml-1 w-20 px-2 py-0.5 rounded bg-white/10" value={minAngleDeg} onChange={e=>setMinAngleDeg(parseFloat(e.target.value||"0"))} /></label>
          <label className="ml-2">Min. krawędź <input type="number" step={1} className="ml-1 w-24 px-2 py-0.5 rounded bg-white/10" value={minEdgePx} onChange={e=>setMinEdgePx(parseFloat(e.target.value||"0"))} /></label>
          <label className="ml-2">Simplify
            <select className="ml-1 px-2 py-0.5 rounded bg-white/10" value={simplifyMode} onChange={e=>setSimplifyMode(e.target.value as any)}>
              <option value="angle">Angle-aware</option>
              <option value="rdp">RDP</option>
              <option value="none">Off</option>
            </select>
          </label>
          <label className="ml-2 text-yellow-400 font-semibold">Tolerancja <input type="number" step={1} className="ml-1 w-16 px-2 py-0.5 rounded bg-white/10" value={tolerance} onChange={e=>setTolerance(parseInt(e.target.value||"0"))} /></label>
          <label className="ml-2">
            Grupuj ΔE
            <input
              type="number"
              step={1}
              className="ml-1 w-16 px-2 py-0.5 rounded bg-white/10"
              value={groupDeltaE}
              onChange={(e) => setGroupDeltaE(parseInt(e.target.value || "0", 10))}
            />
          </label>
          <button className="ml-auto px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/40" onClick={processAll} disabled={!files.length}>Przelicz z tolerancją</button>
          <button className="px-3 py-1 rounded bg-white/10 border border-white/20" onClick={exportJSON} disabled={!frames.length}>Eksport JSON</button>
          <label className="px-2 py-1 rounded bg-white/10 border border-white/20 cursor-pointer">Wczytaj JSON
            <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f = e.target.files?.[0]; if (f) importJSON(f); }} />
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input id="file-inp" type="file" multiple accept="image/*" onChange={(e)=>{ setFiles(Array.from(e.target.files||[])); }} />
          <span className="opacity-70">{files.length ? `${files.length} plików` : "(przeciągnij i upuść PNG/JPG/TIFF lub wybierz powyżej)"}</span>
          <span className="opacity-90">{loading}</span>
          {progTotal > 0 && (
            <div className="ml-2 w-48 h-2 rounded bg-white/10 overflow-hidden">
              <div className="h-2 bg-emerald-500" style={{ width: `${Math.round((progDone / Math.max(1, progTotal)) * 100)}%` }} />
            </div>
          )}
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
          <div className="mt-4 p-2 bg-green-500/10 border border-green-400/30 rounded">
            <div className="text-green-400 text-[12px] font-semibold">Nowe: Grupowanie kolorów ΔE Lab!</div>
            <div className="text-[11px] opacity-80 mt-1">Auto-przeliczanie grupuje podobne kolory (ΔE={groupDeltaE}) w przestrzeni Lab, licząc kontury raz na grupę. Koniec z setkami małych regionów!</div>
            <div className="text-[11px] opacity-70 mt-1">Różdżka: nadal używa tolerancji {tolerance} dla precyzyjnego klikania.</div>
          </div>
        </div>

        {/* Center – preview */}
        <div className="relative overflow-hidden" onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
          <div ref={containerRef} className="absolute inset-0 flex items-center justify-center select-none" onClick={onImageClick} style={{ cursor: editingPoint? "grabbing" : (isPanning ? "grabbing" : (mode === "wand" || mode === "pen" ? "crosshair" : (mode === "erase" ? "not-allowed" : (mode === "edit" ? "default" : "grab")))) }}>
            {data ? (
              <div className="relative" style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: "center center" }}>
                {showImage && (
                  <img src={data.url} alt="frame" className="block max-w-full max-h-[80vh] object-contain border border-white/10 rounded" />
                )}
                {/* SVG overlay */}
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
                        <text x={c[0]} y={c[1]} fontSize={labelSize} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={Math.max(2, Math.round(labelSize/6))} paintOrder="stroke" style={{ fontWeight: 700 }}>
                          {lbl}
                          {showAreas && <tspan x={c[0]} dy={labelSize*1.2} fontSize={labelSize*0.7} fill="#ffff00" stroke="#000" strokeWidth={Math.max(2, Math.round(labelSize/6))}>{r.pixelArea} px²</tspan>}
                        </text>
                        {mode === "edit" && isSel && r.points.map((p, pi) => (
                          <circle key={pi} cx={p[0]} cy={p[1]} r={4} fill="#00C2FF" stroke="#001" strokeWidth={1.5} data-handle="1" data-region={i} data-index={pi} style={{ cursor: "grab" }} />
                        ))}
                      </g>
                    );
                  })}
                  {mode === "pen" && drawing.length > 0 && (
                    <polyline points={drawing.map(p=>p.join(",")).join(" ")} fill="none" stroke="#00ffff" strokeWidth={Math.max(1, strokeW)} />
                  )}
                </svg>
              </div>
            ) : (
              <div className="opacity-70">Wczytaj pliki i kliknij „Przelicz z tolerancją".</div>
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

          {/* Magic wand tooltip */}
          {mode === "wand" && (
            <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-2 text-[12px]">
              <div className="text-yellow-400 font-semibold">Tryb: Różdżka magiczna</div>
              <div className="opacity-80">Kliknij na kolor aby go wykryć z tolerancją {tolerance}</div>
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
              }}>Uprość (RDP)</button>
            </div>
            <div className="text-[11px] opacity-70">
              W trybie „edytuj węzły" możesz przeciągać węzły, klik na krawędzi dodaje punkt, Delete usuwa punkt.
            </div>
            <div className="text-[11px] opacity-70">
              Grupowanie ΔE {groupDeltaE}: scala podobne kolory w przestrzeni Lab. Tryb „różdżka" używa tolerancji {tolerance}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
