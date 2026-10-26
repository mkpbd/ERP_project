/**
 * Code 39 barcodes as inline SVG, for labels printed through the HTML report engine (old
 * GenerateVacuLabelBarcode / Code39Png). Nine elements per character, bar first; 1 is a wide element.
 */
const PATTERNS: Readonly<Record<string, string>> = {
  '0': '000110100',
  '1': '100100001',
  '2': '001100001',
  '3': '101100000',
  '4': '000110001',
  '5': '100110000',
  '6': '001110000',
  '7': '000100101',
  '8': '100100100',
  '9': '001100100',
  A: '100001001',
  B: '001001001',
  C: '101001000',
  D: '000011001',
  E: '100011000',
  F: '001011000',
  G: '000001101',
  H: '100001100',
  I: '001001100',
  J: '000011100',
  K: '100000011',
  L: '001000011',
  M: '101000010',
  N: '000010011',
  O: '100010010',
  P: '001010010',
  Q: '000000111',
  R: '100000110',
  S: '001000110',
  T: '000010110',
  U: '110000001',
  V: '011000001',
  W: '111000000',
  X: '010010001',
  Y: '110010000',
  Z: '011010000',
  '-': '010000101',
  '.': '110000100',
  ' ': '011000100',
  '*': '010010100',
};

const NARROW = 1;
const WIDE = 3;
const QUIET = 10;

/** The bars of `value` (upper-cased; framed by the * start and stop characters) as [x, width] in narrow units. */
export function code39Bars(value: string): { bars: [number, number][]; width: number } {
  const text = value.toUpperCase();
  for (const char of text) {
    if (char === '*' || !(char in PATTERNS)) throw new Error(`Code 39 cannot encode "${char}"`);
  }
  const bars: [number, number][] = [];
  let x = QUIET;
  for (const char of `*${text}*`) {
    const pattern = PATTERNS[char]!;
    for (let index = 0; index < 9; index++) {
      const width = pattern[index] === '1' ? WIDE : NARROW;
      if (index % 2 === 0) bars.push([x, width]);
      x += width;
    }
    x += NARROW;
  }
  return { bars, width: x - NARROW + QUIET };
}

/** An SVG that scales to its box (`preserveAspectRatio="none"` keeps the bars full height). */
export function code39Svg(value: string): string {
  const { bars, width } = code39Bars(value);
  const rects = bars.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="40"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" preserveAspectRatio="none" ` +
    `role="img" aria-label="${value.replace(/[<>&"]/g, '')}"><rect width="${width}" height="40" fill="#fff"/>` +
    `<g fill="#000">${rects}</g></svg>`
  );
}
