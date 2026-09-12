import { db } from '@/db/drizzle';
import { journalEntries } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { JournalModel } from './journal.model';
import {
  ApiError,
  beforeDateIdCursor,
  decodeDateIdCursor,
  getUserLocalDate,
  toDateIdCursorPage,
} from '@/lib';

type CreateJournalDTO = JournalModel['create'];
type UpdateJournalDTO = JournalModel['update'];

export abstract class JournalService {
  static async getById(userId: number, entryId: number) {
    const entry = await db.query.journalEntries.findFirst({
      where: { id: entryId, userId },
    });

    if (!entry) {
      throw new ApiError(404, 'Entrada de diario no encontrada', 'JOURNAL_NOT_FOUND');
    }

    return entry;
  }

  static async create(userId: number, data: CreateJournalDTO) {
    const localDate = await getUserLocalDate(userId);
    const [entry] = await db
      .insert(journalEntries)
      .values({ userId, localDate, ...data })
      .returning();

    return entry;
  }

  static async list(userId: number, limit: number, cursor?: string) {
    const cursorContext = { scope: 'journal' } as const;
    let where = eq(journalEntries.userId, userId);

    if (cursor) {
      const decoded = decodeDateIdCursor(cursor, cursorContext);
      if (!decoded) {
        throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
      }
      where = and(
        where,
        beforeDateIdCursor(
          { localDate: journalEntries.localDate, id: journalEntries.id },
          decoded
        )
      )!;
    }

    const rows = await db
      .select()
      .from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.localDate), desc(journalEntries.id))
      .limit(limit + 1);

    return toDateIdCursorPage(rows, limit, cursorContext);
  }

  static async update(userId: number, entryId: number, data: UpdateJournalDTO) {
    const [updated] = await db
      .update(journalEntries)
      .set(data)
      .where(
        and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId))
      )
      .returning();

    if (!updated) {
      throw new ApiError(404, 'Entrada de diario no encontrada', 'JOURNAL_NOT_FOUND');
    }

    return updated;
  }

  static async delete(userId: number, entryId: number) {
    const [deleted] = await db
      .delete(journalEntries)
      .where(
        and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId))
      )
      .returning({ id: journalEntries.id });

    if (!deleted) {
      throw new ApiError(404, 'Entrada de diario no encontrada', 'JOURNAL_NOT_FOUND');
    }

    return deleted;
  }
}
