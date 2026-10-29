#!/usr/bin/env node
// Stop hook: 変更があるときだけ `npm test` を実行し、失敗したら終了コード2で停止を止めて Claude に直させる。
//
// - 変更なし（未コミットの差分も未 push のコミットも無い）なら何もしない
// - 依存パッケージ未インストールや Node のバージョン不一致など環境が原因の失敗は、停止を止めずに警告だけ出す
//   （終了コード1は非ブロッキング。直らない環境で停止を止め続けないため）
// - 連続ブロックの上限（既定8回）は Claude Code 側が持つ
//
// 仕様: https://code.claude.com/docs/ja/hooks#stop （参照日 2026-10-29）
// 終了コード2で停止を止め、stderr の内容が理由として Claude に返る。

import { spawnSync } from "node:child_process";

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
const count = (r) => (r.status === 0 ? Number(r.stdout.trim()) || 0 : null);

const dirty = git(["status", "--porcelain"]).stdout?.trim() !== "";
let ahead = count(git(["rev-list", "--count", "@{upstream}..HEAD"]));
if (ahead === null) ahead = count(git(["rev-list", "--count", "origin/HEAD..HEAD"])) ?? 0;
if (!dirty && ahead === 0) process.exit(0);

const r = spawnSync("npm", ["test"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status === 0) process.exit(0);

const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`;
const tail = out.split("\n").slice(-60).join("\n");

// 外部パッケージが見つからない・engines 不一致は環境の問題として扱う（自前の相対パス import の誤りは含めない）
if (/Cannot find package '[^./]|EBADENGINE|npm error notsup/.test(out)) {
  process.stderr.write(
    "npm test が環境の問題（依存パッケージ未インストール、または Node のバージョン不一致）で失敗した。" +
      "停止は止めない。CLAUDE.md の手順で環境を整えてから再実行し、結果を「未実行」または「失敗」として報告する。\n\n" + tail,
  );
  process.exit(1);
}

process.stderr.write(
  "npm test が失敗した（CLAUDE.md: 変更後は npm test を終了コード0で通してから完了と報告する）。" +
    "出力を読んで原因を直してから終える。テストを無効化・削除して通さない。\n\n" + tail,
);
process.exit(2);
