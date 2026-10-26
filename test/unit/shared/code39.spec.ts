import { describe, expect, it } from 'vitest';
import { code39Bars, code39Svg } from '../../../src/shared/infrastructure/reports/code39.js';

describe('code39', () => {
  it('frames the text with start and stop characters, five bars each', () => {
    // *, F, A, -, 0, 1, *: seven characters of five bars.
    const { bars, width } = code39Bars('fa-01');
    expect(bars).toHaveLength(35);
    // Each character is 3 wide + 6 narrow = 15 units and a gap of 1; quiet zones of 10 on both sides.
    expect(width).toBe(10 + 7 * 16 - 1 + 10);
    // The start character * is 010010100: narrow bar, wide space, narrow bar, narrow space, wide bar.
    expect(bars.slice(0, 3)).toEqual([
      [10, 1],
      [14, 1],
      [16, 3],
    ]);
  });

  it('refuses what Code 39 cannot carry', () => {
    expect(() => code39Bars('FA_1')).toThrow(/cannot encode "_"/);
    expect(() => code39Bars('A*B')).toThrow(/cannot encode "\*"/);
  });

  it('draws an SVG that names its value', () => {
    expect(code39Svg('FA-000001')).toMatch(/^<svg [^>]*aria-label="FA-000001"/);
  });
});
