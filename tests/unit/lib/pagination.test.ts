import { describe, expect, test } from 'bun:test';
import { decodeDateIdCursor, toDateIdCursorPage } from '@/lib/pagination';

describe('date/id cursor pagination', () => {
  const rows = [
    { id: 9, localDate: '2026-08-23', value: 'a' },
    { id: 8, localDate: '2026-08-23', value: 'b' },
    { id: 7, localDate: '2026-08-22', value: 'c' },
  ];

  test('returns a stable cursor from the last visible item when another page exists', () => {
    const page = toDateIdCursorPage(rows, 2);

    expect(page.items).toEqual(rows.slice(0, 2));
    expect(page.nextCursor).not.toBeNull();
    expect(decodeDateIdCursor(page.nextCursor!)).toEqual({
      localDate: '2026-08-23',
      id: 8,
    });
  });

  test('does not emit a cursor for the final page', () => {
    expect(toDateIdCursorPage(rows.slice(0, 2), 2).nextCursor).toBeNull();
  });

  test('binds cursors to their resource and filter', () => {
    const cursor = toDateIdCursorPage(rows, 2, {
      scope: 'nutrition',
      filter: '2026-08-23',
    }).nextCursor!;

    expect(decodeDateIdCursor(cursor, {
      scope: 'nutrition',
      filter: '2026-08-23',
    })).toEqual({ localDate: '2026-08-23', id: 8 });
    expect(decodeDateIdCursor(cursor, { scope: 'journal' })).toBeNull();
    expect(decodeDateIdCursor(cursor, {
      scope: 'nutrition',
      filter: '2026-08-22',
    })).toBeNull();
  });

  test.each([
    '',
    'not-base64-json',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ d: '2026-02-30', i: 1 })).toString('base64url'),
    Buffer.from(JSON.stringify({ d: '2026-08-23', i: 0 })).toString('base64url'),
    'x'.repeat(257),
  ])('rejects malformed cursor %#', (cursor) => {
    expect(decodeDateIdCursor(cursor)).toBeNull();
  });
});
