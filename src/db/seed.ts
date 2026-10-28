import * as v from 'valibot';
import { db } from './drizzle';
import { users } from './schema';
import { hashPassword } from '../lib/crypto';
import { env } from '../lib/env';
import { AuthModel } from '../modules/auth/auth.model';

function ask(question: string): string {
  const answer = prompt(question);
  if (answer === null) throw new Error('Operación cancelada. No se creó ningún usuario.');
  return answer;
}

export async function seed() {
  const result = v.safeParse(AuthModel.register, {
    name: ask('Nombre: '),
    email: ask('Email: '),
    password: ask('Contraseña (12–128 caracteres): '),
    timezone: env.APP_TIMEZONE,
  });
  if (!result.success) {
    const details = result.issues
      .map((issue) => `  - ${issue.path?.map((part) => part.key).join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Datos inválidos:\n${details}`);
  }

  const { name, email, password, timezone } = result.output;
  if (password !== ask('Confirmar contraseña: ')) {
    throw new Error('Las contraseñas no coinciden');
  }

  const adminAnswer = ask('¿Es administrador? (s/N): ').trim().toLowerCase();
  if (adminAnswer !== '' && adminAnswer !== 's' && adminAnswer !== 'n') {
    throw new Error('Responde "s" o "n"');
  }

  const isAdmin = adminAnswer === 's';
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash, isAdmin, isActive: true, timezone })
    .onConflictDoNothing()
    .returning({ id: users.id })
    .catch((cause: unknown) => {
      throw new Error('No se pudo crear el usuario. Revisa la conexión y las migraciones.', {
        cause,
      });
    });

  if (!user) {
    throw new Error('Ya existe un usuario con ese email. No se modificó su cuenta.');
  }

  console.log(`Usuario creado correctamente: ${email}`);
  console.log(`ID: ${user.id} | Admin: ${isAdmin ? 'sí' : 'no'} | Activo: sí`);
}

if (import.meta.main) {
  seed().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'No se pudo completar el seed.');
    process.exitCode = 1;
  });
}
