// Duplicate candidate detection. Returns candidates *with reasons*; it never merges anything.
// Weak signals (shared mailbox, office main line, same name at another company) are surfaced as
// such so that 同姓同名 and 代表番号 do not look like the same person.
import { isMobileNumber, isSharedMailbox, normalizeCompany, normalizeEmail, normalizeName, normalizePhone, normalizeText } from './normalize';

export interface DuplicateProbe {
  fullName: string;
  fullNameKana?: string;
  company?: string;
  emails: string[];
  phones: string[];
}

export interface DuplicateSubject extends DuplicateProbe {
  id: string;
}

export type ReasonKind = 'email_exact' | 'shared_email' | 'mobile_exact' | 'office_phone_exact' | 'name_company_exact' | 'name_exact_other_company' | 'kana_company_exact';

export interface DuplicateReason {
  kind: ReasonKind;
  label: string;
  weight: number;
}

export interface DuplicateCandidate {
  subjectId: string;
  score: number;
  strength: 'strong' | 'possible' | 'weak';
  reasons: DuplicateReason[];
}

const LABEL: Record<ReasonKind, string> = {
  email_exact: 'メールアドレスが完全一致',
  shared_email: '共有アドレス（info@ 等）が一致：別人の可能性あり',
  mobile_exact: '携帯番号が一致',
  office_phone_exact: '代表/固定電話が一致：同じ会社の別人の可能性あり',
  name_company_exact: '氏名と会社名が一致',
  name_exact_other_company: '氏名のみ一致（会社が異なる）：転職または同姓同名の可能性',
  kana_company_exact: '読み仮名と会社名が一致（漢字表記ゆれの可能性）',
};
const WEIGHT: Record<ReasonKind, number> = {
  email_exact: 0.9,
  shared_email: 0.15,
  mobile_exact: 0.8,
  office_phone_exact: 0.15,
  name_company_exact: 0.75,
  name_exact_other_company: 0.35,
  kana_company_exact: 0.5,
};

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function findDuplicateCandidates(probe: DuplicateProbe, subjects: DuplicateSubject[], dismissedPairs: ReadonlySet<string> = new Set(), selfId?: string): DuplicateCandidate[] {
  const name = normalizeName(probe.fullName);
  const kana = normalizeText(probe.fullNameKana);
  const company = normalizeCompany(probe.company);
  const emails = probe.emails.map(normalizeEmail).filter(Boolean);
  const phones = probe.phones.map(normalizePhone).filter((p) => p.length >= 9);
  const out: DuplicateCandidate[] = [];

  for (const s of subjects) {
    if (s.id === selfId) continue;
    if (selfId && dismissedPairs.has(pairKey(selfId, s.id))) continue;
    const reasons: DuplicateReason[] = [];
    const add = (kind: ReasonKind) => reasons.push({ kind, label: LABEL[kind], weight: WEIGHT[kind] });
    const sEmails = new Set(s.emails.map(normalizeEmail));
    for (const e of emails) {
      if (sEmails.has(e)) {
        add(isSharedMailbox(e) ? 'shared_email' : 'email_exact');
        break;
      }
    }
    const sPhones = new Set(s.phones.map(normalizePhone));
    const shared = phones.filter((p) => sPhones.has(p));
    if (shared.some(isMobileNumber)) add('mobile_exact');
    else if (shared.length > 0) add('office_phone_exact');
    const sName = normalizeName(s.fullName);
    const sCompany = normalizeCompany(s.company);
    if (name && sName === name) {
      if (company && sCompany === company) add('name_company_exact');
      else add('name_exact_other_company');
    } else if (kana && company && normalizeText(s.fullNameKana) === kana && sCompany === company) {
      add('kana_company_exact');
    }
    if (reasons.length === 0) continue;
    // Noisy-OR keeps the score in 0..1 and lets independent signals reinforce each other.
    const score = 1 - reasons.reduce((acc, r) => acc * (1 - r.weight), 1);
    if (score < 0.15) continue;
    out.push({ subjectId: s.id, score: Math.round(score * 100) / 100, strength: score >= 0.75 ? 'strong' : score >= 0.4 ? 'possible' : 'weak', reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
