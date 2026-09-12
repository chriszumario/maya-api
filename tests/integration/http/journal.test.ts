import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import app from '@/index';
import { db } from '@/db/drizzle';
import { JournalService } from '@/modules/journal/journal.service';
import { bearer, issueAccessToken, jsonRequest } from '../../helpers/http';

afterEach(() => mock.restore());

describe('HTTP journal', () => {
  test.serial('creates a distinct journal entry with status 201', async () => {
    spyOn(db.query.users, 'findFirst').mockResolvedValue({
      id: 17,
      isActive: true,
      isAdmin: false,
    } as never);
    const token = await issueAccessToken(17);
    const body = {
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
    const entry = {
      id: 21,
      userId: 17,
      localDate: '2026-09-05',
      ...body,
      createdAt: '2026-09-05 12:00:00',
      updatedAt: '2026-09-05 12:00:00',
    };
    const create = spyOn(JournalService, 'create').mockResolvedValue(entry);

    const response = await app.handle(jsonRequest(
      '/journal/',
      body,
      { headers: bearer(token) }
    ));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(17, body);
    expect(await response.json()).toEqual(entry);
  });
});
