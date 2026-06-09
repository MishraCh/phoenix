import type { ZodTypeAny, infer as zInfer } from "zod";

/**
 * Minimal tool contract — replaces @langchain/core/tools' StructuredToolInterface.
 * Only .invoke()/.name/.description/.schema are used anywhere in this codebase.
 */
export interface GideonTool {
  name: string;
  description: string;
  schema: ZodTypeAny;
  invoke(input: unknown): Promise<unknown>;
}

export type ToolFields = {
  name: string;
  description: string;
  schema: ZodTypeAny;
};

/**
 * Create a tool. Mirrors the LangChain `tool(fn, fields)` call shape the registry
 * already uses, but with no external dependency. Input is validated against the
 * schema before the function runs (LangChain did this too).
 */
export function createTool<Schema extends ZodTypeAny>(
  fn: (input: zInfer<Schema>) => Promise<unknown> | unknown,
  fields: ToolFields & { schema: Schema },
): GideonTool {
  return {
    name: fields.name,
    description: fields.description,
    schema: fields.schema,
    invoke: async (input: unknown) => {
      const parsed = fields.schema.parse(input) as zInfer<Schema>;
      return fn(parsed);
    },
  };
}
