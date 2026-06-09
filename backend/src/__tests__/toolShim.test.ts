import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTool } from "../tools/toolShim.js";

describe("toolShim.createTool", () => {
  it("creates a tool with name/description/schema and an invoke that runs the fn with parsed input", async () => {
    const t = createTool(
      async (input: { x: number }) => ({ doubled: input.x * 2 }),
      { name: "double", description: "doubles x", schema: z.object({ x: z.number() }) },
    );
    expect(t.name).toBe("double");
    expect(t.description).toBe("doubles x");
    expect(await t.invoke({ x: 21 })).toEqual({ doubled: 42 });
  });

  it("validates input against the schema before calling the fn", async () => {
    const t = createTool(async () => ({ ok: true }), {
      name: "needsString",
      description: "x",
      schema: z.object({ s: z.string() }),
    });
    await expect(t.invoke({ s: 123 } as never)).rejects.toBeTruthy();
  });
});
