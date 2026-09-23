/**
 * Zod -> JSON Schema, in the shape Anthropic/OpenAI strict mode accepts.
 *
 * Mirrors `strict_schema()` in `backend/src/atsresume/llm.py`: after the schema
 * is produced, every object node gains `additionalProperties: false` and a
 * `required` list naming *all* of its properties. Defaults stay in the schema
 * as documentation but stop being a licence for the model to omit the key.
 *
 * The converter only covers the constructs the schemas in `./index.ts` use
 * (object, array, string, number, boolean, enum, nullable, default, optional).
 * Anything else throws rather than silently emitting a permissive schema.
 */

import { z } from 'zod';

export interface JsonSchema {
  [key: string]: unknown;
}

// Zod v3 keeps its runtime shape on `_def`, which is not part of the public
// types. One narrow escape hatch here beats `any` scattered through the walker.
interface ZodDefLike {
  typeName: string;
  [key: string]: unknown;
}

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = defOf(schema);

  switch (def.typeName) {
    case 'ZodDefault': {
      const inner = convert((def['innerType'] as z.ZodTypeAny));
      const getter = def['defaultValue'] as () => unknown;
      return { ...inner, default: getter() };
    }
    case 'ZodOptional':
    case 'ZodReadonly':
    case 'ZodBranded':
      return convert(def['innerType'] as z.ZodTypeAny);
    case 'ZodEffects':
      return convert(def['schema'] as z.ZodTypeAny);
    case 'ZodNullable': {
      const inner = convert(def['innerType'] as z.ZodTypeAny);
      const t = inner['type'];
      return { ...inner, type: Array.isArray(t) ? [...t, 'null'] : [t, 'null'] };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber': {
      const checks = (def['checks'] as Array<{ kind: string }>) ?? [];
      const isInt = checks.some((c) => c.kind === 'int');
      return { type: isInt ? 'integer' : 'number' };
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral':
      return { const: def['value'] };
    case 'ZodEnum':
      return { type: 'string', enum: [...(def['values'] as readonly string[])] };
    case 'ZodNativeEnum':
      return {
        type: 'string',
        enum: Object.values(def['values'] as Record<string, string>),
      };
    case 'ZodArray':
      return { type: 'array', items: convert(def['type'] as z.ZodTypeAny) };
    case 'ZodUnion':
      return {
        anyOf: (def['options'] as z.ZodTypeAny[]).map((o) => convert(o)),
      };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: convert(def['valueType'] as z.ZodTypeAny),
      };
    case 'ZodObject': {
      const shape = (def['shape'] as () => Record<string, z.ZodTypeAny>)();
      const properties: JsonSchema = {};
      for (const key of Object.keys(shape)) {
        const child = shape[key];
        if (child) properties[key] = convert(child);
      }
      return { type: 'object', properties };
    }
    default:
      throw new Error(`toJsonSchema: unsupported Zod node ${def.typeName}`);
  }
}

/**
 * The `strict_schema()` walker from llm.py, character for character in intent:
 * every `{"type": "object", "properties": {...}}` node gets
 * `additionalProperties: false` and `required` listing all property keys.
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
      for (const v of Object.values(obj)) visit(v);
    }
  };
  visit(node);
  return node;
}

/** Zod schema -> strict-mode JSON Schema. */
export function toJsonSchema(schema: z.ZodTypeAny, title?: string): JsonSchema {
  const out = convert(schema);
  if (title) out['title'] = title;
  return strictSchema(out);
}
