import { db } from '@/db/drizzle';
import { nutritionEntries } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { NutritionModel } from './nutrition.model';
import {
  ApiError,
  beforeDateIdCursor,
  decodeDateIdCursor,
  getUserLocalDate,
  toDateIdCursorPage,
} from '@/lib';

type CreateNutritionDTO = NutritionModel['create'];
type UpdateNutritionDTO = NutritionModel['update'];

export abstract class NutritionService {
  static async getById(userId: number, entryId: number) {
    const entry = await db.query.nutritionEntries.findFirst({
      where: { id: entryId, userId },
    });

    if (!entry) {
      throw new ApiError(
        404,
        'Registro de nutrición no encontrado',
        'NUTRITION_NOT_FOUND'
      );
    }

    return entry;
  }

  static async create(userId: number, data: CreateNutritionDTO) {
    const localDate = await getUserLocalDate(userId);
    const [entry] = await db
      .insert(nutritionEntries)
      .values({ userId, localDate, ...data })
      .returning();
    return entry;
  }

  static async list(userId: number, limit: number, cursor?: string, date?: string) {
    const cursorContext = { scope: 'nutrition', filter: date ?? null } as const;
    const decodedCursor = cursor ? decodeDateIdCursor(cursor, cursorContext) : null;
    if (cursor && !decodedCursor) {
      throw new ApiError(400, 'Cursor de paginación inválido', 'INVALID_CURSOR');
    }

    let where = date
      ? and(eq(nutritionEntries.userId, userId), eq(nutritionEntries.localDate, date))
      : eq(nutritionEntries.userId, userId);

    if (decodedCursor) {
      where = and(
        where,
        beforeDateIdCursor(
          { localDate: nutritionEntries.localDate, id: nutritionEntries.id },
          decodedCursor
        )
      )!;
    }

    const rows = await db
      .select()
      .from(nutritionEntries)
      .where(where)
      .orderBy(desc(nutritionEntries.localDate), desc(nutritionEntries.id))
      .limit(limit + 1);

    return toDateIdCursorPage(rows, limit, cursorContext);
  }

  static async update(
    userId: number,
    entryId: number,
    data: UpdateNutritionDTO
  ) {
    const [updated] = await db
      .update(nutritionEntries)
      .set(data)
      .where(
        and(eq(nutritionEntries.id, entryId), eq(nutritionEntries.userId, userId))
      )
      .returning();

    if (!updated) {
      throw new ApiError(
        404,
        'Registro de nutrición no encontrado',
        'NUTRITION_NOT_FOUND'
      );
    }

    return updated;
  }

  static async delete(userId: number, entryId: number) {
    const [deleted] = await db
      .delete(nutritionEntries)
      .where(
        and(eq(nutritionEntries.id, entryId), eq(nutritionEntries.userId, userId))
      )
      .returning({ id: nutritionEntries.id });

    if (!deleted) {
      throw new ApiError(
        404,
        'Registro de nutrición no encontrado',
        'NUTRITION_NOT_FOUND'
      );
    }

    return deleted;
  }
}
