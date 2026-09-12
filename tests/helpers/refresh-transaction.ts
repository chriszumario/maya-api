import { mock } from 'bun:test';

export type ExistingRefreshToken = {
  id: number;
  userId: number;
  familyId: string;
  expiresAt: string;
  revokedAt: string | null;
  expired: boolean;
  isActive: boolean;
  tokenVersion: number;
  rotationKeyHash?: string | null;
  encryptedResult?: string | null;
  replayActive?: boolean;
  successorTokenId?: number | null;
  successorRevokedAt?: string | null;
  successorExpired?: boolean;
};

export function refreshTransaction(existing?: ExistingRefreshToken | ExistingRefreshToken[]) {
  const rows = Array.isArray(existing) ? existing : existing ? [existing] : [];
  const selected = () => ({
    limit: async () => rows,
    orderBy: async () => rows,
    then: (resolve: (value: ExistingRefreshToken[]) => unknown) => Promise.resolve(rows).then(resolve),
  });
  const joins = {
    innerJoin: () => joins,
    leftJoin: () => joins,
    where: selected,
  };
  const from = () => ({
    ...joins,
    orderBy: async () => rows,
  });
  const select = mock(() => ({ from }));
  const set = mock(() => ({
    where: () => ({ returning: async () => [{ id: rows[0]?.id }] }),
  }));
  const update = mock(() => ({ set }));
  const values = mock(() => ({
    returning: async () => [{ id: (rows[0]?.id ?? 1) + 1 }],
  }));
  const insert = mock(() => ({ values }));
  const whereDelete = mock(async () => undefined);
  const deleteRows = mock(() => ({ where: whereDelete }));

  return { tx: { select, update, insert, delete: deleteRows }, update, set, values, deleteRows };
}
