import * as v from 'valibot';
import { LocalDateSchema, NumericIdSchema, NumericQuerySchema } from '@/lib/schemas';

const mood = v.picklist(['excellent', 'good', 'neutral', 'bad', 'terrible']);
const longText = v.pipe(v.string(), v.maxLength(10_000));
const fields = {
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  content: longText,
  mood,
  energyLevel: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(5)),
  gratitude: longText,
  wins: longText,
  lessons: longText,
  problems: longText,
  ideas: longText,
};

const response = v.object({
  id: v.number(),
  userId: v.number(),
  localDate: LocalDateSchema,
  ...fields,
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const JournalModel = {
  create: v.object({
    title: fields.title,
    content: fields.content,
    mood: fields.mood,
    energyLevel: fields.energyLevel,
    gratitude: fields.gratitude,
    wins: fields.wins,
    lessons: fields.lessons,
    problems: fields.problems,
    ideas: fields.ideas,
  }),
  update: v.pipe(
    v.partial(v.object(fields)),
    v.check((value) => Object.keys(value).length > 0, 'Debe incluir al menos un campo')
  ),
  listQuery: v.object({
    limit: v.optional(NumericQuerySchema(1, 100), '20'),
    cursor: v.optional(v.pipe(v.string(), v.maxLength(256))),
  }),
  response,
  page: v.object({ items: v.array(response), nextCursor: v.nullable(v.string()) }),
  deletedResponse: v.object({ id: v.number() }),
  paramsId: v.object({ id: NumericIdSchema }),
} as const;

export type JournalModel = {
  [K in keyof typeof JournalModel]: v.InferOutput<(typeof JournalModel)[K]>;
};
