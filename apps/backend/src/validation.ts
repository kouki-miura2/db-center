import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import { charLength } from 'utils'
import { z } from 'zod'

import { AppError } from './error.ts'

/**
 * Route input validation: `zValidator` that turns a failure into an `invalid_input` error with
 * per-field messages. Schemas for request bodies use `z.strictObject` so unknown fields are
 * rejected, not silently dropped.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.issues.flatMap((issue) =>
          // An unknown field is reported once on its parent; report it on the field itself.
          issue.code === 'unrecognized_keys'
            ? issue.keys.map((key) => [[...issue.path, key].join('.'), 'この項目は指定できません'])
            : [[issue.path.join('.'), issue.message]],
        ),
      )
      throw new AppError('invalid_input', { fields })
    }
  })

/**
 * A string of at most `max` characters, counted with `charLength` (a `LIMITS.*MaxLength`), after
 * trimming surrounding whitespace. Add `.min(1)` for a required field.
 */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => charLength(value) <= max, `${max}文字以内で入力してください`)
