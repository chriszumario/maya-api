import { describe, expect, test } from 'bun:test';
import { getCalendarParts, isValidLocalDate } from '@/lib/date';

describe('date utilities', () => {
  test.each([
    ['2024-02-29', true],
    ['2023-02-29', false],
    ['2026-13-01', false],
    ['2026-8-01', false],
    ['not-a-date', false],
  ])('validates %s as %s', (value, expected) => {
    expect(isValidLocalDate(value)).toBe(expected);
  });

  test('maps calendar parts using Sunday=0', () => {
    expect(getCalendarParts('2026-08-23')).toEqual({
      date: '2026-08-23',
      dayOfWeek: 0,
      dayOfMonth: 23,
    });
  });
});

