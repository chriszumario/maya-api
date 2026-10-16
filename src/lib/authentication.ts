import { Elysia } from 'elysia'
import { jwt } from '@elysia/jwt'
import * as v from 'valibot'
import { env } from './env'
import { failure } from './api'
import { db } from '@/db/drizzle'

export const ACCESS_TOKEN_EXP = '30m'

const jwtSchema = v.object({
  userId: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  tokenVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
})

export const authentication = new Elysia({
  name: 'authentication',
})
  .use(
    jwt({
      name: 'jwt',
      secret: env.JWT_SECRET,
      exp: ACCESS_TOKEN_EXP,
    }),
  )
  .macro({
    isAuthenticated: {
      async derive({ jwt, headers, set, status }) {
        set.headers['cache-control'] = 'private, no-store'
        const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

        if (!bearer) {
          return status(401, failure('UNAUTHORIZED', 'No autorizado'))
        }

        const verified = await jwt.verify(bearer, {
          algorithms: ['HS256'],
          requiredClaims: ['exp', 'iat'],
        })

        const claims = v.safeParse(jwtSchema, verified)
        if (!claims.success) {
          return status(401, failure('INVALID_TOKEN', 'Token inválido o expirado'))
        }
        const payload = claims.output

        const user = await db.query.users.findFirst({
          where: { id: payload.userId },
          columns: {
            id: true,
            isActive: true,
            isAdmin: true,
            tokenVersion: true,
          },
        })

        if (!user?.isActive || user.tokenVersion !== payload.tokenVersion) {
          return status(401, failure('UNAUTHORIZED', 'No autorizado'))
        }

        return {
          userId: user.id,
          authenticatedUser: user,
        }
      },
    },
  })
  .macro({
    isAdmin: {
      isAuthenticated: true,
      async derive({ authenticatedUser, status }) {
        if (!authenticatedUser.isAdmin) {
          return status(403, failure('FORBIDDEN', 'Acceso restringido a administradores'))
        }
      },
    },
  })
