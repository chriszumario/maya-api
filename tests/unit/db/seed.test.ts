import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { db } from '@/db/drizzle';
import { seed } from '@/db/seed';
import { users } from '@/db/schema';
import { verifyPassword } from '@/lib/crypto';
import { env } from '@/lib/env';

afterEach(() => mock.restore());

function mockPrompts(answers: (string | null)[]) {
  let index = 0;
  return spyOn(globalThis, 'prompt').mockImplementation(() => {
    if (index >= answers.length) throw new Error('Unexpected prompt');
    return answers[index++]!;
  });
}

function mockInsert(rows: { id: number }[] = [{ id: 1 }]) {
  const returning = mock(async () => rows);
  const onConflictDoNothing = mock(() => ({ returning }));
  const values = mock((_value: typeof users.$inferInsert) => ({ onConflictDoNothing }));
  const insert = spyOn(db, 'insert').mockReturnValue({ values } as never);
  return { insert, values, onConflictDoNothing, returning };
}

describe('database seed', () => {
  test.serial('creates an active user with normalized fields and a hashed password', async () => {
    const password = '  secure-password  ';
    mockPrompts(['  Ana Pérez  ', ' ANA@EXAMPLE.COM ', password, password, '']);
    const { insert, values, onConflictDoNothing } = mockInsert();
    const log = spyOn(console, 'log').mockImplementation(() => {});

    await seed();

    expect(insert).toHaveBeenCalledWith(users);
    expect(values).toHaveBeenCalledWith({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      passwordHash: expect.any(String),
      isAdmin: false,
      isActive: true,
      timezone: env.APP_TIMEZONE,
    });
    const saved = values.mock.calls[0]![0];
    expect(saved.passwordHash).not.toBe(password);
    expect(await verifyPassword(password, saved.passwordHash)).toBe(true);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('ID: 1 | Admin: no | Activo: sí');
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
    expect(JSON.stringify(log.mock.calls)).not.toContain(saved.passwordHash);
  });

  test.serial('creates an administrator only when explicitly requested', async () => {
    mockPrompts(['Ana', 'ana@example.com', 'secure-password', 'secure-password', ' S ']);
    const { values } = mockInsert();
    spyOn(console, 'log').mockImplementation(() => {});

    await seed();

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
  });

  test.serial.each([
    { name: 'A', email: 'ana@example.com', password: 'secure-password' },
    { name: 'A'.repeat(101), email: 'ana@example.com', password: 'secure-password' },
    { name: 'Ana', email: 'invalid-email', password: 'secure-password' },
    { name: 'Ana', email: `${'a'.repeat(250)}@example.com`, password: 'secure-password' },
    { name: 'Ana', email: 'ana@example.com', password: 'short' },
    { name: 'Ana', email: 'ana@example.com', password: 'a'.repeat(129) },
  ])('rejects invalid registration data before writing: %j', async ({ name, email, password }) => {
    mockPrompts([name, email, password]);
    const { insert } = mockInsert();

    await expect(seed()).rejects.toThrow('Datos inválidos');
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial.each([0, 1, 2, 3, 4])('cancels without writing at prompt %i', async (index) => {
    const answers: (string | null)[] = [
      'Ana',
      'ana@example.com',
      'secure-password',
      'secure-password',
      '',
    ];
    answers[index] = null;
    mockPrompts(answers);
    const { insert } = mockInsert();

    await expect(seed()).rejects.toThrow('Operación cancelada');
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial('rejects a mismatched password confirmation', async () => {
    mockPrompts(['Ana', 'ana@example.com', 'secure-password', 'another-password']);
    const { insert } = mockInsert();

    await expect(seed()).rejects.toThrow('Las contraseñas no coinciden');
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial('rejects an invalid administrator answer', async () => {
    mockPrompts(['Ana', 'ana@example.com', 'secure-password', 'secure-password', 'yes']);
    const { insert } = mockInsert();

    await expect(seed()).rejects.toThrow('Responde "s" o "n"');
    expect(insert).not.toHaveBeenCalled();
  });

  test.serial(
    'reports a duplicate email without claiming success or updating the account',
    async () => {
      mockPrompts(['Ana', 'ana@example.com', 'secure-password', 'secure-password', 's']);
      const { onConflictDoNothing } = mockInsert([]);
      const update = spyOn(db, 'update');
      const log = spyOn(console, 'log').mockImplementation(() => {});

      await expect(seed()).rejects.toThrow('Ya existe un usuario con ese email');
      expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  test.serial('reports database failures without exposing query details', async () => {
    mockPrompts(['Ana', 'ana@example.com', 'secure-password', 'secure-password', 'n']);
    const { returning } = mockInsert();
    returning.mockRejectedValue(new Error('query containing sensitive parameters'));
    const log = spyOn(console, 'log').mockImplementation(() => {});

    await expect(seed()).rejects.toThrow(
      'No se pudo crear el usuario. Revisa la conexión y las migraciones.',
    );
    expect(log).not.toHaveBeenCalled();
  });
});
