import { db } from '@/db/drizzle';
import { ApiError } from './api';
import { computeLocalDate } from './date';

export async function getUserLocalDate(userId: number): Promise<string> {
  const user = await db.query.users.findFirst({
    where: { id: userId },
    columns: { timezone: true },
  });

  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
  }

  return computeLocalDate(user.timezone);
}
