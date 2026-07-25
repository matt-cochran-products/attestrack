import { describe, expect, it } from 'vitest';
import { mergeSeriesForRecharts } from './recharts-data';

describe('mergeSeriesForRecharts', () => {
  it('merges multi-series points by label, preserving first-seen order', () => {
    const { data, names } = mergeSeriesForRecharts([
      {
        name: 'EU',
        points: [
          { label: '2026-07-24', value: 75 },
          { label: '2026-07-25', value: 50 },
        ],
      },
      { name: 'US-CA', points: [{ label: '2026-07-25', value: 90 }] },
    ]);
    expect(names).toEqual(['EU', 'US-CA']);
    expect(data).toEqual([
      { label: '2026-07-24', EU: 75 },
      { label: '2026-07-25', EU: 50, 'US-CA': 90 },
    ]);
  });

  it('leaves missing cells absent — gaps stay gaps, never invented zeros', () => {
    const { data } = mergeSeriesForRecharts([
      { name: 'A', points: [{ label: 'd1', value: 1 }] },
      { name: 'B', points: [{ label: 'd2', value: 2 }] },
    ]);
    expect(data[0]).not.toHaveProperty('B');
    expect(data[1]).not.toHaveProperty('A');
  });
});
