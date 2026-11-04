import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { storage } from "../src/services/storage.js";
test("local file storage keeps bytes private and rejects path traversal", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tvet-files-"));
  try {
    const s = storage({ directory }),
      key = await s.put(Buffer.from("private-document"));
    assert.match(key, /^documents\//);
    assert.equal((await s.get(key)).toString(), "private-document");
    await assert.rejects(s.get("../../secret"), /Invalid storage object/);
    await s.remove(key);
    await assert.rejects(s.get(key));
    await s.remove(key);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Supabase storage adapter uploads privately and uses sixty-second signed access internally", async () => {
  const events = [];
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, process.env.STORAGE_BUCKET || "papers");
        return {
          async upload(key, bytes, options) {
            events.push(["upload", key, options]);
            return { error: null };
          },
          async createSignedUrl(key, seconds) {
            events.push(["sign", key, seconds]);
            return {
              data: { signedUrl: "https://example.test/temporary" },
              error: null,
            };
          },
          async remove(keys) {
            events.push(["remove", keys]);
            return { error: null };
          },
        };
      },
    },
  };
  const s = storage({ client });
  const key = await s.put(Buffer.from("bytes"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("private bytes");
    assert.equal((await s.get(key)).toString(), "private bytes");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await s.remove(key);
  assert.equal(events[0][2].upsert, false);
  assert.equal(events[1][2], 60);
  assert.equal(events[2][1][0], key);
});
