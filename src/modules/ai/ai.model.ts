import * as v from 'valibot';

const journalField = v.picklist([
  'title',
  'content',
  'gratitude',
  'wins',
  'lessons',
  'problems',
  'ideas',
]);
const goalField = v.picklist(['title', 'motivation']);
const improvementText = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(2_000));
const journalTitle = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));
const journalText = v.pipe(v.string(), v.maxLength(10_000));
const goalTitle = v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(200));
const goalMotivation = v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(4_000));
const nutrient = v.pipe(
  v.number(),
  v.safeInteger(),
  v.minValue(0),
  v.maxValue(100_000)
);

export const AiModel = {
  improveJournal: v.object({
    field: journalField,
    text: improvementText,
  }),
  improveGoal: v.object({
    field: goalField,
    text: improvementText,
  }),
  estimateCalories: v.object({
    name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(200)),
    quantity: v.pipe(v.number(), v.gtValue(0), v.maxValue(1_000_000)),
    unit: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(50)),
    mealType: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50))),
  }),
  improvedJournal: v.variant('field', [
    v.object({ field: v.literal('title'), text: journalTitle }),
    ...(['content', 'gratitude', 'wins', 'lessons', 'problems', 'ideas'] as const).map(
      (field) => v.object({ field: v.literal(field), text: journalText })
    ),
  ]),
  improvedGoal: v.variant('field', [
    v.object({ field: v.literal('title'), text: goalTitle }),
    v.object({ field: v.literal('motivation'), text: goalMotivation }),
  ]),
  calories: v.object({
    calories: nutrient,
  }),
} as const;

export type AiModel = {
  [K in keyof typeof AiModel]: v.InferOutput<(typeof AiModel)[K]>;
};
