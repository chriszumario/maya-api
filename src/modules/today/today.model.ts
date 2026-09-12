import * as v from 'valibot';
import { LocalDateSchema } from '@/lib/schemas';

const nonNegativeNumber = v.pipe(v.number(), v.minValue(0));
const taskStatus = v.picklist(['pending', 'in_progress', 'completed']);

const task = v.object({
  id: v.number(),
  title: v.string(),
  estimatedMinutes: nonNegativeNumber,
  startTime: v.string(),
  goalTitle: v.string(),
  status: taskStatus,
  durationMinutes: nonNegativeNumber,
});

export const TodayModel = {
  response: v.object({
    date: LocalDateSchema,
    tasks: v.array(task),
  }),
} as const;

export type TodayModel = {
  [K in keyof typeof TodayModel]: v.InferOutput<(typeof TodayModel)[K]>;
};
