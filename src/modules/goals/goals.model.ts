import * as v from 'valibot';
import { NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';
import { TaskModel } from '@/modules/tasks/tasks.model';

const category = v.picklist(['growth', 'experience', 'contribution']);
const priority = v.picklist(['low', 'medium', 'high']);
const status = v.picklist(['pending', 'in_progress', 'completed', 'cancelled']);

const fields = {
  title: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(200)),
  motivation: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(4000)),
  category,
  priority,
  status,
};

const response = v.object({
  id: v.number(),
  userId: v.number(),
  title: v.string(),
  motivation: v.string(),
  category,
  priority,
  status,
  startDate: v.nullable(v.string()),
  endedAt: v.nullable(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const reviewResponse = v.object({
  id: v.number(),
  goalId: v.number(),
  localDate: v.string(),
  whatWorked: v.string(),
  whatDidNotWork: v.string(),
  nextActions: v.string(),
  continueGoal: v.boolean(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const GoalsModel = {
  create: v.object({
    title: fields.title,
    motivation: fields.motivation,
    category,
    priority,
  }),
  update: v.pipe(
    v.partial(v.object(fields)),
    v.check((value) => Object.keys(value).length > 0, 'Debe incluir al menos un campo')
  ),
  reviewCreate: v.object({
    whatWorked: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
    whatDidNotWork: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
    nextActions: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000)),
    continueGoal: v.boolean(),
  }),
  response,
  responses: v.array(response),
  page: v.object({ items: v.array(response), nextCursor: v.nullable(v.string()) }),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(2_048))),
  }),
  deletedResponse: v.object({ id: v.number() }),
  detailResponse: v.object({
    ...response.entries,
    tasks: v.array(TaskModel.response),
    reviews: v.array(reviewResponse),
  }),
  reviewResponse,
  reviewResponses: v.array(reviewResponse),
  reviewPage: v.object({ items: v.array(reviewResponse), nextCursor: v.nullable(v.string()) }),
  reviewQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(2_048))),
  }),
  paramsId: v.object({ id: NumericIdSchema }),
} as const;

export type GoalsModel = {
  [K in keyof typeof GoalsModel]: v.InferOutput<(typeof GoalsModel)[K]>;
};
