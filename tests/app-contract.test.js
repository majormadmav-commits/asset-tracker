import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the only Google scope is drive.file and the client id ships empty", () => {
  const main = readFileSync(new URL("../site/js/main.js", import.meta.url), "utf8");
  const drive = readFileSync(new URL("../site/js/drive-store.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../site/config.js", import.meta.url), "utf8");
  assert.match(main, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.doesNotMatch(main, /auth\/drive"/);
  assert.doesNotMatch(main, /auth\/drive\.readonly/);
  assert.doesNotMatch(main, /auth\/drive\.metadata/);
  assert.doesNotMatch(`${main}\n${drive}`, /googleapis\.com\/auth\/drive[^.file]/);
  assert.match(config, /GOOGLE_CLIENT_ID:\s*""/);
});
