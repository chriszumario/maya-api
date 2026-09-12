import * as v from 'valibot';
import { LocalTimeSchema, NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';
import { hasValidTaskSchedule, TASK_FREQUENCIES } from '@/lib/task-schedule';

const frequency = v.picklist(TASK_FREQUENCIES);

const taskFields = {
  title: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(200)),
  estimatedMinutes: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(1440)),
  startTime: LocalTimeSchema,
  frequency,
  recurrenceMask: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(20991231)),
  isActive: v.boolean(),
};

const response = v.object({
  id: v.number(),
  goalId: v.number(),
  title: v.string(),
  estimatedMinutes: v.number(),
  startTime: v.string(),
  frequency,
  recurrenceMask: v.number(),
  isActive: v.boolean(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const TaskModel = {
  createBody: v.pipe(
    v.object({
      title: taskFields.title,
      frequency: taskFields.frequency,
      estimatedMinutes: taskFields.estimatedMinutes,
      startTime: taskFields.startTime,
      recurrenceMask: v.optional(taskFields.recurrenceMask),
    }),
    v.check((task) => hasValidTaskSchedule(task), 'recurrenceMask no es válido para la frecuencia'),
  ),

  updateBody: v.pipe(
    v.partial(v.object(taskFields)),
    v.check((obj) => Object.keys(obj).length > 0, 'Debe incluir al menos un campo'),
  ),

  response,
  responses: v.array(response),
  page: v.object({ items: v.array(response), nextCursor: v.nullable(v.string()) }),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(2_048))),
  }),

  deletedResponse: v.object({ id: v.number() }),

  paramsId: v.object({ id: NumericIdSchema }),
} as const;

export type TaskModel = {
  [K in keyof typeof TaskModel]: v.InferOutput<(typeof TaskModel)[K]>;
};
