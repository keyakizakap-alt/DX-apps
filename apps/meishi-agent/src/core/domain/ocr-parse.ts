// Turns raw OCR lines from a Japanese business card into candidate fields. Pure heuristics:
// every field keeps the OCR text and a confidence, and anything below the threshold is left
// unverified for the human review screen (S06). Nothing here is treated as an instruction.
import type { CardField, CardFieldKey } from './schemas';
import { nfkc } from './normalize';

export interface OcrLine {
  text: string;
  /** Engine confidence 0..1 if available. */
  confidence?: number;
}

export const VERIFY_THRESHOLD = 0.85;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;
const PHONE = /(\+?\d[\d\s()-]{8,}\d)/;
const COMPANY = /(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|学校法人|医療法人|\(株\)|（株）|Inc\.?|Co\.,? ?Ltd\.?|Corporation|Corp\.|LLC|大学|研究所|協会|事務所|銀行|省|庁)/i;
const TITLE = /(代表取締役|取締役|執行役員|社長|副社長|会長|部長|次長|課長|係長|主任|主査|室長|所長|センター長|マネージャー|マネジャー|リーダー|ディレクター|エンジニア|コンサルタント|デザイナー|担当|Manager|Director|Engineer|CEO|CTO|COO|CFO|President|Lead|Officer|Specialist|教授|准教授|研究員)/i;
const DEPARTMENT = /(本部|事業部|部|課|室|グループ|チーム|センター|Division|Department|Dept\.|Group|Section|Unit|研究科|学部)/i;
const ADDRESS = /(〒\s?\d{3}-?\d{4}|東京都|北海道|大阪府|京都府|.{2,3}県|.+[市区町村]\S*\d)/;
const KANA_ONLY = /^[ぁ-ゖァ-ヺー\s　]+$/;
const LATIN_NAME = /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,2}$/;
const JA_NAME = /^[一-鿿々ぁ-ゖァ-ヺー]{1,6}[\s　]?[一-鿿々ぁ-ゖァ-ヺー]{1,6}$/;

function field(key: CardFieldKey, raw: string, value: string, ruleConfidence: number, ocrConfidence: number | undefined): CardField {
  const confidence = Math.round(Math.min(ruleConfidence, ocrConfidence ?? ruleConfidence) * 100) / 100;
  return { key, ocrValue: raw.slice(0, 400), value: value.slice(0, 400), confidence, source: 'ocr', verified: false };
}

/** OCR engines often insert spaces inside e-mail addresses and URLs ("taro. yamada@example. com"). */
export function tidyLine(raw: string): string {
  let text = nfkc(raw).replace(/\s+/g, ' ').trim();
  if (/@/.test(text) || /^(https?:|www\.)/i.test(text)) {
    text = text.replace(/\s*([.@_\-/:])\s*/g, '$1');
    const at = text.match(/[^\s]+@[^\s]+/);
    if (at) text = text.replace(at[0], at[0].toLowerCase());
  }
  return text;
}

function stripLabel(text: string): string {
  return text.replace(/^(tel|phone|電話|携帯|mobile|mob|fax|ファクス|e-?mail|mail|メール|url|web|t|m|f|e)\s*[.:：]?\s*/i, '').trim();
}

export function parseCardText(lines: OcrLine[]): CardField[] {
  const fields: CardField[] = [];
  const used = new Set<number>();
  const clean = lines.map((l) => ({ ...l, text: tidyLine(l.text) })).filter((l) => l.text.length > 0);

  clean.forEach((line, i) => {
    const text = line.text;
    const email = text.match(EMAIL);
    if (email) {
      fields.push(field('email', text, email[0].toLowerCase(), 0.95, line.confidence));
      used.add(i);
    }
    const url = !email && text.match(URL_RE);
    if (url) {
      fields.push(field('url', text, url[0], 0.9, line.confidence));
      used.add(i);
    }
    const phone = text.match(PHONE);
    if (phone && !email) {
      const label = text.toLowerCase();
      const kind: CardFieldKey = /fax|ファクス|ＦＡＸ|f[.:：]/i.test(label) ? 'fax' : /携帯|mobile|mob|m[.:：]|^0[789]0/.test(label) || /^0[789]0/.test(stripLabel(text)) ? 'mobile' : 'phone';
      fields.push(field(kind, text, stripLabel(phone[1] ?? phone[0]).trim(), 0.9, line.confidence));
      used.add(i);
    }
  });

  clean.forEach((line, i) => {
    if (used.has(i)) return;
    const text = line.text;
    if (ADDRESS.test(text) && /\d/.test(text)) {
      fields.push(field('address', text, text, 0.8, line.confidence));
      used.add(i);
    } else if (COMPANY.test(text) && !fields.some((f) => f.key === 'company')) {
      fields.push(field('company', text, text, 0.85, line.confidence));
      used.add(i);
    }
  });

  clean.forEach((line, i) => {
    if (used.has(i)) return;
    const text = line.text;
    const hasTitle = TITLE.test(text);
    const hasDept = DEPARTMENT.test(text);
    if (hasTitle && hasDept) {
      // "営業本部 第一営業部 部長" → split the trailing title
      const m = text.match(new RegExp(`^(.*?)[\\s　]*(${TITLE.source})$`, 'i'));
      if (m && m[1]) {
        fields.push(field('department', text, m[1].trim(), 0.7, line.confidence));
        fields.push(field('title', text, text.slice(m[1].length).trim(), 0.7, line.confidence));
      } else {
        fields.push(field('title', text, text, 0.6, line.confidence));
      }
      used.add(i);
    } else if (hasTitle && text.length <= 30) {
      fields.push(field('title', text, text, 0.8, line.confidence));
      used.add(i);
    } else if (hasDept && text.length <= 40) {
      fields.push(field('department', text, text, 0.75, line.confidence));
      used.add(i);
    }
  });

  // Name: a short, unlabeled kanji/kana line; kana / romanised lines become the reading.
  clean.forEach((line, i) => {
    if (used.has(i)) return;
    const text = line.text;
    if (!fields.some((f) => f.key === 'fullNameKana') && (KANA_ONLY.test(text) || LATIN_NAME.test(text)) && text.length <= 30) {
      fields.push(field('fullNameKana', text, text, 0.6, line.confidence));
      used.add(i);
    } else if (!fields.some((f) => f.key === 'fullName') && JA_NAME.test(text)) {
      fields.push(field('fullName', text, text, 0.7, line.confidence));
      used.add(i);
    }
  });
  if (!fields.some((f) => f.key === 'fullName')) {
    const latin = fields.find((f) => f.key === 'fullNameKana' && LATIN_NAME.test(f.value));
    if (latin) fields.push({ ...latin, key: 'fullName', confidence: 0.5 });
  }
  return fields;
}

export function fieldValue(fields: CardField[], key: CardFieldKey): string | undefined {
  return fields.find((f) => f.key === key)?.value || undefined;
}

export function needsVerification(f: CardField): boolean {
  return !f.verified && (f.confidence ?? 0) < VERIFY_THRESHOLD;
}
