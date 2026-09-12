import * as v from 'valibot';
import { isValidLocalDate, isValidTimeZone } from './date';

export const ApiFailureSchema = v.object({
  error: v.object({
    code: v.string(),
    message: v.string(),
  }),
});

export const LocalDateSchema = v.pipe(
  v.string(),
  v.isoDate(),
  v.check(isValidLocalDate, 'Debe ser una fecha real en formato YYYY-MM-DD')
);

export const LocalTimeSchema = v.pipe(
  v.string(),
  v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Debe tener formato HH:MM')
);

export const TimeZoneSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.maxLength(100),
  v.check(isValidTimeZone, 'Debe ser una zona horaria IANA válida'),
);

const integerFromString = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  v.pipe(
    v.string(),
    v.digits('Debe ser numérico'),
    v.toNumber(),
    v.safeInteger(),
    v.minValue(minimum),
    v.maxValue(maximum),
  );

export const NumericIdSchema = integerFromString(1);

export const NumericQuerySchema = integerFromString;
