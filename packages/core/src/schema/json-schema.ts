/**
 * Zod -> JSON Schema, in the shape strict structured output accepts.
 *
 * This used to be a hand-written walker over Zod's `_def.typeName`, which is
 * private runtime shape rather than public API. It worked, and then Zod 4
 * reorganised its internals and every conversion threw `unsupported Zod node
 * undefined`. Fifteen tests caught it; a production run would have caught it
 * as a 500 on the first request.
 *
 * So the conversion is now Zod's own, and this file owns only the part Zod
 * does not do: making the result strict. That division is the point. Walking
 * another library's internals is a standing bet that they will not change,
 * and it is a bet nobody wins twice.
 *
 * WHAT STRICT MODE DEMANDS, and why it is not merely a format detail:
 *
 * Every object needs `additionalProperties: false` and every property listed
 * in `required`. A schema generator marks a field with a default as optional,
 * which sounds harmless and is not: the model then omits the key, the parse
 * fills the default, and a resume ships with an empty summary that nobody
 * asked for and no error reported. A missing field and an empty field are
 * different bugs, and only one of them is visible downstream. Requiring
 * everything makes the model state its answer, including when the answer is
 * the empty string.
 *
 * Mirrors `strict_schema()` in backend/src/atsresume/llm.py.
 */

import type { z } from 'zod';
import { z as zod } from 'zod';

export interface JsonSchema {
  [key: string]: unknown;
}

/**
 * Keywords strict mode rejects outright.
 *
 * All of them are documentation. Dropping them costs nothing and keeps the
 * compiled grammar small, which matters: a wide schema full of annotations
 * gets refused with "the compiled grammar is too large", an error that reads
 * like a bug in your prompt rather than in your schema.
 */
const UNSUPPORTED_KEYWORDS = [
  'default',
  'format',
  '$schema',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'contentEncoding',
  'contentMediaType',
] as const;

/**
 * Make a plain JSON Schema strict, in place.
 *
 * Operates on the converted document rather than on Zod objects, so it is
 * indifferent to which version produced it, and testable without constructing
 * a schema at all.
 */
export function strictSchema<T extends object>(node: T): T {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as JsonSchema;

      if (obj['type'] === 'object' && 'properties' in obj) {
        obj['additionalProperties'] = false;
        obj['required'] = Object.keys(obj['properties'] as JsonSchema);
      }
      for (const keyword of UNSUPPORTED_KEYWORDS) delete obj[keyword];

      for (const v of Object.values(obj)) visit(v);
    }
  };

  visit(node);
  return node;
}

/**
 * Zod schema -> strict-mode JSON Schema.
 *
 * `io: 'output'` matters. A schema with defaults has two faces: the input
 * shape, where a defaulted field may be omitted, and the output shape, where
 * it is always present. The model is producing the output, so that is the
 * face it must be shown; asking for the input shape would describe fields as
 * optional that strictSchema then marks required, and the two would disagree.
 */
export function toJsonSchema(schema: z.ZodType, title?: string): JsonSchema {
  const converted = zod.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'output',
    // A resume schema is wide and repetitive. Inlining keeps it in one piece
    // rather than emitting $refs that strict mode has to resolve.
    reused: 'inline',
  }) as JsonSchema;

  if (title) converted['title'] = title;
  return strictSchema(converted);
}
