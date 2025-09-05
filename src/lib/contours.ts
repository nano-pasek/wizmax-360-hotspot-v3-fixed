import type { Pt } from './geometry'

export function mooreContours(mask: Uint8Array, W: number, H: number): Pt[][] {
  if(W <= 0 || H <= 0 || mask.length !== W*H) {
    console.error('Błędne parametry mooreContours:', {W, H, maskLen: mask.length, expected: W*H});
    return [];
  }
  
  const visited = new Uint8Array(W*H);
  const idx = (x:number,y:number)=> y*W + x;
  const inb = (x:number,y:number)=> x>=0 && y>=0 && x<W && y<H;
  const nbrs: Pt[] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  function isBorder(x:number,y:number):boolean{
    if(!inb(x,y) || mask[idx(x,y)]===0) return false;
    for(const [dx,dy] of nbrs){
      const nx=x+dx, ny=y+dy;
      if(!inb(nx,ny) || mask[idx(nx,ny)]===0) return true;
    }
    return false;
  }
  const contours: Pt[][] = [];
  for (let y=0;y<H;y++) {
    for (let x=0;x<W;x++){
      const p = idx(x,y);
      if (visited[p] || !isBorder(x,y)) continue;
      
      let cx=x, cy=y; 
      let prevDir=6;
      const contour: Pt[] = [];
      const sx=x, sy=y;
      let guard=0;
      const maxGuard = Math.max(1000, W*H/10); // Rozumny limit
      
      do {
        if (guard > maxGuard) {
          console.warn('Moore contour: przekroczono limit iteracji', guard, 'dla punktu', sx, sy);
          break;
        }
        
        // Używaj precyzyjnych punktów na krawędziach pikseli dla lepszych konturów
        contour.push([cx + 0.5, cy + 0.5]);
        const currentIdx = idx(cx, cy);
        if (currentIdx >= 0 && currentIdx < visited.length) {
          visited[currentIdx] = 1;
        }
        
        let found=false;
        for(let k=0;k<8;k++){
          const dir=(prevDir+1+k)%8;
          const nx=cx+nbrs[dir][0], ny=cy+nbrs[dir][1];
          if(inb(nx,ny)) {
            const nIdx = idx(nx, ny);
            if (nIdx >= 0 && nIdx < mask.length && mask[nIdx]===1) {
              prevDir=(dir+6)%8; 
              cx=nx; 
              cy=ny; 
              found=true; 
              break;
            }
          }
        }
        if(!found) break;
        guard++;
      } while(!(cx===sx && cy===sy && contour.length>3));
      
      if (contour.length>=3) {
        contours.push(contour);
      }
    }
  }
  return contours;
}