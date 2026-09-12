import * as v from 'valibot';
import { LocalDateSchema, NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';

const status = v.picklist(['in_progress', 'completed']);
const durationMinutes = v.pipe(
  v.number(),
  v.safeInteger(),
  v.minValue(0),
  v.maxValue(1440),
);
const response = v.object({
  id: v.number(),
  taskId: v.number(),
  localDate: LocalDateSchema,
  status,
  durationMinutes,
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const TaskLogsModel = {
  create: v.object({
    taskId: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    status,
    durationMinutes,
  }),
  update: v.pipe(
    v.partial(v.object({ status, durationMinutes })),
    v.check((value) => Object.keys(value).length > 0, 'Debe incluir al menos un campo')
  ),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(256))),
    date: v.optional(LocalDateSchema),
  }),
  response,
  page: v.object({ items: v.array(response), nextCursor: v.nullable(v.string()) }),
  paramsId: v.object({ id: NumericIdSchema }),
} as const;

export type TaskLogsModel = {
  [K in keyof typeof TaskLogsModel]: v.InferOutput<(typeof TaskLogsModel)[K]>;
};
