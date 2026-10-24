// Japanese-aware normalisation used by search and duplicate detection (on-device only).

const COMPANY_AFFIXES = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人', '特定非営利活動法人', '国立大学法人', '学校法人', '医療法人', '社会福祉法人',
  '(株)', '(有)', '(同)', 'inc.', 'inc', 'co.,ltd.', 'co., ltd.', 'co.,ltd', 'co ltd', 'ltd.', 'ltd', 'llc', 'corporation', 'corp.', 'corp', 'k.k.',
];

export function nfkc(text: string): string {
  return text.normalize('NFKC');
}

/** Katakana → hiragana so that 'ヤマダ' and 'やまだ' match. */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeText(text: string | undefined): string {
  if (!text) return '';
  return toHiragana(nfkc(text).toLowerCase()).replace(/[\s　・･]/g, '');
}

export function normalizeName(text: string | undefined): string {
  return normalizeText(text).replace(/[.,'"’]/g, '');
}

export function normalizeCompany(text: string | undefined): string {
  let out = nfkc(text ?? '').toLowerCase().replace(/[\s　]/g, ' ').trim();
  for (const affix of COMPANY_AFFIXES) out = out.split(affix).join(' ');
  return normalizeText(out);
}

export function normalizeEmail(text: string | undefined): string {
  return nfkc(text ?? '').trim().toLowerCase();
}

export function normalizePhone(text: string | undefined): string {
  const digits = nfkc(text ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+81')) return `0${digits.slice(3).replace(/^0/, '')}`;
  return digits.replace(/\+/g, '');
}

const SHARED_MAILBOX = /^(info|contact|sales|support|office|admin|hello|inquiry|toiawase|webmaster|pr|press|recruit|hr|soumu|eigyo)([.+_-]|@)/;
export function isSharedMailbox(email: string): boolean {
  return SHARED_MAILBOX.test(normalizeEmail(email));
}

export function isMobileNumber(phone: string): boolean {
  return /^0[789]0\d{8}$/.test(normalizePhone(phone));
}
