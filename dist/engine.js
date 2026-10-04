export const SAMPLE = {
  title: '業務改善を「一度きり」で終わらせない。ネクストワークの挑戦',
  draft: '業務改善を「一度きり」で終わらせない。ネクストワークの挑戦\n\n企業の業務改善を支援する株式会社ネクストワーク。代表の田中氏に、継続的な改善の仕組みとAI活用について話を聞いた。\n\n同社の支援先では、月次レポートの作成時間を50%削減したという。田中氏は「すべてのお客様で効果を確認できました」と語る。導入すれば必ず成果が出る仕組みだ。\n\n同社はWeb上で作業状況を共有し、担当者が改善の進捗を把握できる環境を整えている。AIは報告書の下書きを作成し、担当者は内容の確認に集中する。\n\n田中氏は「AIにすべてを任せるのではなく、人が判断する時間をつくることが大切です」と話す。今後はユーザー毎の課題に合わせて、支援の幅を広げていく方針だ。',
  transcript: '[架空の取材サンプル／2026年9月15日]\n\n編集者：導入後にどのような変化がありましたか。\n田中：ある支援先では、月次レポートの作成時間を30%削減できました。\n田中：一部のお客様で効果を確認できました。ただし、導入すれば必ず成果が出るわけではありません。業務の内容や運用によって結果は異なります。\n\n編集者：具体的な仕組みを教えてください。\n田中：ウェブ上で作業状況を共有して、担当者が改善の進捗を把握できるようにしています。AIは報告書の下書きを作成します。内容は必ず担当者が確認しています。\n\n編集者：AIを活用する上で大切なことは何でしょうか。\n田中：AIにすべてを任せるのではなく、人が判断する時間をつくることが大切です。\n田中：今後も、ユーザーごとの課題に合わせて支援の幅を広げていきたいと考えています。',
  rules: '【サンプル用編集ルール：実際の媒体規定ではありません】\n表記：Web → ウェブ\n表記：毎 → ごと\n・文体は「だ・である調」で統一する。\n・発言の引用は、話者の意図と限定条件を保つ。\n・効果や成果を断定するときは、取材資料に根拠があるか確認する。\n・固有名詞・数値は取材資料と照合する。'
};

export function segments(text, prefix = 'T') {
  return text.split(/\n|(?<=。)/u).map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: `${prefix}${i + 1}`, text }));
}
function grams(text) {
  const clean = text.replace(/[\s\p{P}\p{S}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) => clean.slice(i, i + 2)));
}
function similarity(a, b) {
  const x = grams(a), y = grams(b);
  const intersection = [...x].filter(s => y.has(s)).length;
  return intersection / Math.max(1, Math.min(x.size, y.size));
}
function nearest(text, sources) {
  return sources.map(s => ({ ...s, score: similarity(text, s.text) })).sort((a, b) => b.score - a.score)[0];
}
function normalizeNumbers(text) { return text.normalize('NFKC').match(/\d+(?:[,.]\d+)*(?:%|万|億|円|分|時間|件|人|倍|年|月|日)?/g) || []; }
function sentenceRanges(text) {
  const matches = [...text.matchAll(/[^。\n]+[。]?/gu)];
  return matches.map(m => ({ text: m[0], start: m.index }));
}
function bind(finding, draft) {
  const start = draft.indexOf(finding.quote);
  const unique = start >= 0 && draft.indexOf(finding.quote, start + 1) < 0;
  return { ...finding, start, end: start + finding.quote.length, unique, status: 'pending', suggestion: finding.suggestion || '', id: finding.id || `finding-${Math.random().toString(36).slice(2, 10)}` };
}

export function localReview(draft, transcript, rules) {
  const findings = [], sources = segments(transcript);
  const lines = segments(rules, 'R');
  for (const rule of lines) {
    const match = rule.text.match(/^表記[：:]\s*(.+?)\s*(?:→|=>)\s*(.+)$/);
    if (!match || match[1] === match[2]) continue;
    const from = match[1].trim(), to = match[2].trim();
    if (!from || !to || !draft.includes(from)) continue;
    // Use sentence anchors so repeated tokens can be reviewed independently.
    for (const sentence of sentenceRanges(draft)) {
      if (!sentence.text.includes(from)) continue;
      findings.push({ category: '表記', title: `「${from}」の表記を統一`, explanation: '入力された編集ルールと異なる表記です。文脈を確認して採用してください。', quote: sentence.text, sourceId: rule.id, evidence: rule.text, sourceType: 'rule', suggestion: sentence.text.split(from).join(to), severity: 'style' });
    }
  }
  for (const match of draft.matchAll(/「([^「」]+)」/gu)) {
    const quoted = match[1];
    if (quoted.length < 8 || transcript.includes(quoted)) continue;
    const source = nearest(quoted, sources);
    findings.push({ category: '引用', title: '引用文が文字起こしと一致しません', explanation: '完全一致によるチェックです。編集上の言い換えか、発言の意味が変わっていないかを確認してください。', quote: match[0], sourceId: source?.score >= .2 ? source.id : '', evidence: source?.score >= .2 ? source.text : '', sourceType: 'transcript', suggestion: '', severity: 'check' });
  }
  for (const sentence of sentenceRanges(draft)) {
    const nums = normalizeNumbers(sentence.text);
    if (!nums.length) continue;
    const source = nearest(sentence.text, sources);
    if (!source || source.score < .35) continue;
    const sourceNums = normalizeNumbers(source.text);
    const missing = nums.filter(n => !sourceNums.includes(n));
    if (!missing.length || !sourceNums.length) continue;
    const suggestion = nums.length === 1 && sourceNums.length === 1 ? sentence.text.replace(nums[0], sourceNums[0]) : '';
    findings.push({ category: '数値', title: '関連する取材発言と数値が異なります', explanation: `原稿の「${missing.join('・')}」が、語句の近い取材発言の数値と一致しません。同じ事例を指しているか確認してください。`, quote: sentence.text, sourceId: source.id, evidence: source.text, sourceType: 'transcript', suggestion, severity: 'check' });
  }
  return findings.map((f, i) => bind({ ...f, id: `local-${i}` }, draft));
}

export function validateAIFindings(items, draft, transcript, rules) {
  if (!Array.isArray(items) || items.length > 40) throw new Error('AIの結果形式を確認できませんでした。もう一度実行してください。');
  const sources = [...segments(transcript), ...segments(rules, 'R')];
  let rejected = 0;
  const findings = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.quote !== 'string' || !item.quote || !draft.includes(item.quote) || typeof item.title !== 'string' || typeof item.explanation !== 'string' || typeof item.suggestion !== 'string') { rejected++; continue; }
    if (!['引用', '数値', '表記', '文意', '構成', '文体'].includes(item.category) || !['check', 'style'].includes(item.severity)) { rejected++; continue; }
    if (item.quote.length > 2000 || item.title.length > 150 || item.explanation.length > 1500 || item.suggestion.length > 3000) { rejected++; continue; }
    const source = sources.find(s => s.id === item.source_id);
    // A citation is usable only when both its ID and its literal text are real.
    if (!source || typeof item.evidence !== 'string' || !item.evidence || !source.text.includes(item.evidence)) { rejected++; continue; }
    if (findings.some(f => f.quote === item.quote && f.category === item.category)) continue;
    findings.push(bind({ category: item.category, title: item.title, explanation: item.explanation, quote: item.quote, suggestion: item.suggestion, evidence: item.evidence, sourceId: source.id, sourceType: source.id.startsWith('R') ? 'rule' : 'transcript', severity: item.severity, id: `ai-${findings.length}` }, draft));
  }
  return { findings, rejected };
}

export function revisedDraft(original, findings) {
  const accepted = findings.filter(f => f.status === 'accepted').sort((a, b) => b.start - a.start);
  let result = original, lastStart = original.length;
  for (const f of accepted) {
    if (!f.unique || f.start < 0 || f.end > lastStart || original.slice(f.start, f.end) !== f.quote || !f.suggestion.trim()) throw new Error('修正箇所が重複しているか、元の原稿と一致しません。');
    result = result.slice(0, f.start) + f.suggestion + result.slice(f.end);
    lastStart = f.start;
  }
  return result;
}

export function acceptanceError(finding, findings) {
  if (!finding.unique) return '同じ文章が複数あるため、自動反映できません。書き出した原稿で個別に修正してください。';
  if (!finding.suggestion.trim()) return '採用する修正案を入力してください。';
  if (findings.some(f => f.id !== finding.id && f.status === 'accepted' && finding.start < f.end && finding.end > f.start)) return '採用済みの修正と箇所が重複しています。先の修正を取り消してから採用してください。';
  return '';
}

// Assemble a proposal from literal, non-overlapping corrections; never rewrite untouched text.
export function proposedRevision(original, findings) {
  const chosen=[],skipped=[];
  for(const f of findings){
    const insideQuote=/「[^」]*」|『[^』]*』/g;
    const quoteRanges=[...original.matchAll(insideQuote)];
    const changesDirectQuote=f.sourceType==='rule'&&quoteRanges.some(m=>f.start<m.index+m[0].length&&f.end>m.index);
    if(changesDirectQuote||acceptanceError(f,chosen.map(c=>({...c,status:'accepted'})))||original.slice(f.start,f.end)!==f.quote){skipped.push(f.id);continue;}
    chosen.push(f);
  }
  return {article:revisedDraft(original,chosen.map(f=>({...f,status:'accepted'}))),applied:chosen.map(f=>f.id),skipped};
}
