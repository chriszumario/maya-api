import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '@/db/drizzle';
import { refreshTokenRotations, refreshTokens, users } from '@/db/schema';
import {
  ApiError,
  constantTimeEqual,
  decryptRefreshRotationResult,
  deriveRefreshIdempotencyKey,
  encryptRefreshRotationResult,
  generateSecureToken,
  hashToken,
  newSessionId,
} from '@/lib';

const MAX_ACTIVE_SESSIONS = 10;
const HISTORY_RETENTION_DAYS = 30;
const REPLAY_WINDOW_SECONDS = 10;
const CONCURRENT_ROTATION_RETRIES = 40;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TokenPair = { accessToken: string; refreshToken: string };
type SignAccessToken = (payload: { userId: number; tokenVersion: number }) => Promise<string>;

const successorToken = alias(refreshTokens, 'successor_token');

function rotationAdditionalData(
  sourceTokenId: number,
  successorTokenId: number,
  familyId: string,
  idempotencyKeyHash: string,
): string {
  return `${sourceTokenId}:${successorTokenId}:${familyId}:${idempotencyKeyHash}`;
}

function isRetryableTransactionError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    messages.push(current instanceof Error ? `${current.name} ${current.message}` : String(current));
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|transaction.*conflict|write conflict|refresh_token_rotations.*(?:sourceTokenId|PRIMARY KEY)/i
    .test(messages.join(' '));
}

export abstract class RefreshTokenService {
  static async issue(userId: number, tx?: Transaction): Promise<string> {
    const rawToken = generateSecureToken();
    const issueInTransaction = async (executor: Transaction) => {
      await this.deleteExpiredRotations(executor);
      await this.deleteOldHistory(executor);
      await executor.insert(refreshTokens).values({
        userId,
        tokenHash: hashToken(rawToken),
        familyId: newSessionId(),
        expiresAt: sql`datetime('now', '+30 days')`,
      });
      await this.pruneExcessSessions(userId, executor);
    };

    if (tx) await issueInTransaction(tx);
    else await db.transaction(issueInTransaction);

    return rawToken;
  }

  static async rotate(
    rawToken: string,
    idempotencyKey: string | undefined,
    signAccessToken: SignAccessToken,
  ): Promise<TokenPair> {
    const tokenHash = hashToken(rawToken);
    const expectedIdempotencyKey = deriveRefreshIdempotencyKey(rawToken);
    const validIdempotencyKey = idempotencyKey !== undefined
      && /^[A-Za-z0-9_-]{43}$/.test(idempotencyKey)
      && constantTimeEqual(idempotencyKey, expectedIdempotencyKey);
    const idempotencyKeyHash = validIdempotencyKey ? hashToken(idempotencyKey) : undefined;

    for (let attempt = 0; attempt < CONCURRENT_ROTATION_RETRIES; attempt++) {
      try {
        const outcome = await db.transaction(async (tx) => this.rotateInTransaction(
          tx,
          tokenHash,
          idempotencyKeyHash,
          signAccessToken,
        ));

        if (outcome.kind === 'claim-lost') {
          await Bun.sleep(25);
          continue;
        }
        if (outcome.kind === 'invalid') {
          throw new ApiError(401, 'Refresh token inválido', 'INVALID_REFRESH_TOKEN');
        }
        if (outcome.kind === 'invalid-idempotency-key') {
          throw new ApiError(400, 'Idempotency-Key inválida o ausente', 'INVALID_IDEMPOTENCY_KEY');
        }
        if (outcome.kind === 'reuse') {
          throw new ApiError(401, 'Refresh token reutilizado; sesión invalidada', 'REFRESH_TOKEN_REUSE');
        }
        return outcome.result;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (!isRetryableTransactionError(error)) throw error;
        if (attempt === CONCURRENT_ROTATION_RETRIES - 1) break;
        await Bun.sleep(25);
      }
    }

    throw new ApiError(503, 'Rotación de refresh token en progreso', 'REFRESH_ROTATION_IN_PROGRESS');
  }

  private static async rotateInTransaction(
    tx: Transaction,
    tokenHash: string,
    idempotencyKeyHash: string | undefined,
    signAccessToken: SignAccessToken,
  ) {
    const [existing] = await tx
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        expired: sql<boolean>`${refreshTokens.expiresAt} <= CURRENT_TIMESTAMP`.mapWith(Boolean),
        isActive: users.isActive,
        tokenVersion: users.tokenVersion,
        rotationKeyHash: refreshTokenRotations.idempotencyKeyHash,
        encryptedResult: refreshTokenRotations.encryptedResult,
        replayActive: sql<boolean>`${refreshTokenRotations.replayExpiresAt} > CURRENT_TIMESTAMP`.mapWith(Boolean),
        successorTokenId: refreshTokenRotations.successorTokenId,
        successorRevokedAt: successorToken.revokedAt,
        successorExpired: sql<boolean>`${successorToken.expiresAt} <= CURRENT_TIMESTAMP`.mapWith(Boolean),
      })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .leftJoin(refreshTokenRotations, eq(refreshTokenRotations.sourceTokenId, refreshTokens.id))
      .leftJoin(successorToken, eq(successorToken.id, refreshTokenRotations.successorTokenId))
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!existing) return { kind: 'invalid' as const };

    if (existing.revokedAt) {
      if (
        idempotencyKeyHash !== undefined
        && existing.rotationKeyHash !== null
        && existing.rotationKeyHash !== undefined
        && constantTimeEqual(idempotencyKeyHash, existing.rotationKeyHash)
        && existing.replayActive
        && existing.successorTokenId !== null
        && existing.successorTokenId !== undefined
        && existing.successorRevokedAt === null
        && !existing.successorExpired
        && existing.isActive
        && existing.encryptedResult !== null
        && existing.encryptedResult !== undefined
      ) {
        const result = await decryptRefreshRotationResult(
          existing.encryptedResult,
          rotationAdditionalData(
            existing.id,
            existing.successorTokenId,
            existing.familyId,
            idempotencyKeyHash,
          ),
        );
        return { kind: 'success' as const, result };
      }

      await this.revokeFamily(existing.familyId, tx);
      return { kind: 'reuse' as const };
    }

    if (existing.expired) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)));
      return { kind: 'invalid' as const };
    }

    if (!existing.isActive) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(refreshTokens.familyId, existing.familyId), isNull(refreshTokens.revokedAt)));
      return { kind: 'invalid' as const };
    }

    if (!idempotencyKeyHash) return { kind: 'invalid-idempotency-key' as const };

    const [claimed] = await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });

    if (!claimed) return { kind: 'claim-lost' as const };

    const refreshToken = generateSecureToken();
    const [successor] = await tx
      .insert(refreshTokens)
      .values({
        userId: existing.userId,
        tokenHash: hashToken(refreshToken),
        familyId: existing.familyId,
        expiresAt: existing.expiresAt,
      })
      .returning({ id: refreshTokens.id });
    if (!successor) throw new Error('Refresh token successor was not inserted');

    const result = {
      accessToken: await signAccessToken({
        userId: existing.userId,
        tokenVersion: existing.tokenVersion,
      }),
      refreshToken,
    };
    const additionalData = rotationAdditionalData(
      existing.id,
      successor.id,
      existing.familyId,
      idempotencyKeyHash,
    );
    await tx.insert(refreshTokenRotations).values({
      sourceTokenId: existing.id,
      successorTokenId: successor.id,
      idempotencyKeyHash,
      encryptedResult: await encryptRefreshRotationResult(result, additionalData),
      replayExpiresAt: sql`datetime('now', ${`+${REPLAY_WINDOW_SECONDS} seconds`})`,
    });
    await this.deleteExpiredRotations(tx);
    await this.deleteOldHistory(tx);

    return {
      kind: 'success' as const,
      result,
    };
  }

  static async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (!existing) return;

      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(refreshTokens.familyId, existing.familyId), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });

      if (revoked.length > 0) {
        await this.deleteFamilyRotations(existing.familyId, tx);
        await tx
          .update(users)
          .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
          .where(eq(users.id, existing.userId));
      }
    });
  }

  static async revokeAllForUser(userId: number, tx: Transaction | typeof db = db): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    const tokens = await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    if (tokens.length > 0) {
      await tx.delete(refreshTokenRotations).where(inArray(
        refreshTokenRotations.sourceTokenId,
        tokens.map(({ id }) => id),
      ));
    }
  }

  static async getActiveSessions(
    userId: number
  ): Promise<Array<{ id: number; familyId: string; createdAt: string; expiresAt: string }>> {
    return db
      .select({
        id: refreshTokens.id,
        familyId: refreshTokens.familyId,
        createdAt: refreshTokens.createdAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`)
        )
      )
      .orderBy(desc(refreshTokens.createdAt));
  }

  static async countAllActiveSessions(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(refreshTokens)
      .where(
        and(isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`))
      );
    return result?.count ?? 0;
  }

  private static async pruneExcessSessions(userId: number, tx: Transaction): Promise<void> {
    const active = await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, sql`CURRENT_TIMESTAMP`)
        )
      )
      .orderBy(asc(refreshTokens.createdAt), asc(refreshTokens.id));

    if (active.length <= MAX_ACTIVE_SESSIONS) return;

    const overflowIds = active.slice(0, active.length - MAX_ACTIVE_SESSIONS).map((row) => row.id);
    await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(inArray(refreshTokens.id, overflowIds));
  }

  private static async deleteOldHistory(tx: Transaction): Promise<void> {
    await tx.delete(refreshTokens).where(
      or(
        and(
          isNotNull(refreshTokens.revokedAt),
          lt(refreshTokens.revokedAt, sql`datetime('now', ${`-${HISTORY_RETENTION_DAYS} days`})`),
        ),
        lt(refreshTokens.expiresAt, sql`datetime('now', ${`-${HISTORY_RETENTION_DAYS} days`})`),
      ),
    );
  }

  private static async deleteExpiredRotations(tx: Transaction): Promise<void> {
    await tx
      .delete(refreshTokenRotations)
      .where(lte(refreshTokenRotations.replayExpiresAt, sql`CURRENT_TIMESTAMP`));
  }

  private static async revokeFamily(familyId: string, tx: Transaction): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
    await this.deleteFamilyRotations(familyId, tx);
  }

  private static async deleteFamilyRotations(familyId: string, tx: Transaction): Promise<void> {
    const tokens = await tx
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId));
    if (tokens.length > 0) {
      await tx.delete(refreshTokenRotations).where(inArray(
        refreshTokenRotations.sourceTokenId,
        tokens.map(({ id }) => id),
      ));
    }
  }
}
