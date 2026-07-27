import assert from "node:assert/strict";
import test from "node:test";

import { preferredImageUrl } from "../src/media.mjs";

test("prefers the full-resolution fileId image endpoint", () => {
  assert.equal(
    preferredImageUrl({
      fileId: "abc123",
      urlDefault: "https://example.com/scaled.jpg",
    }),
    "https://sns-img-qc.xhscdn.com/abc123",
  );
});
