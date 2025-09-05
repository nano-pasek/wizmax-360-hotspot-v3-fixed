export type Pt = [number, number];

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i=0;i<poly.length;i++) {
    const [x1,y1] = poly[i];
    const [x2,y2] = poly[(i+1)%poly.length];
    s += x1*y2 - x2*y1;
  }
  return Math.abs(s) * 0.5;
}

export function rdp(points: Pt[], tol: number): Pt[] {
  if (points.length <= 3) return points.slice();
  const [x1,y1] = points[0];
  const [x2,y2] = points[points.length-1];
  const dx = x2-x1, dy = y2-y1;
  const den = dx*dx + dy*dy || 1;
  let maxD = 0, idx = 0;
  for (let i=1;i<points.length-1;i++) {
    const [x0,y0] = points[i];
    const t = ((x0-x1)*dx + (y0-y1)*dy) / den;
    const px = x1 + t*dx, py = y1 + t*dy;
    const d = Math.hypot(px-x0, py-y0);
    if (d > maxD){ maxD = d; idx = i; }
  }
  if (maxD <= tol) {
    // Dla bardzo małych tolerancji, zachowaj więcej punktów
    if (points.length <= 8) return points.slice();
    return [points[0], points[points.length-1]];
  }
  const left = rdp(points.slice(0, idx+1), tol);
  const right = rdp(points.slice(idx), tol);
  return left.slice(0,-1).concat(right);
}

export function rdpClosed(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points.slice();
  if (tol < 0) tol = 0;
  
  const closed = points.length>2 && Math.hypot(points[0][0]-points[points.length-1][0], points[0][1]-points[points.length-1][1]) < 1e-6;
  const pts = closed ? points.slice(0,-1) : points.slice();
  
  if (pts.length < 3) return pts;
  
  // USUNIĘTO automatyczne wymuszanie prostokątów - zachowaj oryginalne kształty!
  const result = rdp(pts, tol);
  // Zapewnij minimum 3 punkty dla wielokąta
  return result.length >= 3 ? result : pts.slice(0, 3);
}



export function perimeter(poly: Pt[]): number {
  let L = 0;
  for(let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    L += Math.hypot(b[0]-a[0], b[1]-a[1]);
  }
  return L;
}

export function resample(poly: Pt[], K: number): Pt[] {
  const n = poly.length;
  if (n === 0) return [];
  if (K <= 0) return [];
  if (K === 1) return [poly[0].slice() as Pt];
  if (n === 1) return Array.from({length: K}, () => poly[0].slice() as Pt);
  
  const Ltot = perimeter(poly);
  if (Ltot <= 1e-9) return Array.from({length: K}, () => poly[0].slice() as Pt);
  
  const targets = Array.from({length: K}, (_, i) => i * Ltot / K);
  const out: Pt[] = [];
  let seg = 0, acc = 0;
  const segLen = (i: number) => {
    const a = poly[i], b = poly[(i + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  let cur = segLen(0);
  let guard = 0;
  
  for (const t of targets) {
    guard = 0;
    while (acc + cur < t - 1e-9 && guard < n * 2) {
      acc += cur; 
      seg = (seg + 1) % n; 
      cur = segLen(seg);
      guard++;
    }
    const a = poly[seg], b = poly[(seg + 1) % n];
    const u = cur > 1e-9 ? Math.max(0, Math.min(1, (t - acc) / cur)) : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

export function hashColor(str: string, alpha=0.35): string {
  let h = 2166136261 >>> 0;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r=(h>>>16)&255, g=(h>>>8)&255, b=h&255;
  return `rgba(${r},${g},${b},${alpha})`;
}