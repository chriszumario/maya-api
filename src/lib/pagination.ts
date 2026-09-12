import { and, eq, gt, lt, or, type SQL, type SQLWrapper } from 'drizzle-orm';
import * as v from 'valibot';
import { LocalDateSchema } from './schemas';

type DateIdCursor = {
  localDate: string;
  id: number;
};

export type CursorContext = {
  scope: string;
  filter?: string | null;
};

const DateIdCursorSchema = v.object({
  d: LocalDateSchema,
  i: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  s: v.optional(v.string()),
  f: v.optional(v.nullable(v.string())),
});

/**
 * Builds a page from rows fetched with `limit + 1`, ordered by
 * (localDate DESC, id DESC). nextCursor is stable when many rows share a date.
 */
export function toDateIdCursorPage<T extends { id: number; localDate: string }>(
  rows: T[],
  limit: number,
  context?: CursorContext,
) {
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items.at(-1) : undefined;

  return {
    items,
    nextCursor: last ? encodeDateIdCursor(last, context) : null,
  };
}

const encodeDateIdCursor = ({ localDate, id }: DateIdCursor, context?: CursorContext) =>
  Buffer.from(JSON.stringify({
    d: localDate,
    i: id,
    ...(context ? { s: context.scope, f: context.filter ?? null } : {}),
  })).toString('base64url');

export function decodeDateIdCursor(
  cursor: string,
  context?: CursorContext,
): DateIdCursor | null {
  try {
    if (cursor.length > 256) return null;

    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const decoded = v.safeParse(DateIdCursorSchema, value);

    if (!decoded.success) return null;
    if (context && (
      decoded.output.s !== context.scope
      || (decoded.output.f ?? null) !== (context.filter ?? null)
    )) return null;

    return { localDate: decoded.output.d, id: decoded.output.i };
  } catch {
    return null;
  }
}

type DateIdColumns = {
  localDate: SQLWrapper;
  id: SQLWrapper;
};

/** SQL filter: rows strictly before (localDate, id) in DESC order. */
export function beforeDateIdCursor(
  columns: DateIdColumns,
  cursor: DateIdCursor,
): SQL {
  return or(
    lt(columns.localDate, cursor.localDate),
    and(eq(columns.localDate, cursor.localDate), lt(columns.id, cursor.id)),
  )!;
}

type StringIdCursor = { value: string; id: number };

const StringIdCursorSchema = v.object({
  v: v.pipe(v.string(), v.nonEmpty(), v.maxLength(1_000)),
  i: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  s: v.string(),
  f: v.optional(v.nullable(v.string())),
});

export function toStringIdCursorPage<T extends { id: number }>(
  rows: T[],
  limit: number,
  value: (row: T) => string,
  context: CursorContext,
) {
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items.at(-1) : undefined;
  return {
    items,
    nextCursor: last
      ? Buffer.from(JSON.stringify({
          v: value(last),
          i: last.id,
          s: context.scope,
          f: context.filter ?? null,
        })).toString('base64url')
      : null,
  };
}

export function decodeStringIdCursor(
  cursor: string,
  context: CursorContext,
): StringIdCursor | null {
  try {
    if (cursor.length > 2_048) return null;
    const decoded = v.safeParse(
      StringIdCursorSchema,
      JSON.parse(Buffer.from(cursor, 'base64url').toString()),
    );
    if (!decoded.success) return null;
    if (
      decoded.output.s !== context.scope
      || (decoded.output.f ?? null) !== (context.filter ?? null)
    ) return null;
    return { value: decoded.output.v, id: decoded.output.i };
  } catch {
    return null;
  }
}

export function beforeStringIdCursor(
  columns: { value: SQLWrapper; id: SQLWrapper },
  cursor: StringIdCursor,
): SQL {
  return or(
    lt(columns.value, cursor.value),
    and(eq(columns.value, cursor.value), lt(columns.id, cursor.id)),
  )!;
}

export function afterStringIdCursor(
  columns: { value: SQLWrapper; id: SQLWrapper },
  cursor: StringIdCursor,
): SQL {
  return or(
    gt(columns.value, cursor.value),
    and(eq(columns.value, cursor.value), gt(columns.id, cursor.id)),
  )!;
}
