export function quantizeImageData(data: Uint8ClampedArray, levels: number): Map<string, number> {
  if (data.length === 0 || data.length % 4 !== 0) {
    console.error('Błędne dane obrazu:', data.length);
    return new Map();
  }
  
  const step = Math.max(1, Math.floor(256/levels));
  console.log('Kwantyzacja z krokiem:', step, 'poziomów:', levels);
  
  const colors = new Map<string, number>();
  let processedPixels = 0;
  
  for (let i=0;i<data.length;i+=4){
    let r=data[i], g=data[i+1], b=data[i+2];
    
    // Kwantyzacja do najbliższego poziomu
    r = Math.min(255, Math.max(0, Math.floor(r/step)*step));
    g = Math.min(255, Math.max(0, Math.floor(g/step)*step));
    b = Math.min(255, Math.max(0, Math.floor(b/step)*step));
    
    // Zapisz skwantyzowane wartości z powrotem
    data[i] = r; 
    data[i+1] = g; 
    data[i+2] = b;
    // Zachowaj alpha
    // data[i+3] = data[i+3]; 
    
    const key = `${r}-${g}-${b}`;
    colors.set(key, (colors.get(key) || 0) + 1);
    processedPixels++;
  }
  
  console.log('Przetworzono pikseli:', processedPixels, 'unikalnych kolorów:', colors.size);
  return colors;
}