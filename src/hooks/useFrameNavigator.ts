import { useCallback, useEffect, useMemo, useState } from "react";

export default function useFrameNavigator(allFrames: number[], range?: { from: number; to: number }) {
  const allowed = useMemo(() => {
    if (!allFrames.length) return [] as number[];
    if (!range) return allFrames;
    return allFrames.filter(f => f >= range.from && f <= range.to);
  }, [allFrames, range?.from, range?.to]);

  const [idx, setIdx] = useState(0);
  const frame = allowed[idx] ?? null;

  const prev = useCallback(() => setIdx(i => (i > 0 ? i - 1 : i)), []);
  const next = useCallback(() => setIdx(i => (i < allowed.length - 1 ? i + 1 : i)), [allowed.length]);

  useEffect(() => { setIdx(0); }, [allowed.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") prev(); if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  return { frame, idx, count: allowed.length, prev, next, setIdx, allowed };
}
