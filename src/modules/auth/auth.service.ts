import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/drizzle';
import { users } from '@/db/schema';
import { ApiError, dummyPasswordVerify, hashPassword, verifyPassword } from '@/lib';
import type { AuthModel } from './auth.model';
import { RefreshTokenService } from './refresh-token.service';

type RegisterInput = AuthModel['register'];
type LoginInput = AuthModel['login'];
type ProfileInput = AuthModel['profileUpdate'];
type PasswordInput = AuthModel['passwordUpdate'];

type AuthUser = {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  timezone: string;
};

const PUBLIC_USER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  isAdmin: users.isAdmin,
  timezone: users.timezone,
} as const;

export abstract class AuthService {
  static async register(data: RegisterInput): Promise<void> {
    await db.insert(users).values({
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      timezone: data.timezone,
    }).onConflictDoNothing();
  }

  static async login(data: LoginInput) {
    const [user] = await db
      .select({
        ...PUBLIC_USER_COLUMNS,
        isActive: users.isActive,
        passwordHash: users.passwordHash,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (!user) {
      await dummyPasswordVerify(data.password);
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    if (!(await verifyPassword(data.password, user.passwordHash))) {
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new ApiError(403, 'Tu cuenta está pendiente de aprobación', 'PENDING_APPROVAL');
    }

    const session = await db.transaction(async (tx) => {
      const [currentUser] = await tx
        .select({ tokenVersion: users.tokenVersion })
        .from(users)
        .where(and(
          eq(users.id, user.id),
          eq(users.passwordHash, user.passwordHash),
          eq(users.isActive, true),
        ))
        .limit(1);

      if (!currentUser) return undefined;
      const refreshToken = await RefreshTokenService.issue(user.id, tx);
      return { refreshToken, tokenVersion: currentUser.tokenVersion };
    });

    if (!session) {
      throw new ApiError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
    }

    const publicUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      timezone: user.timezone,
    };

    return { user: publicUser, ...session };
  }

  static async getUserById(userId: number): Promise<AuthUser> {
    const [user] = await db
      .select(PUBLIC_USER_COLUMNS)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
    }

    return user;
  }

  static async updateProfile(userId: number, data: ProfileInput): Promise<AuthUser> {
    const changes: { name?: string; email?: string; timezone?: string } = {};
    let verifiedPasswordHash: string | undefined;

    if (data.name !== undefined) changes.name = data.name;
    if (data.timezone !== undefined) changes.timezone = data.timezone;

    if (data.email !== undefined) {
      const user = await db.query.users.findFirst({
        where: { id: userId },
        columns: { passwordHash: true },
      });

      if (!user) {
        throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
      }

      if (!data.currentPassword || !(await verifyPassword(data.currentPassword, user.passwordHash))) {
        throw new ApiError(400, 'La contraseña actual es incorrecta', 'INVALID_PASSWORD');
      }

      verifiedPasswordHash = user.passwordHash;
      changes.email = data.email;
    }

    const [updatedUser] = await db
      .update(users)
      .set(changes)
      .where(and(
        eq(users.id, userId),
        verifiedPasswordHash === undefined
          ? undefined
          : eq(users.passwordHash, verifiedPasswordHash),
      ))
      .returning(PUBLIC_USER_COLUMNS);

    if (!updatedUser) {
      if (verifiedPasswordHash !== undefined) {
        throw new ApiError(409, 'La contraseña cambió durante la solicitud', 'PASSWORD_CHANGED');
      }
      throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
    }

    return updatedUser;
  }

  static async updatePassword(userId: number, data: PasswordInput): Promise<void> {
    if (data.newPassword === data.currentPassword) {
      throw new ApiError(400, 'La nueva contraseña debe ser distinta a la actual', 'INVALID_PASSWORD');
    }

    const user = await db.query.users.findFirst({
      where: { id: userId },
      columns: { passwordHash: true },
    });

    if (!user) {
      throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');
    }

    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'La contraseña actual es incorrecta', 'INVALID_PASSWORD');
    }

    const newPasswordHash = await hashPassword(data.newPassword);

    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(and(eq(users.id, userId), eq(users.passwordHash, user.passwordHash)))
        .returning({ id: users.id });

      if (!updated) {
        throw new ApiError(409, 'La contraseña cambió durante la solicitud', 'PASSWORD_CHANGED');
      }

      await RefreshTokenService.revokeAllForUser(userId, tx);
    });
  }
}
