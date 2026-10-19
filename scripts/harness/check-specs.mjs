#!/usr/bin/env node
// 仕様書（docs/specs/*.md）の「完了条件」が、誰が判定しても同じ結果になる形で書かれているかを検査する。
// 問題があれば「どこが・何が・どう直すか」を出力し、終了コード1で終わる。依存パッケージなし。
// 配布元: daily-useful-tools/.claude/skills/repo-harness（python 版 check_specs.py と同じ規則）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPEC_DIR = "docs/specs";
const SKIP_FILES = new Set(["README.md", "_TEMPLATE.md"]);
const DONE_HEADING = /^##\s*完了条件/;
const ANY_HEADING = /^#{1,2}\s/;
const CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/;
const CODE_SPAN = /`[^`]+`/;
// 判定する人によって結果が変わる言葉。完了条件には使わない。
const VAGUE_WORDS = [
  "適切",
  "十分",
  "なるべく",
  "いい感じ",
  "ちゃんと",
  "しっかり",
  "問題なく",
  "正しく",
  "きれいに",
  "スムーズ",
];
const GOOD_EXAMPLE =
  "- [ ] `npm test` が終了コード0で終わる / - [ ] `dist/index.html` が生成される";

/**
 * @param {string} rootDir リポジトリのルート
 * @returns {{ file: string, line: number, problem: string, fix: string }[]}
 */
export function checkSpecs(rootDir) {
  const specDir = join(rootDir, SPEC_DIR);
  if (!existsSync(specDir)) {
    return [
      {
        file: SPEC_DIR,
        line: 0,
        problem: "仕様書フォルダがない",
        fix: `\`${SPEC_DIR}/\` を作り、機能ごとの仕様書を置く（repo-harness の install.mjs を --apply で再実行すると雛形が入る）`,
      },
    ];
  }
  const problems = [];
  const files = readdirSync(specDir)
    .filter((name) => name.endsWith(".md") && !SKIP_FILES.has(name))
    .sort();
  for (const name of files) {
    problems.push(
      ...checkSpecFile(
        `${SPEC_DIR}/${name}`,
        readFileSync(join(specDir, name), "utf8"),
      ),
    );
  }
  return problems;
}

/**
 * @param {string} file 表示用の相対パス
 * @param {string} text 仕様書の本文
 */
export function checkSpecFile(file, text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => DONE_HEADING.test(line));
  if (start === -1) {
    return [
      {
        file,
        line: 0,
        problem: "「## 完了条件」の見出しがない",
        fix: `末尾に「## 完了条件」を追加し、判定方法つきのチェックボックスを1つ以上書く。例: ${GOOD_EXAMPLE}`,
      },
    ];
  }
  const problems = [];
  let items = 0;
  for (
    let i = start + 1;
    i < lines.length && !ANY_HEADING.test(lines[i]);
    i++
  ) {
    const match = CHECKBOX.exec(lines[i]);
    if (!match) continue;
    items++;
    const body = match[1].trim();
    const lineNo = i + 1;
    if (!CODE_SPAN.test(body)) {
      problems.push({
        file,
        line: lineNo,
        problem: `完了条件「${body}」に判定方法（コマンドやファイルパス）がない`,
        fix: `判定に使うコマンドか生成物のパスをバッククォートで囲んで書く。例: ${GOOD_EXAMPLE}`,
      });
    }
    const vague = VAGUE_WORDS.filter((word) =>
      body.replace(/`[^`]*`/g, "").includes(word),
    );
    if (vague.length > 0) {
      problems.push({
        file,
        line: lineNo,
        problem: `完了条件「${body}」に主観的な言葉（${vague.join("、")}）がある`,
        fix: "数値・終了コード・ファイルの有無・出力に含まれる文字列など、誰が見ても同じ結果になる基準に置き換える",
      });
    }
  }
  if (items === 0) {
    problems.push({
      file,
      line: start + 1,
      problem: "「## 完了条件」にチェックボックスの項目がない",
      fix: `「- [ ] 」で始まる項目を1つ以上書く。例: ${GOOD_EXAMPLE}`,
    });
  }
  return problems;
}

/** @param {{ file: string, line: number, problem: string, fix: string }[]} problems */
export function formatProblems(problems) {
  if (problems.length === 0) return "仕様書チェック: 問題なし";
  const blocks = problems.map(
    (p) =>
      `✖ ${p.line > 0 ? `${p.file}:${p.line}` : p.file}\n  問題: ${p.problem}\n  直し方: ${p.fix}`,
  );
  return [
    ...blocks,
    "",
    `仕様書チェック: ${problems.length}件の問題があります。各「直し方」を適用してから \`node scripts/harness/check-specs.mjs\` を再実行してください。`,
    `書き方の詳細: ${SPEC_DIR}/README.md`,
  ].join("\n");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootDir = resolve(fileURLToPath(import.meta.url), "../../..");
  const problems = checkSpecs(rootDir);
  const output = formatProblems(problems);
  if (problems.length > 0) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}
