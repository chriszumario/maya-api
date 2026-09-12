import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { JournalModel } from '@/modules/journal/journal.model';

describe('JournalModel', () => {
  const completeEntry = {
    title: 'Mi día',
    content: 'Contenido',
    mood: 'good' as const,
    energyLevel: 4,
    gratitude: 'Mi familia',
    wins: 'Terminé una tarea',
    lessons: 'Descansar ayuda',
    problems: 'Una distracción',
    ideas: 'Automatizar el reporte',
  };

  test('requires every journal field on create', () => {
    for (const field of Object.keys(completeEntry) as Array<keyof typeof completeEntry>) {
      const { [field]: _, ...missingField } = completeEntry;

      expect(v.safeParse(JournalModel.create, missingField).success).toBe(false);
      expect(v.safeParse(JournalModel.create, { ...completeEntry, [field]: null }).success).toBe(false);
    }
  });

  test('does not accept localDate as part of the create contract', () => {
    const parsed = v.parse(JournalModel.create, {
      ...completeEntry,
      localDate: '1999-01-01',
    });

    expect(parsed).not.toHaveProperty('localDate');
  });

  test('rejects empty or out-of-range updates', () => {
    expect(v.safeParse(JournalModel.update, {}).success).toBe(false);
    expect(v.safeParse(JournalModel.update, { energyLevel: 6 }).success).toBe(false);
  });
});
