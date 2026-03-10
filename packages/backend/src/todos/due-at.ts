export const MIN_DUE_AT_MS = 1_000_000_000_000
export const MAX_DUE_AT_MS = 8_640_000_000_000_000
export const MAX_SINGLE_TIMER_MS = 2_147_483_647

type DueAtValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

export function isValidDueAtMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= MIN_DUE_AT_MS
    && value <= MAX_DUE_AT_MS
}

export function parseAndValidateDueAt(value: unknown): DueAtValidationResult {
  if (value === undefined || value === null) {
    return { ok: false, error: 'dueAt is required' }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'dueAt must be a finite integer Unix epoch timestamp in milliseconds' }
  }
  if (!Number.isInteger(value)) {
    return { ok: false, error: 'dueAt must be an integer Unix epoch timestamp in milliseconds' }
  }
  if (value < MIN_DUE_AT_MS) {
    return { ok: false, error: 'dueAt must be Unix epoch milliseconds (13+ digits). Received a value that looks like seconds.' }
  }
  if (value > MAX_DUE_AT_MS) {
    return { ok: false, error: 'dueAt is out of supported Unix epoch millisecond range' }
  }
  return { ok: true, value }
}
