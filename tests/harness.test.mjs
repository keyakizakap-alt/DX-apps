// repo-harness の最小テスト。assert の失敗メッセージには必ず「直し方」を書く。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkSpecFile,
  checkSpecs,
  formatProblems,
} from "../scripts/harness/check-specs.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("docs/specs の仕様書はすべて客観的な完了条件を持つ", () => {
  const problems = checkSpecs(repoRoot);
  assert.equal(problems.length, 0, `\n${formatProblems(problems)}`);
});

test("判定方法つきの完了条件は合格する", () => {
  const spec =
    "# 例\n\n## 完了条件\n\n- [ ] `npm test` が終了コード0で終わる\n";
  const problems = checkSpecFile("docs/specs/example.md", spec);
  assert.deepEqual(
    problems,
    [],
    "正しい仕様書を不合格にしている。直し方: scripts/harness/check-specs.mjs の CHECKBOX / CODE_SPAN の正規表現を確認する",
  );
});

test("完了条件のない仕様書を検出し、直し方を出力する", () => {
  const dir = mkdtempSync(join(tmpdir(), "repo-harness-"));
  try {
    mkdirSync(join(dir, "docs", "specs"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "specs", "sample.md"),
      "# サンプル\n\n画面が正しく表示される\n",
    );
    const problems = checkSpecs(dir);
    assert.equal(
      problems.length,
      1,
      "完了条件の欠落を検出できていない。直し方: scripts/harness/check-specs.mjs の DONE_HEADING を確認する",
    );
    assert.match(
      formatProblems(problems),
      /直し方: /,
      "失敗メッセージに直し方が含まれていない。直し方: formatProblems が各問題の fix を出力しているか確認する",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
