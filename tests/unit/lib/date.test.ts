import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { computeLocalDate, getCalendarParts, isValidLocalDate } from '@/lib/date';

afterEach(() => mock.restore());

describe('date utilities', () => {
  test('uses the user timezone across UTC midnight and daylight saving changes', () => {
    const instant = Temporal.Instant.from('2026-03-08T04:30:00Z');
    spyOn(Temporal.Now, 'zonedDateTimeISO').mockImplementation((zone = 'UTC') =>
      instant.toZonedDateTimeISO(zone),
    );
    expect(computeLocalDate('America/New_York')).toBe('2026-03-07');
    expect(computeLocalDate('Asia/Tokyo')).toBe('2026-03-08');
    const beforeDst = Temporal.ZonedDateTime.from('2026-03-07T12:00:00-05:00[America/New_York]');
    expect(beforeDst.add({ days: 1 }).since(beforeDst).total('hours')).toBe(23);
  });

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
