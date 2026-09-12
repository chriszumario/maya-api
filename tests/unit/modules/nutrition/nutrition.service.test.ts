import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { NutritionService } from '@/modules/nutrition/nutrition.service';
import { expectApiError } from '../../../helpers/assertions';

afterEach(() => mock.restore());

describe('NutritionService.list', () => {
  test('rejects an invalid cursor', async () => {
    await expectApiError(
      NutritionService.list(17, 20, 'invalid-cursor'),
      { status: 400, type: 'INVALID_CURSOR' }
    );
  });

  test('fetches limit plus one with a date so truncation is recoverable', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: 21 - index,
      localDate: '2026-09-05',
    }));
    const limit = mock(async () => rows);
    const orderBy = mock(() => ({ limit }));
    const where = mock(() => ({ orderBy }));
    const from = mock(() => ({ where }));
    spyOn(db, 'select').mockReturnValue({ from } as never);

    const page = await NutritionService.list(17, 20, undefined, '2026-09-05');

    expect(limit).toHaveBeenCalledWith(21);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeString();
  });
});
