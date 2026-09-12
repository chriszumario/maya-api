import * as v from 'valibot';
import { LocalDateSchema, NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';

const mealType = v.picklist(['breakfast', 'lunch', 'dinner', 'snack', 'drink']);
const name = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.transform((value) => value[0].toUpperCase() + value.slice(1).toLowerCase()),
  v.maxLength(200),
);
const quantity = v.pipe(v.number(), v.gtValue(0), v.maxValue(1_000_000));
const unit = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.transform((value) => value[0].toUpperCase() + value.slice(1).toLowerCase()),
  v.maxLength(50),
);
const fields = {
  mealType,
  name,
  quantity,
  unit,
  calories: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(100_000)),
};

const response = v.object({
  id: v.number(),
  userId: v.number(),
  localDate: LocalDateSchema,
  ...fields,
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const NutritionModel = {
  create: v.object({
    mealType: fields.mealType,
    name,
    quantity,
    unit,
    calories: fields.calories,
  }),
  update: v.pipe(
    v.partial(v.object(fields)),
    v.check((value) => Object.keys(value).length > 0, 'Debe incluir al menos un campo')
  ),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(256))),
    date: v.optional(LocalDateSchema),
  }),
  response,
  responses: v.array(response),
  page: v.object({ items: v.array(response), nextCursor: v.nullable(v.string()) }),
  deletedResponse: v.object({ id: v.number() }),
  paramsId: v.object({ id: NumericIdSchema }),
} as const;

export type NutritionModel = {
  [K in keyof typeof NutritionModel]: v.InferOutput<(typeof NutritionModel)[K]>;
};
