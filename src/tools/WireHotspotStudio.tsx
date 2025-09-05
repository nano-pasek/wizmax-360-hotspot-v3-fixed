import React, { useMemo, useState, useEffect, useRef } from "react";
import useFrameNavigator from "../hooks/useFrameNavigator";
import {
  processWireBatch,
  type RawItem,
  type FramePreview,
  type ExportJson,
} from "../lib/wireHotspot";
import { VERSION, BUILD_DATE } from "../version";

export default function WireHotspotStudio() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState<string>("");

  const [minArea, setMinArea] = useState(1000);
  const [epsilon, setEpsilon] = useState(1.5);
  const [frameRx, setFrameRx] = useState("([^_]+)_(\\d+)");
  const [expected, setExpected] = useState<string>("");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  const [baseW, setBaseW] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const [series, setSeries] = useState("");
  const [frames, setFrames] = useState<number[]>([]);
  const [rawByFrame, setRawByFrame] = useState<Record<number, RawItem[]>>({});
  const [imagesByFrame, setImagesByFrame] = useState<Record<number, FramePreview>>({});

  const [colorMapText, setColorMapText] = useState("{}");
  const colorMap = useMemo(() => { try { return JSON.parse(colorMapText || "{}"); } catch { return {}; } }, [colorMapText]);

  const nav = useFrameNavigator(frames, useMemo(() => {
    const f = parseInt(rangeFrom, 10); const t = parseInt(rangeTo, 10);
    if (Number.isFinite(f) && Number.isFinite(t)) return { from: f, to: t };
    return undefined;
  }, [rangeFrom, rangeTo]));

  const [showLabels, setShowLabels] = useState(true);
  const [strokeW, setStrokeW] = useState(2);
  const [fillAlpha, setFillAlpha] = useState(28);
  const [labelFontSize, setLabelFontSize] = useState(24);

  const [exported, setExported] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [idPrefix, setIdPrefix] = useState("M");
  const [idNumber, setIdNumber] = useState("");
  const [idGlobal, setIdGlobal] = useState(false);

  // Preview zoom
  const [zoom, setZoom] = useState(1);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);

  // Legend filter
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(false);

  // Additional UI states
  const [hoveredHotspot, setHoveredHotspot] = useState<number | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<number | null>(null);
  const [showWireImage, setShowWireImage] = useState(true);
  const [hoveredLegendColor, setHoveredLegendColor] = useState<string | null>(null);
  const [showAreas, setShowAreas] = useState(true);

  // Pan (drag) functionality
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Panels width + resizers
  const [sidebarW, setSidebarW] = useState(320);
  const [legendW, setLegendW] = useState(360);
  const resizing = useRef<null | 'left' | 'right'>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current || !containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      if (resizing.current === 'left') {
        const w = Math.max(260, Math.min(480, e.clientX - bounds.left));
        setSidebarW(w);
      } else if (resizing.current === 'right') {
        const w = Math.max(280, Math.min(520, bounds.right - e.clientX));
        setLegendW(w);
      }
    };
    const onUp = () => { resizing.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem('whs_settings', JSON.stringify({
      minArea, epsilon, frameRx, colorMapText, idPrefix, showLabels, strokeW, fillAlpha, zoom, showOnlyUnmapped, idGlobal, labelFontSize,
      sidebarW, legendW, showWireImage, panOffset, showAreas, selectedHotspot,
    })); } catch {}
  }, [minArea, epsilon, frameRx, colorMapText, idPrefix, showLabels, strokeW, fillAlpha, zoom, showOnlyUnmapped, idGlobal, labelFontSize, sidebarW, legendW, showWireImage, panOffset, showAreas, selectedHotspot]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('whs_settings') || '{}');
      if (!saved) return;
      if (typeof saved.minArea === 'number') setMinArea(saved.minArea);
      if (typeof saved.epsilon === 'number') setEpsilon(saved.epsilon);
      if (typeof saved.frameRx === 'string') setFrameRx(saved.frameRx);
      if (typeof saved.colorMapText === 'string') setColorMapText(saved.colorMapText);
      if (typeof saved.idPrefix === 'string') setIdPrefix(saved.idPrefix);
      if (typeof saved.showLabels === 'boolean') setShowLabels(saved.showLabels);
      if (typeof saved.strokeW === 'number') setStrokeW(saved.strokeW);
      if (typeof saved.fillAlpha === 'number') setFillAlpha(saved.fillAlpha);
      if (typeof saved.zoom === 'number') setZoom(saved.zoom);
      if (typeof saved.showOnlyUnmapped === 'boolean') setShowOnlyUnmapped(saved.showOnlyUnmapped);
              if (typeof saved.idGlobal === 'boolean') setIdGlobal(saved.idGlobal);
        if (typeof saved.labelFontSize === 'number') setLabelFontSize(saved.labelFontSize);
        if (typeof saved.sidebarW === 'number') setSidebarW(saved.sidebarW);
        if (typeof saved.legendW === 'number') setLegendW(saved.legendW);
        if (typeof saved.showWireImage === 'boolean') setShowWireImage(saved.showWireImage);
        if (saved.panOffset && typeof saved.panOffset.x === 'number' && typeof saved.panOffset.y === 'number') setPanOffset(saved.panOffset);
        if (typeof saved.showAreas === 'boolean') setShowAreas(saved.showAreas);
        if (typeof saved.selectedHotspot === 'number') setSelectedHotspot(saved.selectedHotspot);
    } catch {}
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Frame navigation
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); nav.prev(); }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); nav.next(); }
      
      // Pan with arrow keys (when Shift is held)
      if (e.shiftKey) {
        const panStep = 50;
        if (e.key === 'ArrowUp') { e.preventDefault(); setPanOffset(p => ({ ...p, y: p.y + panStep })); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setPanOffset(p => ({ ...p, y: p.y - panStep })); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setPanOffset(p => ({ ...p, x: p.x + panStep })); }
        if (e.key === 'ArrowRight') { e.preventDefault(); setPanOffset(p => ({ ...p, x: p.x - panStep })); }
      }
      
      // Zoom shortcuts
      if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(z => Math.min(3, +(z + 0.1).toFixed(2))); }
      if ((e.key === '-' || e.key === '_') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2))); }
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(1); setPanOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey, { passive: false } as any);
    return () => window.removeEventListener('keydown', onKey as any);
  }, [nav]);


  const start = async () => {
    if (!files.length) return;
    setLoading("Przeliczam…");
    const res = await processWireBatch(files, { minArea, epsilon, frameRegex: frameRx, colorMap });
    setBaseW(res.baseW); setBaseH(res.baseH); setSeries(res.seriesPrefix);
    setFrames(res.frames); setRawByFrame(res.rawByFrame); setImagesByFrame(res.imagesByFrame);
    setLoading(`Gotowe: ${res.frames.length} klatek, ${Object.values(res.rawByFrame).reduce((a, b) => a + b.length, 0)} hotspotów`);
    setExported(false);
  };

  const exportJson = () => {
    if (!baseW || !baseH) return;
    const items: any[] = [];
    for (const f of frames) {
      for (const it of rawByFrame[f] || []) {
        const mapped = (colorMap as any)[it.color] || it.color;
        const id = idGlobal ? mapped : `${mapped};${f}`;
        items.push({ id, frame: f, points: it.points, color: it.color });
      }
    }
    const json: ExportJson = { base: { w: baseW, h: baseH }, items };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hotspots.json"; a.click();
    setExported(true);
  };

  const applyNameToSelected = () => {
    if (!selectedColor || !idNumber) return;
    const m = { ...(colorMap || {}) } as Record<string, string>;
    m[selectedColor] = `${idPrefix}${idNumber}`;
    setColorMapText(JSON.stringify(m, null, 2));
  };

  const preview = useMemo(() => {
    const f = nav.frame; if (f == null) return null as null | { w: number; h: number; url: string; items: RawItem[]; frame: number };
    const img = imagesByFrame[f]; const items = rawByFrame[f] || []; if (!img) return null;
    return { w: img.w, h: img.h, url: img.url, items, frame: f };
  }, [nav.frame, imagesByFrame, rawByFrame]);

  const legend = useMemo(() => {
    if (!preview) return [] as { color: string; mapped: string }[];
    const m = new Map<string, string>();
    for (const it of preview.items) m.set(it.color, (colorMap as any)[it.color] || "");
    return Array.from(m.entries()).map(([color, mapped]) => ({ color, mapped }));
  }, [preview, colorMap]);

  const legendToShow = useMemo(() => showOnlyUnmapped ? legend.filter(l => !l.mapped) : legend, [legend, showOnlyUnmapped]);

  const labelForColor = (hex: string) => (colorMap as any)[hex] || hex;

  // Advanced centroid calculation for better label positioning
  const centroid = (points: [number, number][]) => {
    if (!points.length) return [0, 0];
    
    // Find bounding box
    let minX = points[0][0], maxX = points[0][0];
    let minY = points[0][1], maxY = points[0][1];
    
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    
    // Calculate polygon area and centroid using the shoelace formula
    let area = 0;
    let cx = 0, cy = 0;
    
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const cross = points[i][0] * points[j][1] - points[j][0] * points[i][1];
      area += cross;
      cx += (points[i][0] + points[j][0]) * cross;
      cy += (points[i][1] + points[j][1]) * cross;
    }
    
    area *= 0.5;
    
    if (Math.abs(area) < 1e-10) {
      // Fallback to bounding box center for degenerate polygons
      return [(minX + maxX) / 2, (minY + maxY) / 2];
    }
    
    cx /= (6 * area);
    cy /= (6 * area);
    
    // Ensure the centroid is within the bounding box (safety check)
    cx = Math.max(minX, Math.min(maxX, cx));
    cy = Math.max(minY, Math.min(maxY, cy));
    
    return [cx, cy];
  };

  // Calculate polygon area using the shoelace formula
  const calculatePolygonArea = (points: [number, number][]): number => {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }
    
    return Math.abs(area) / 2;
  };

  const handleWheelZoom: React.WheelEventHandler<HTMLDivElement> = (e) => {
    // Always prevent default and handle zoom for our viewport
    e.preventDefault();
    e.stopPropagation();
    const d = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.25, Math.min(3, +(z + d).toFixed(2))));
  };

  // Pan (drag) handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // Left mouse button
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = (_e: React.MouseEvent) => {
    setIsDragging(false);
  };

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  return (
    <div className="h-screen bg-[#0f1115] text-[#E8EAED] overflow-hidden px-[2.5%]">
      {/* Version badge */}
      <div className="absolute bottom-2 right-2 z-50 bg-black/70 backdrop-blur-sm border border-white/30 rounded-lg px-4 py-2 text-[13px] font-mono opacity-90 hover:opacity-100 transition-opacity shadow-lg">
        v{VERSION} • {BUILD_DATE}
      </div>
      <div ref={containerRef} className="relative h-full w-full grid" style={{ gridTemplateColumns: `${sidebarW}px 1fr ${legendW}px` }}>
        {/* Left panel */}
        <div className="h-full overflow-y-auto bg-white/5 border-r border-white/10 p-3 space-y-3 min-w-0">
          <div className="text-[14px] font-semibold opacity-90">Pliki WIRE</div>
          <div className="border-2 border-dashed border-white/20 rounded p-3 text-center hover:border-emerald-400/50 transition cursor-pointer"
            onDrop={(e) => { e.preventDefault(); const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')); setFiles(droppedFiles); }}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('file-input')?.click()}
            >
            <div className="text-[12px] mb-1">Przeciągnij pliki lub kliknij</div>
            <div className="text-[12px] opacity-70">PNG/JPG/TIFF • multiple</div>
            <input id="file-input" type="file" multiple accept="image/*" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </div>
          <div className="text-[12px] opacity-80">
              {files.length ? (
                <div>
                  <strong>{files.length} plików:</strong>
                <div className="mt-1 max-h-12 overflow-y-auto">
                  {files.slice(0, 3).map((f, i) => (<div key={i} className="text-[12px] opacity-70 truncate">{f.name}</div>))}
                  {files.length > 3 && <div className="text-[12px] opacity-50">… i {files.length - 3} więcej</div>}
                </div>
            </div>
            ) : 'Nie wybrano plików'}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[13px] font-semibold">Przeliczanie</div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <label className="relative">
                <div className="flex items-center gap-1">
                  Min. pole (px²)
                  <span className="text-[10px] opacity-60 cursor-help hover:opacity-100 relative group" title="Min. pole (px²) - Minimalna powierzchnia obszaru w pikselach², który zostanie uznany za hotspot. Obszary mniejsze zostaną zignorowane.">ⓘ</span>
                </div>
                <input type="number" value={minArea} onChange={e=>setMinArea(parseInt(e.target.value))} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" />
            </label>
              <label className="relative">
                <div className="flex items-center gap-1">
                  Epsilon RDP
                  <span className="text-[10px] opacity-60 cursor-help hover:opacity-100" title="Epsilon RDP (px) - Parametr algorytmu Ramer-Douglas-Peucker do upraszczania konturów. ε=0: dokładny kontur (wiele punktów), ε=1,5: uproszczony ale wierny, ε=5: bardzo uproszczony (może tracić szczegóły).">ⓘ</span>
          </div>
                <input type="number" step={0.5} value={epsilon} onChange={e=>setEpsilon(parseFloat(e.target.value))} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" />
              </label>
              <label className="col-span-2 relative">
                <div className="flex items-center gap-1">
                  Regex klatek
                  <span className="text-[10px] opacity-60 cursor-help hover:opacity-100" title="Regex klatek - Regular expression do parsowania nazw plików. Format: (seria)_(numer). Przykład: K_000.png → seria: 'K', klatka: 0">ⓘ</span>
                </div>
                <input type="text" value={frameRx} onChange={e=>setFrameRx(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15 font-mono" />
              </label>
              <label>Zakres od<input type="number" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" /></label>
              <label>Zakres do<input type="number" value={rangeTo} onChange={e=>setRangeTo(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" /></label>
              <label className="col-span-2">Docelowa liczba klatek<input type="number" value={expected} onChange={e=>setExpected(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" /></label>
            </div>
            <button onClick={start} className="w-full px-3 py-2 rounded bg-emerald-500/20 border border-emerald-400/30 text-[13px]">Przelicz</button>
            <div className="text-[12px] opacity-80">{loading}</div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[13px] font-semibold">Mapa kolor → ID</div>
            <textarea rows={5} value={colorMapText} onChange={e=>setColorMapText(e.target.value)} className="w-full font-mono text-[12px] px-2 py-1 rounded bg-black/40 border border-white/15" />
            <div className="grid grid-cols-[60px_1fr_90px] gap-2 items-end text-[12px]">
              <label>Prefix<input value={idPrefix} onChange={e=>setIdPrefix(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" /></label>
              <label>Numer<input value={idNumber} onChange={e=>setIdNumber(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-black/40 border border-white/15" /></label>
              <button onClick={applyNameToSelected} className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/30">Przypisz</button>
            </div>
            <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={idGlobal} onChange={e=>setIdGlobal(e.target.checked)} />ID globalne (bez ;frame)</label>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[13px] font-semibold">Eksport</div>
            <div className={`rounded px-2 py-1 text-[12px] ${exported ? 'bg-emerald-500/10':'bg-black/30'}`}>Eksport JSON — {exported ? 'pobrano' : 'oczekuje'}</div>
            <button onClick={exportJson} disabled={!frames.length} className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 disabled:opacity-50 text-[13px]">Eksportuj hotspots.json</button>
          </div>
        </div>

        {/* Resizer left */}
        <div onMouseDown={(_e)=>{resizing.current='left'; document.body.style.cursor='col-resize';}} className="absolute top-0" style={{ left: sidebarW - 3, width: 6, bottom: 0, cursor: 'col-resize' }} />

        {/* Preview center */}
        <div className="h-full bg-[#0b0d11] relative border-r border-white/10 min-w-0 grid" style={{ gridTemplateRows: '36px 1fr 40px' }}>
          <div className="px-3 border-b border-white/10 flex items-center justify-between text-[13px]">
            <div className="font-semibold">Podgląd {nav.frame !== null ? `(${nav.idx + 1}/${nav.count})` : ''}</div>
            {preview && <div className="opacity-80">{series ? series + '_' : ''}{preview.frame.toString().padStart(3, '0')} • {preview.items.length} hs</div>}
            </div>
          <div 
            className="min-w-0 min-h-0 w-full h-full flex items-center justify-center overflow-hidden" 
            onWheel={handleWheelZoom} 
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={(e) => {
              // Click outside hotspots to deselect
              if (e.target === e.currentTarget) {
                setSelectedHotspot(null);
              }
            }}
            ref={previewWrapRef}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
              {preview ? (
              <div 
                className="relative max-w-full max-h-full" 
                style={{ 
                  transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`, 
                  transformOrigin: 'center center' 
                }}
              >
                {showWireImage && <img src={preview.url} alt="preview" className="max-w-full max-h-full object-contain rounded border border-white/10" />}
                <svg viewBox={`0 0 ${preview.w} ${preview.h}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none" style={{ pointerEvents: 'auto' }}>
                    {preview.items.map((hs, i) => {
                      const [cx, cy] = centroid(hs.points);
                    const isHovered = hoveredHotspot === i || hoveredLegendColor === hs.color;
                    const isSelected = selectedHotspot === i;
                    const isHighlighted = isHovered || isSelected;
                      return (
                        <g key={i}>
                        <polygon 
                          points={hs.points.map(p => p.join(",")).join(" ")} 
                          fill={isHighlighted ? `rgba(0,255,0,0.8)` : `rgba(255,70,70,${fillAlpha/100})`} 
                          stroke="#ff4444" 
                          strokeWidth={strokeW} 
                          style={{ pointerEvents: 'auto', cursor: 'pointer' }} 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedColor(hs.color);
                            setSelectedHotspot(selectedHotspot === i ? null : i);
                          }}
                          onMouseEnter={() => setHoveredHotspot(i)}
                          onMouseLeave={() => setHoveredHotspot(null)}
                        />
                          {showLabels && (
                          <text x={cx} y={cy} fontSize={labelFontSize} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={Math.max(3, Math.round(labelFontSize/4))} paintOrder="stroke" style={{ fontWeight: 700 }}>
                            {labelForColor(hs.color)}
                            {showAreas && (
                              <tspan x={cx} dy={labelFontSize * 1.2} fontSize={labelFontSize * 0.7} fill="#ffff00" stroke="#000" strokeWidth={Math.max(2, Math.round(labelFontSize/6))}>
                                {hs.pixelArea || Math.round(calculatePolygonArea(hs.points))} px²
                              </tspan>
                            )}
                          </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              ) : (
              <div className="opacity-70 text-[13px]">Wczytaj pliki i kliknij „Przelicz".</div>
            )}
          </div>
          {/* Navigation buttons - fixed position below preview */}
          <div className="border-t border-white/10 flex justify-center items-center gap-2 py-2">
            {preview ? (
              <>
                <button onClick={nav.prev} disabled={nav.idx === 0} className="px-4 py-1 rounded-full bg-black/70 border border-white/20 disabled:opacity-30 text-lg hover:bg-black/80">‹</button>
                <button onClick={nav.next} disabled={nav.idx === nav.count - 1} className="px-4 py-1 rounded-full bg-black/70 border border-white/20 disabled:opacity-30 text-lg hover:bg-black/80">›</button>
              </>
            ) : (
              <div className="text-[12px] opacity-50">Nawigacja niedostępna</div>
            )}
          </div>
        </div>

        {/* Resizer right */}
        <div onMouseDown={(_e)=>{resizing.current='right'; document.body.style.cursor='col-resize';}} className="absolute top-0" style={{ left: `calc(100% - ${legendW + 3}px)`, width: 6, bottom: 0, cursor: 'col-resize' }} />

        {/* Right panel: legend + view controls */}
        <div className="h-full overflow-y-auto bg-white/5 p-3 space-y-3 min-w-0">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="text-[13px] font-semibold">Widok</div>
            <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={showLabels} onChange={e=>setShowLabels(e.target.checked)} />Pokaż nazwy</label>
            <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={showWireImage} onChange={e=>setShowWireImage(e.target.checked)} />Pokaż obraz WIRE</label>
            <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={showAreas} onChange={e=>setShowAreas(e.target.checked)} />Pokaż powierzchnie</label>
            <label className="text-[12px]">Wypełnienie<input type="range" min={0} max={100} value={fillAlpha} onChange={e=>setFillAlpha(parseInt(e.target.value))} className="w-full" /></label>
            <label className="text-[12px]">Obrys<input type="range" min={0} max={10} value={strokeW} onChange={e=>setStrokeW(parseInt(e.target.value))} className="w-full" /></label>
            <label className="text-[12px]">Rozmiar nazw<input type="range" min={10} max={28} value={labelFontSize} onChange={e=>setLabelFontSize(parseInt(e.target.value))} className="w-full" /></label>
            <div className="flex items-center gap-2 text-[12px] opacity-80">
              <span>Zoom: kółko | Pan: przeciągnij | Nav: A/D/←/→</span>
              <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} className="px-2 py-0.5">-</button>
              <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="px-2 py-0.5">1:1</button>
              <button onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))} className="px-2 py-0.5">+</button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-semibold">Legenda kolorów</div>
              <label className="text-[12px] flex items-center gap-1"><input type="checkbox" checked={showOnlyUnmapped} onChange={e=>setShowOnlyUnmapped(e.target.checked)} />Tylko nieprzypisane</label>
            </div>
                          {legendToShow.length ? (
                <div className="flex flex-wrap gap-1">
                  {legendToShow.map(l => (
                    <button 
                      key={l.color} 
                      onClick={() => {
                        setSelectedColor(l.color);
                        // Find first hotspot with this color and toggle its selection
                        const hotspotIndex = preview?.items.findIndex(hs => hs.color === l.color) ?? -1;
                        if (hotspotIndex !== -1) {
                          setSelectedHotspot(selectedHotspot === hotspotIndex ? null : hotspotIndex);
                        }
                      }} 
                      onMouseEnter={() => setHoveredLegendColor(l.color)}
                      onMouseLeave={() => setHoveredLegendColor(null)}
                      className="px-2 py-1 rounded border text-[12px] flex items-center gap-2" 
                      style={{ borderColor: l.color, background: selectedColor===l.color ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)' }}
                    >
                      <span className="w-3 h-3 rounded-sm" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />
                      <span className="font-mono">{l.color}</span>
                      <span className="opacity-80">{l.mapped ? `→ ${l.mapped}` : ''}</span>
                    </button>
                  ))}
                </div>
              ) : (
              <div className="text-[12px] opacity-70">Brak — przelicz najpierw.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
