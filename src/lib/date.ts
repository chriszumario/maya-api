import { Temporal } from 'temporal-polyfill'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidLocalDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false

  try {
    Temporal.PlainDate.from(value)
    return true
  } catch {
    return false
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(value)
    return true
  } catch {
    return false
  }
}

export const computeLocalDate = (timezone: string): string =>
  Temporal.Now.zonedDateTimeISO(timezone).toPlainDate().toString()

export const daysAgoLocalDate = (days: number, timezone: string) =>
  Temporal.Now.zonedDateTimeISO(timezone).toPlainDate().subtract({ days }).toString()

export function getCalendarParts(localDate: string) {
  const date = Temporal.PlainDate.from(localDate)
  return { date: date.toString(), dayOfWeek: date.dayOfWeek % 7, dayOfMonth: date.day }
}
