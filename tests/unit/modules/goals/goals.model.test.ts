import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { GoalsModel } from '@/modules/goals/goals.model';

describe('GoalsModel', () => {
  test('rejects a title below the minimum length', () => {
    expect(v.safeParse(GoalsModel.create, {
      title: 'Go',
      motivation: 'Valid motivation',
      category: 'growth',
      priority: 'high',
    }).success).toBe(false);
  });

  test('does not accept lifecycle fields on create or update', () => {
    const created = v.parse(GoalsModel.create, {
      title: 'Run a marathon',
      motivation: 'Improve my health',
      category: 'growth',
      priority: 'high',
      status: 'completed',
      startDate: '1999-01-01',
      endedAt: '1999-01-02',
    });
    const updated = v.parse(GoalsModel.update, {
      title: 'Run a faster marathon',
      startDate: '1999-01-01',
      endedAt: '1999-01-02',
    });

    expect(created).not.toHaveProperty('status');
    expect(created).not.toHaveProperty('startDate');
    expect(created).not.toHaveProperty('endedAt');
    expect(updated).not.toHaveProperty('startDate');
    expect(updated).not.toHaveProperty('endedAt');
  });
});
