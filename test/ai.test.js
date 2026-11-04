import { test } from "node:test";
import assert from "node:assert/strict";
import { AIClient } from "../src/services/ai.js";
test("Gemini adapter uses server-side headers, system instruction and conversation roles", async () => {
  let request;
  const ai = new AIClient({
    geminiKey: "synthetic-gemini-key",
    groqKey: "",
    fetcher: async (url, options) => {
      request = { url, options };
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "private internal reasoning" },
                { text: "Here is the explanation." },
              ],
            },
          },
        ],
      });
    },
  });
  const r = await ai.generate(
    [
      { role: "user", content: "Explain voltage" },
      { role: "assistant", content: "Voltage is potential difference." },
      { role: "user", content: "Give an example." },
    ],
    "gemini",
  );
  assert.equal(r.provider, "gemini");
  assert.equal(r.content, "Here is the explanation.");
  assert.equal(
    request.options.headers["x-goog-api-key"],
    "synthetic-gemini-key",
  );
  assert.ok(!request.url.includes("synthetic-gemini-key"));
  const b = JSON.parse(request.options.body);
  assert.equal(b.contents[1].role, "model");
  assert.ok(b.systemInstruction.parts[0].text.includes("StudyMate"));
  assert.equal(b.generationConfig.maxOutputTokens, 1500);
});
test("Groq adapter sends chat-completion history and bounded output", async () => {
  let request;
  const ai = new AIClient({
    geminiKey: "",
    groqKey: "synthetic-groq-key",
    fetcher: async (url, options) => {
      request = { url, options };
      return Response.json({
        choices: [{ message: { content: "A worked example." } }],
      });
    },
  });
  const r = await ai.generate(
    [{ role: "user", content: "Show an example" }],
    "groq",
  );
  assert.equal(r.provider, "groq");
  assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(
    request.options.headers.Authorization,
    "Bearer synthetic-groq-key",
  );
  const b = JSON.parse(request.options.body);
  assert.equal(b.messages[0].role, "system");
  assert.equal(b.max_completion_tokens, 1500);
});
test("automatic selection falls back on provider quota errors and labels the actual provider", async () => {
  const calls = [];
  const ai = new AIClient({
    geminiKey: "g",
    groqKey: "q",
    fetcher: async (url) => {
      calls.push(url);
      return url.includes("googleapis")
        ? Response.json({ error: "quota" }, { status: 429 })
        : Response.json({
            choices: [{ message: { content: "Fallback answer" } }],
          });
    },
  });
  const r = await ai.generate([{ role: "user", content: "Question" }]);
  assert.equal(calls.length, 2);
  assert.equal(r.provider, "groq");
  assert.equal(r.fallback, true);
});
test("explicit provider never silently switches, and missing/empty/error responses stay honest", async () => {
  let calls = 0;
  const ai = new AIClient({
    geminiKey: "g",
    groqKey: "q",
    fetcher: async () => {
      calls++;
      return Response.json(
        { error: "secret provider diagnostic" },
        { status: 429 },
      );
    },
  });
  await assert.rejects(
    ai.generate([{ role: "user", content: "Question" }], "gemini"),
    /quota\/model/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    new AIClient({ geminiKey: "", groqKey: "" }).generate([
      { role: "user", content: "Question" },
    ]),
    /not configured/,
  );
  const empty = new AIClient({
    geminiKey: "g",
    groqKey: "",
    fetcher: async () => Response.json({ candidates: [] }),
  });
  await assert.rejects(
    empty.generate([{ role: "user", content: "Question" }]),
    /rephrasing/,
  );
});
