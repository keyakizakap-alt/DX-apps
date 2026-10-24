// Rule-based interpretation of the *user's* typed request (never of card or memo content).
// Runs on-device; produces structured intents that the PolicyGateway then authorises.
import type { SearchFilters } from '../domain/search';

export type AssistantIntent =
  | { kind: 'search'; filters: SearchFilters; explanation: string[] }
  | { kind: 'followups'; explanation: string[] }
  | { kind: 'duplicates'; explanation: string[] }
  | { kind: 'draft'; target: string; explanation: string[] }
  | { kind: 'summarize'; target: string; explanation: string[] }
  | { kind: 'unsupported'; explanation: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function dateRangeFor(text: string, today: Date): { from: string; to: string; label: string } | undefined {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (/先月/.test(text)) return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), label: '先月' };
  if (/今月/.test(text)) return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)), label: '今月' };
  if (/先週/.test(text)) {
    const day = (today.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(y, m, today.getDate() - day - 7);
    return { from: ymd(monday), to: ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)), label: '先週' };
  }
  if (/今週/.test(text)) {
    const day = (today.getDay() + 6) % 7;
    return { from: ymd(new Date(y, m, today.getDate() - day)), to: ymd(today), label: '今週' };
  }
  if (/昨日/.test(text)) {
    const d = new Date(y, m, today.getDate() - 1);
    return { from: ymd(d), to: ymd(d), label: '昨日' };
  }
  if (/今日/.test(text)) return { from: ymd(today), to: ymd(today), label: '今日' };
  const explicit = text.match(/(\d{4})年\s*(\d{1,2})月/);
  if (explicit) {
    const yy = Number(explicit[1]);
    const mm = Number(explicit[2]) - 1;
    return { from: ymd(new Date(yy, mm, 1)), to: ymd(new Date(yy, mm + 1, 0)), label: `${yy}年${mm + 1}月` };
  }
  const days = text.match(/(?:最近|直近|過去)\s*(\d{1,3})\s*日/);
  if (days) return { from: ymd(new Date(y, m, today.getDate() - Number(days[1]))), to: ymd(today), label: `直近${days[1]}日` };
  return undefined;
}

const STOPWORDS = /(先月|今月|先週|今週|昨日|今日|\d{4}年\s*\d{1,2}月|最近|直近|過去\s*\d+\s*日|で会った|に会った|会った|人を|人は|人|方|探して|探す|検索|教えて|一覧|誰|だれ|ください|して|を|の|は|が|に|で|と|？|\?|。|、)/g;

export function interpretRequest(raw: string, today: Date): AssistantIntent {
  const text = raw.normalize('NFKC').trim().slice(0, 300);
  if (!text) return { kind: 'unsupported', explanation: ['質問を入力してください'] };
  if (/(重複|ダブり|同じ人)/.test(text)) return { kind: 'duplicates', explanation: ['重複候補をルールで抽出します（統合はしません）'] };
  if (/(フォロー|連絡すべき|連絡したほうが|次に連絡|やること|タスク)/.test(text) && !/(文|メール)/.test(text)) {
    return { kind: 'followups', explanation: ['出会いメモとフォロー予定から優先度を計算します'] };
  }
  const draft = text.match(/(.+?)(?:さん|様|氏)?(?:へ|に|宛て?)の?(?:お礼|フォロー|御礼)?(?:メール|文|文面|文案)/);
  if (draft && /(メール|文案|文面|お礼)/.test(text)) {
    return { kind: 'draft', target: draft[1]!.replace(/(さん|様|氏)$/, '').trim(), explanation: ['端末内のテンプレートで下書きします（送信はしません）'] };
  }
  const summary = text.match(/(.+?)(?:さん|様|氏)?(?:の|との)(?:出会い|会話|経緯|メモ)?の?(?:要約|まとめ)/);
  if (summary) return { kind: 'summarize', target: summary[1]!.replace(/(さん|様|氏)$/, '').trim(), explanation: ['出会いメモを出典付きでまとめます'] };

  const filters: SearchFilters = {};
  const explanation: string[] = [];
  const range = dateRangeFor(text, today);
  if (range) {
    filters.metFrom = range.from;
    filters.metTo = range.to;
    explanation.push(`会った日: ${range.label}（${range.from}〜${range.to}）`);
  }
  const tag = text.match(/[#＃]([^\s#＃]+)|タグ[:：]\s*(\S+)/);
  if (tag) {
    filters.tag = tag[1] ?? tag[2];
    explanation.push(`タグ: ${filters.tag}`);
  }
  const event = text.match(/(?:の)?([^\s、。のにを]+?)(?:で|に)会った/);
  if (event && !/^(最近|先月|今月|先週|今週|昨日|今日)$/.test(event[1]!)) {
    filters.event = event[1];
    explanation.push(`イベント: ${event[1]}`);
  }
  const company = text.match(/([^\s、。]+?(?:株式会社|商事|銀行|大学|工業|製作所|システムズ?|ラボ))/);
  if (company) {
    filters.company = company[1];
    explanation.push(`会社: ${company[1]}`);
  }
  let rest = text.replace(tag?.[0] ?? '', ' ').replace(event?.[0] ?? '', ' ').replace(company?.[1] ?? '', ' ').replace(STOPWORDS, ' ').trim();
  rest = rest.replace(/\s+/g, ' ');
  if (rest) {
    filters.text = rest;
    explanation.push(`キーワード: ${rest}`);
  }
  if (explanation.length === 0) return { kind: 'unsupported', explanation: ['対応している質問: 「先月の展示会で会った人」「#タグ」「〇〇さんへのお礼メール」「フォローすべき人」「重複候補」'] };
  return { kind: 'search', filters, explanation };
}
