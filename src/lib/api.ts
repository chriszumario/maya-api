import { Elysia, HTTPError, NotFound, ValidationError } from 'elysia'
import { DrizzleQueryError } from 'drizzle-orm'
import { logger } from './logger'

export const failure = (code: string, message: string) => ({
  error: { code, message },
})

export class ApiError extends HTTPError<string> {
  readonly type: string

  constructor(
    readonly status: number,
    message: string,
    code: string,
  ) {
    super(message)
    this.type = code
  }
}

export const errorHandler = new Elysia({ name: 'error-handler' })
  .error(ApiError, ({ error, status }) =>
    status(error.status, failure(error.type, error.message))
  )
  .error(DrizzleQueryError, ({ error, status }) => {
    const causeMessage = error.cause instanceof Error ? error.cause.message : ''
    if (causeMessage.includes('users_email_unique')) {
      return status(400, failure('EMAIL_IN_USE', 'El correo ya está en uso'))
    }

    logger.error('Error de base de datos al procesar la solicitud', {
      errorType: error.constructor.name,
      causeType: error.cause instanceof Error ? error.cause.constructor.name : undefined,
    })

    return status(500, failure('INTERNAL_SERVER_ERROR', 'Ocurrió un error inesperado'))
  })
  .error(ValidationError, ({ status }) =>
    status(
      422,
      failure(
        'VALIDATION_ERROR',
        'La solicitud contiene datos inválidos'
      )
    )
  )
  .error(NotFound, ({ status }) =>
    status(404, failure('ROUTE_NOT_FOUND', 'Ruta no encontrada'))
  )
  .error(({ status }) => {
    return status(500, failure('INTERNAL_SERVER_ERROR', 'Ocurrió un error inesperado'))
  })
  .as('plugin')
