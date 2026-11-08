import { z } from "zod";

/**
 * Declarative domain definition: the single source of truth that the zod schema,
 * JSON Schema, MCP tool schemas and framework-neutral tool contracts are generated from.
 * Add a field here and every generated surface follows (see contracts.ts).
 */

export type ContentPrimitiveName = "query" | "mutate" | "validate";

export interface StringFieldDefinition {
  name: string;
  kind: "string";
  /** Trim whitespace before checking constraints. */
  trim?: boolean;
  /** Minimum length, checked after trimming. */
  minLength?: number;
  /** Actionable message reported when minLength fails. */
  minLengthMessage?: string;
  pattern?: RegExp;
  /** Actionable message reported when pattern fails. */
  patternMessage?: string;
}

export type FieldDefinition = StringFieldDefinition;

export interface DomainDefinition {
  /** Kebab-case singular name, used for ids such as the schema resource. */
  name: string;
  /** Human noun used in tool titles and descriptions, e.g. "handbook page". */
  noun: string;
  /** Wire property names for one resource and a list of them, e.g. "page" / "pages". */
  slots: { one: string; many: string };
  /** Field that uniquely identifies one resource (a field name below). */
  keyField: string;
  /** URIs for the generated resources. */
  resources: {
    schemaUri: string;
    instanceTemplate: string;
    /** Read-only change journal of mutate calls (query parameters `since` and `limit` are appended). */
    journalUri: string;
  };
  fields: readonly StringFieldDefinition[];
  /** Which content primitives apply to this domain. */
  primitives: readonly ContentPrimitiveName[];
}

/** Union of a domain's field names, e.g. "title" | "slug" | "body". */
export type FieldName<D extends DomainDefinition> = D["fields"][number]["name"];

/** The draft type of a domain's resource, derived from its field list. */
export type ResourceOf<D extends DomainDefinition> = Record<FieldName<D>, string>;

export function defineDomain<const D extends DomainDefinition>(definition: D): D {
  const names = new Set<string>();
  for (const field of definition.fields) {
    if (names.has(field.name)) {
      throw new Error(`Domain "${definition.name}" declares field "${field.name}" twice.`);
    }
    names.add(field.name);
  }
  if (!names.has(definition.keyField)) {
    throw new Error(
      `Domain "${definition.name}" keyField "${definition.keyField}" is not one of its fields: ${[...names].join(", ")}.`,
    );
  }
  return definition;
}

function fieldToZod(field: FieldDefinition): z.ZodType<string> {
  let schema = z.string();
  if (field.trim) {
    schema = schema.trim();
  }
  if (field.minLength !== undefined) {
    schema = schema.min(field.minLength, field.minLengthMessage);
  }
  if (field.pattern) {
    schema = schema.regex(field.pattern, field.patternMessage);
  }
  return schema;
}

/** Shape of one resource draft ({ title, slug, body } for handbook pages), strict. */
export function buildResourceShape<D extends DomainDefinition>(
  domain: D,
): Record<FieldName<D>, z.ZodType<string>> {
  return Object.fromEntries(
    domain.fields.map((field) => [field.name, fieldToZod(field)]),
  ) as Record<FieldName<D>, z.ZodType<string>>;
}

/** Shape of a stored resource: the draft fields plus the server-assigned revision. */
export function buildStoredShape(
  domain: DomainDefinition,
  options: { describeRevision?: boolean } = {},
): Record<string, z.ZodType<string>> {
  const revision = z.string();
  return {
    ...Object.fromEntries(
      domain.fields.map((field) => [field.name, z.string()] as const),
    ),
    revision: options.describeRevision
      ? revision.describe(
          `Content hash of the stored ${domain.slots.one}; changes whenever the ${domain.slots.one} changes.`,
        )
      : revision,
  };
}
