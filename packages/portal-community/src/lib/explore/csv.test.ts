import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv (EXP.11 — browser-generated CSV)', () => {
  it('emits header + rows in column order', () => {
    const csv = toCsv(
      ['eventName', 'count'],
      [
        { eventName: 'page_view', count: 10 },
        { eventName: 'purchase', count: 2 },
      ],
    );
    expect(csv).toBe('eventName,count\npage_view,10\npurchase,2');
  });

  it('escapes quotes, commas, and newlines; null/undefined become empty', () => {
    const csv = toCsv(
      ['a', 'b'],
      [{ a: 'x,"y"\nz', b: null }],
    );
    expect(csv).toBe('a,b\n"x,""y""\nz",');
  });
});
