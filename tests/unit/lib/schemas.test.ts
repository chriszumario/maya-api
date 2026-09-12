import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import {
  LocalDateSchema,
  LocalTimeSchema,
  NumericIdSchema,
  NumericQuerySchema,
  TimeZoneSchema,
} from '@/lib/schemas';

describe('shared request schemas', () => {
  test('accepts real dates and rejects impossible dates', () => {
    expect(v.safeParse(LocalDateSchema, '2024-02-29').success).toBe(true);
    expect(v.safeParse(LocalDateSchema, '2023-02-29').success).toBe(false);
  });

  test.each(['00:00', '09:05', '23:59'])('accepts local time %s', (value) => {
    expect(v.safeParse(LocalTimeSchema, value).success).toBe(true);
  });

  test.each(['24:00', '10:60', '9:05'])('rejects local time %s', (value) => {
    expect(v.safeParse(LocalTimeSchema, value).success).toBe(false);
  });

  test('accepts IANA timezones and rejects unknown zones', () => {
    expect(v.parse(TimeZoneSchema, ' America/La_Paz ')).toBe('America/La_Paz');
    expect(v.safeParse(TimeZoneSchema, 'Mars/Olympus').success).toBe(false);
  });

  test('parses positive IDs and bounded numeric queries', () => {
    expect(v.parse(NumericIdSchema, '42')).toBe(42);
    expect(v.safeParse(NumericIdSchema, '0').success).toBe(false);
    expect(v.safeParse(NumericIdSchema, '1.5').success).toBe(false);
    expect(v.parse(NumericQuerySchema(1, 100), '100')).toBe(100);
    expect(v.safeParse(NumericQuerySchema(1, 100), '101').success).toBe(false);
  });
});
