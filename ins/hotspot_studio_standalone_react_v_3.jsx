import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Hotspot Studio – Standalone (React, TSX) V3
 * --------------------------------------------------------------
 * – Poprawione błędy (regex, cudzysłowy JSX)
 * – Szybsze przeliczanie z WebWorkerami (pool)
 * – Pasek postępu
 * – Uproszczenia: RDP i angle-aware (min kąt + min krawędź)
 * – Różdżka, pióro, gumka, edycja węzłów
 * – Import/eksport JSON
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

  // zacznij od „najostrzejszego” narożnika – stabilniejsze
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
  let minX = sx, maxX = sx, minY = sy, maxY = sy; const stack: number[] = [sx, sy]; const pixels: number[] = []; visited[sy * w + sx] = 1;
  while (stack.length) {
    const y = stack.pop()!; const x = stack.pop()!; pixels.push(x, y);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const lin = ny * w + nx; if (visited[lin]) continue; const ci = idx(nx, ny);
      if (colorDist(colAt(ci), matchColor) <= tol) { visited[lin] = 1; stack.push(nx, ny); }
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1; const mask = new Uint8Array(bw * bh);
  for (let i = 0; i < pixels.length; i += 2) { const x = pixels[i] - minX, y = pixels[i + 1] - minY; mask[y * bw + x] = 1; }
  return { minX, minY, maxX, maxY, mask, bw, bh, pixelCount: pixels.length / 2 };
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
// Worker factory (Blob URL) – równoległe przeliczanie
// ==========================

function makeWorkerURL() {
  // @ts-ignore
  if (makeWorkerURL._url) return (makeWorkerURL as any)._url as string;
  const src =
    "self.onmessage=function(e){"+
    "var w=e.data.w,h=e.data.h,buffer=e.data.buffer,minArea=e.data.minArea,epsilon=e.data.epsilon;"+
    "var data=new Uint8ClampedArray(buffer);"+
    // helpers
    "function colorDist(a,b){return Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));}"+
    "function rgbToHex(r,g,b){function hx(n){return n.toString(16).padStart(2,'0')}return ('#'+hx(r)+hx(g)+hx(b)).toUpperCase()}"+
    "function rdp(points,eps){if(points.length<=2||eps<=0)return points.slice();var keep=new Array(points.length).fill(false);keep[0]=keep[points.length-1]=true;var st=[[0,points.length-1]];while(st.length){var p=st.pop();var s=p[0],e=p[1];var ax=points[s][0],ay=points[s][1],bx=points[e][0],by=points[e][1];var maxD=-1,idx=-1;var labx=bx-ax,laby=by-ay;var lab2=labx*labx+laby*laby||1e-12;for(var i=s+1;i<e;i++){var px=points[i][0],py=points[i][1];var t=((px-ax)*labx+(py-ay)*laby)/lab2;var qx=ax+t*labx,qy=ay+t*laby;var dx=px-qx,dy=py-qy;var d=Math.hypot(dx,dy);if(d>maxD){maxD=d;idx=i}}if(maxD>eps){keep[idx]=true;st.push([s,idx],[idx,e])}}var out=[];for(var i2=0;i2<points.length;i2++)if(keep[i2])out.push(points[i2]);return out;}"+
    "function polygonArea(points){var a=0;for(var i=0,j=points.length-1;i<points.length;j=i++){a+=points[j][0]*points[i][1]-points[i][0]*points[j][1]}return a/2}"+
    // marching squares (minimal)
    "function tracePolygons(mask,bw,bh){var W=bw+1,H=bh+1;var corners=new Uint8Array(W*H);for(var y=1;y<H;y++){var my=(y-1)*bw;for(var x=1;x<W;x++)corners[y*W+x]=mask[my+(x-1)]?1:0}var segs=[];function push(ax,ay,bx,by){segs.push({a:{x:ax,y:ay},b:{x:bx,y:by}})}for(var y2=0;y2<bh;y2++){for(var x2=0;x2<bw;x2++){var tl=corners[y2*W+x2],tr=corners[y2*W+(x2+1)],br=corners[(y2+1)*W+(x2+1)],bl=corners[(y2+1)*W+x2];var code=(tl<<3)|(tr<<2)|(br<<1)|bl;if(code===0||code===15)continue;var top=[x2+0.5,y2],right=[x2+1,y2+0.5],bottom=[x2+0.5,y2+1],left=[x2,y2+0.5];switch(code){case 1:push(left[0],left[1],bottom[0],bottom[1]);break;case 2:push(bottom[0],bottom[1],right[0],right[1]);break;case 3:push(left[0],left[1],right[0],right[1]);break;case 4:push(top[0],top[1],right[0],right[1]);break;case 5:push(top[0],top[1],left[0],left[1]);push(bottom[0],bottom[1],right[0],right[1]);break;case 6:push(top[0],top[1],bottom[0],bottom[1]);break;case 7:push(top[0],top[1],left[0],left[1]);break;case 8:push(left[0],left[1],top[0],top[1]);break;case 9:push(bottom[0],bottom[1],top[0],top[1]);break;case 10:push(top[0],top[1],right[0],right[1]);push(left[0],left[1],bottom[0],bottom[1]);break;case 11:push(right[0],right[1],bottom[0],bottom[1]);break;case 12:push(left[0],left[1],right[0],right[1]);break;case 13:push(right[0],right[1],bottom[0],bottom[1]);break;case 14:push(left[0],left[1],bottom[0],bottom[1]);break;}}}var key=function(p){return Math.round(p.x*2)+'_'+Math.round(p.y*2)};var adj=new Map();for(var i3=0;i3<segs.length;i3++){var s=segs[i3];var ka=key(s.a),kb=key(s.b);if(!adj.has(ka))adj.set(ka,[]);if(!adj.has(kb))adj.set(kb,[]);adj.get(ka).push(s.b);adj.get(kb).push(s.a)}var visited=new Set();var polygons=[];for(const ent of adj){var kStart=ent[0],neigh=ent[1];if(visited.has(kStart)||neigh.length===0)continue;var currentKey=kStart;var parse=function(k){var sp=k.split('_');return {x:parseInt(sp[0],10)/2,y:parseInt(sp[1],10)/2}};var current=parse(kStart);var loop=[[current.x,current.y]];visited.add(kStart);var prevKey=null;while(true){var nbrs=adj.get(currentKey);var next=null;if(nbrs.length===1)next=nbrs[0];else if(nbrs.length>=2){var k0=key(nbrs[0]);next=prevKey===k0?nbrs[1]:nbrs[0]}if(!next)break;var nk=key(next);if(nk===kStart)break;if(visited.has(nk))break;loop.push([next.x,next.y]);visited.add(nk);prevKey=currentKey;currentKey=nk;current=next}if(loop.length>=3){if(polygonArea(loop)<0)loop.reverse();polygons.push(loop)}}return polygons;}"+
    // flood region
    "function floodRegion(data,w,h,sx,sy,color,tol,visited){var idx=function(x,y){return (y*w+x)*4};var i0=idx(sx,sy);var colAt=function(i){return [data[i],data[i+1],data[i+2]]};if(visited[sy*w+sx])return null;if(colorDist(colAt(i0),color)>tol)return null;var minX=sx,maxX=sx,minY=sy,maxY=sy;var stack=[sx,sy];var pixels=[];visited[sy*w+sx]=1;while(stack.length){var y=stack.pop(),x=stack.pop();pixels.push(x,y);if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){if(dx===0&&dy===0)continue;var nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;var lin=ny*w+nx;if(visited[lin])continue;var ci=idx(nx,ny);if(colorDist(colAt(ci),color)<=tol){visited[lin]=1;stack.push(nx,ny)}}}}var bw=maxX-minX+1,bh=maxY-minY+1;var mask=new Uint8Array(bw*bh);for(var i=0;i<pixels.length;i+=2){var xx=pixels[i]-minX,yy=pixels[i+1]-minY;mask[yy*bw+xx]=1}return {minX:minX,minY:minY,maxX:maxX,maxY:maxY,mask:mask,bw:bw,bh:bh,pixelCount:pixels.length/2}}"+
    // main per-file
    "var visited=new Uint8Array(w*h);var d=data;var bg=[d[0],d[1],d[2]];for(var y=0;y<h;y++){var off=y*w*4;for(var x=0;x<w;x++){var i4=off+x*4;if(colorDist([d[i4],d[i4+1],d[i4+2]],bg)===0)visited[y*w+x]=2}}var regions=[];var idx2=function(x,y){return (y*w+x)*4};var colAt2=function(i){return [d[i],d[i+1],d[i+2]]};for(var y2=0;y2<h;y2++){for(var x2=0;x2<w;x2++){var lin2=y2*w+x2;if(visited[lin2])continue;var c=colAt2(idx2(x2,y2));var res=floodRegion(d,w,h,x2,y2,c,0,visited);if(!res)continue;if(res.pixelCount<minArea)continue;var polysLocal=tracePolygons(res.mask,res.bw,res.bh);var hex=rgbToHex(c[0],c[1],c[2]);for(var p=0;p<polysLocal.length;p++){var pl=polysLocal[p];var poly=[];for(var k=0;k<pl.length;k++){poly.push([pl[k][0]+res.minX,pl[k][1]+res.minY])}var simp=rdp(poly,epsilon);regions.push({color:hex,points:simp,pixelArea:res.pixelCount})}}}postMessage({type:'done',regions:regions});";
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  // @ts-ignore
  makeWorkerURL._url = url; return url;
}

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
  const [epsilon, setEpsilon] = useState<number>(0.8);
  const [tolerance, setTolerance] = useState<number>(0);
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

  // ============ processing (Workers pool) ============
  async function processAll() {
    if (!files.length) return;
    setLoading("Przetwarzam…");
    setProgTotal(files.length); setProgDone(0);

    const outFrames: number[] = [];
    const outData: Record<number, FrameData> = {};
    let seriesName = "";

    const workerURL = makeWorkerURL();
    const poolSize = Math.min((navigator.hardwareConcurrency || 4), 4);
    const workers: Worker[] = Array.from({ length: poolSize }, () => new Worker(workerURL));

    let next = 0; let finished = 0; let terminated = 0;

    await new Promise<void>((resolve) => {
      const launch = (w: Worker) => {
        if (next >= files.length) { w.terminate(); terminated++; if (terminated === workers.length) resolve(); return; }
        const index = next++;
        const f = files[index];
        const meta = parseFrame(f.name);
        if (!seriesName) seriesName = meta.series || "";
        readImageFile(f).then(({ w, h, data: imgData, url }) => {
          const buf = imgData.data.buffer; // przekaż własność
          const handler = (ev: MessageEvent) => {
            const regions: Region[] = (ev.data && ev.data.regions) || [];
            // angle-aware simplify na głównym wątku
            const simplified = regions.map(r => ({
              ...r,
              points: simplifyClosedPolygon(r.points, { epsilon, minAngle: minAngleDeg, minEdge: minEdgePx, mode: simplifyMode })
            }));
            outFrames.push(meta.frame);
            outData[meta.frame] = { w, h, url, regions: simplified };
            finished++; setProgDone(finished);
            setLoading(`Gotowe: ${finished}/${files.length} • klatka ${meta.frame} • ${simplified.length} hs`);
            w.removeEventListener('message', handler);
            launch(w);
          };
          w.addEventListener('message', handler);
          try { w.postMessage({ w, h, buffer: buf, minArea, epsilon }, [buf]); }
          catch {
            const copy = new Uint8ClampedArray(imgData.data); w.postMessage({ w, h, buffer: copy.buffer, minArea, epsilon }, [copy.buffer]);
          }
        });
      };
      workers.forEach(w => launch(w));
    });

    outFrames.sort((a, b) => a - b);
    setFrames(outFrames);
    setByFrame(outData);
    setSeries(seriesName);
    setCurrentIdx(0);
    setLoading(`Zakończono: ${outFrames.length} klatek`);
    setProgTotal(0); setProgDone(0);
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
  const [tooltip, setTooltip] = useState("");

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
          <div className="font-semibold">Hotspot Studio – standalone</div>
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
              }}>Uprość (RDP)</button>
            </div>
            <div className="text-[11px] opacity-70">W trybie „edytuj węzły” możesz przeciągać węzły, klik na krawędzi dodaje punkt, Delete usuwa punkt.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
