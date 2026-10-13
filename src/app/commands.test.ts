import { describe, expect, it } from 'vitest';
import { matchScore } from './commands';

describe('quick search matching', () => {
  it('matches whole words and word starts first', () => {
    expect(matchScore('mirr', 'Mirror drawing on or off')).toBeGreaterThan(matchScore('mirr', 'Flip picked dots (mirror)'));
    expect(matchScore('export', 'Export model (.glb)')).toBeGreaterThan(0);
  });

  it('matches initials', () => {
    expect(matchScore('nb', 'New blueprint seen from the side')).toBeGreaterThan(0);
  });

  it('does not match letters scattered across words', () => {
    expect(matchScore('mirr', 'Draw curves smooth pen bezier Draw')).toBe(0);
    expect(matchScore('wheel xyz', 'Add wheel')).toBe(0);
  });
});
