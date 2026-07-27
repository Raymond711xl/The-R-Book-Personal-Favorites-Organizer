import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryItemFromCard,
  mergeInventoryItems,
} from "../src/inventory.mjs";

const SYNTHETIC_NOTE_ID = "0123456789abcdef01234567";

test("extracts a note id and access token from profile card links", () => {
  assert.deepEqual(
    inventoryItemFromCard({
      href: `/explore/${SYNTHETIC_NOTE_ID}?xsec_token=token-1&xsec_source=pc_user`,
      title: "工具清单",
      author: "作者",
    }),
    {
      noteId: SYNTHETIC_NOTE_ID,
      title: "工具清单",
      type: "normal",
      author: "作者",
      xsecToken: "token-1",
      cover: null,
    },
  );
});

test("rejects inaccessible links and keeps the newest card data", () => {
  assert.equal(
    inventoryItemFromCard({
      href: `/explore/${SYNTHETIC_NOTE_ID}`,
      title: "没有令牌",
    }),
    null,
  );
  const items = mergeInventoryItems(
    [
      {
        noteId: SYNTHETIC_NOTE_ID,
        title: "旧标题",
        xsecToken: "old-token",
      },
    ],
    [
      {
        href: `/discovery/item/${SYNTHETIC_NOTE_ID}?xsec_token=new-token`,
        title: "新标题",
      },
    ],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "新标题");
  assert.equal(items[0].xsecToken, "new-token");
});
