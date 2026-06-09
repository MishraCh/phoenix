import OpenAI from "openai";
import { env } from "./src/config/env.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

async function test() {
  try {
    const res = await (client as any).responses.create({
      model: "gpt-4.1",
      input: [
        { role: "user", content: "test" }
      ],
    });
    console.log(res);
  } catch (e) {
    console.error(e);
  }
}

test();
