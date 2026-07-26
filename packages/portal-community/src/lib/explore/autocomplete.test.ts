import { describe, expect, it } from 'vitest';
import {
  ATTESTRACK_EVENT_COLUMNS,
  ATTESTRACK_EXPLORE_ALLOWED_TABLES,
} from '@attestrack/types';
import { buildSqlAutocompleteSchema, SQL_DEFAULT_TABLE } from './autocomplete';

describe('buildSqlAutocompleteSchema (EXP.6 — schema autocomplete from @attestrack/types)', () => {
  it('offers exactly the allowlisted tables (INV-B-15 alignment)', () => {
    const schema = buildSqlAutocompleteSchema();
    expect(Object.keys(schema).sort()).toEqual([...ATTESTRACK_EXPLORE_ALLOWED_TABLES].sort());
  });

  it('offers every event-schema column on each table', () => {
    const schema = buildSqlAutocompleteSchema();
    for (const table of ATTESTRACK_EXPLORE_ALLOWED_TABLES) {
      expect(schema[table]).toEqual([...ATTESTRACK_EVENT_COLUMNS]);
    }
    // Spot-check the fields the spec calls out for analytics honesty.
    expect(schema.events).toContain('eventName');
    expect(schema.events).toContain('consentDecision');
    expect(schema.events).toContain('jurisdiction');
    expect(schema.events).toContain('userAgentClass');
    expect(schema.events).toContain('receivedAt');
  });

  it('defaults to an allowlisted table', () => {
    expect(ATTESTRACK_EXPLORE_ALLOWED_TABLES).toContain(SQL_DEFAULT_TABLE);
  });
});
