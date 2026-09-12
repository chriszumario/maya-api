import { db } from './drizzle'
import { users } from './schema'
import { hashPassword } from '../lib'

const ask = (question: string) => prompt(question)?.trim() ?? ''

const email = ask('Email: ').toLowerCase()
const password = prompt('Password: ') ?? ''
const passwordConfirmation = prompt('Confirmar password: ') ?? ''
const adminAnswer = ask('¿Es administrador? (s/N): ').toLowerCase()

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
	throw new Error('El email no es válido')
}

if (password.length < 12) {
	throw new Error('La contraseña debe tener al menos 12 caracteres')
}

if (password !== passwordConfirmation) {
	throw new Error('Las contraseñas no coinciden')
}

if (adminAnswer !== '' && adminAnswer !== 's' && adminAnswer !== 'n') {
	throw new Error('Responde "s" o "n"')
}

const isAdmin = adminAnswer === 's'
const [user] = await db.insert(users).values({
	email,
	passwordHash: await hashPassword(password),
	name: email.split('@')[0]!.slice(0, 100),
	isAdmin,
	isActive: true,
	timezone: 'America/La_Paz',
}).returning({ id: users.id })

console.log(`Usuario creado correctamente: ${email}`)
console.log(`ID: ${user!.id} | Admin: ${isAdmin ? 'sí' : 'no'} | Activo: sí`)
