import { describe, expect, it } from 'vitest';
import { DEMO_OCR_TEXTS } from '@/core/demo/fixtures';
import { findDuplicateCandidates } from '@/core/domain/duplicates';
import { normalizeCompany, normalizePhone, toHiragana } from '@/core/domain/normalize';
import { fieldValue, needsVerification, parseCardText } from '@/core/domain/ocr-parse';
import { Contact } from '@/core/domain/schemas';

const lines = (key: keyof typeof DEMO_OCR_TEXTS) => DEMO_OCR_TEXTS[key]!.map((text) => ({ text, confidence: 0.9 }));

describe('normalisation', () => {
  it('handles kana, full-width and company affixes', () => {
    expect(toHiragana('ヤマダ')).toBe('やまだ');
    expect(normalizeCompany('（株）テスト商事')).toBe(normalizeCompany('テスト商事株式会社'));
    expect(normalizePhone('+81 90-0000-6001')).toBe('09000006001');
    expect(normalizePhone('０９０－００００－６００１')).toBe('09000006001');
  });
});

describe('OCR field extraction (fictitious cards)', () => {
  it('extracts Japanese horizontal card fields and keeps OCR text separate', () => {
    const f = parseCardText(lines('horizontal'));
    expect(fieldValue(f, 'company')).toBe('テスト商事株式会社');
    expect(fieldValue(f, 'fullName')).toBe('架空 花子');
    expect(fieldValue(f, 'email')).toBe('hanako.kakuu@example.test');
    expect(fieldValue(f, 'mobile')).toBe('090-0000-1001');
    expect(fieldValue(f, 'phone')).toBe('03-0000-1000');
    expect(fieldValue(f, 'title')).toBe('部長');
    expect(fieldValue(f, 'department')).toBe('営業本部 第一営業部');
    expect(f.every((x) => x.source === 'ocr' && x.verified === false), 'OCR値が確認済みとして保存された。直し方: parseCardText は verified:false で返す').toBe(true);
    expect(f.find((x) => x.key === 'fullName')!.ocrValue).toBe('架空 花子');
  });
  it('repairs spaces that OCR inserts inside e-mail addresses', () => {
    const f = parseCardText([{ text: 'hanako. kakuu@exampLe. test', confidence: 0.71 }, { text: 'E-mail: taro .yamada @ dummy-bank. example' }]);
    expect(f.filter((x) => x.key === 'email').map((x) => x.value)).toEqual(['hanako.kakuu@example.test', 'taro.yamada@dummy-bank.example']);
  });
  it('low-confidence fields require verification', () => {
    const f = parseCardText(DEMO_OCR_TEXTS.horizontal!.map((text) => ({ text, confidence: 0.4 })));
    expect(f.every(needsVerification)).toBe(true);
  });
  it('handles an English card', () => {
    const f = parseCardText(lines('english'));
    expect(fieldValue(f, 'company')).toBe('Example Holdings Inc.');
    expect(fieldValue(f, 'email')).toBe('emily@example.com');
    expect(fieldValue(f, 'mobile')).toBe('+81 90-0000-6001');
  });
  it('treats an instruction printed on a card as plain data', () => {
    const f = parseCardText(lines('injection'));
    expect(f.find((x) => x.key === 'email')?.value).toBe('info@placeholder.example');
  });
});

describe('duplicate candidates (SEC-12)', () => {
  const subjects = [
    { id: 'c_1', fullName: '山田 一郎', company: 'ダミー銀行株式会社', emails: ['ichiro.yamada@dummy-bank.example'], phones: ['080-0000-2001'] },
    { id: 'c_2', fullName: '鈴木 美咲', company: 'プレースホルダー合同会社', emails: ['info@placeholder.example'], phones: ['03-0000-5000'] },
    { id: 'c_3', fullName: '佐藤 健二', company: 'テスト商事株式会社', emails: ['old@test-shoji.example'], phones: ['070-0000-4001'] },
  ];
  it('same name at a different company is only a weak/possible candidate (同姓同名)', () => {
    const [c] = findDuplicateCandidates({ fullName: '山田 一郎', company: '架空大学', emails: ['yamada@kakuu-u.example'], phones: ['06-0000-3000'] }, subjects);
    expect(c?.subjectId).toBe('c_1');
    expect(c?.strength, '同姓同名が強い候補になった。直し方: name_exact_other_company の重みを下げる').not.toBe('strong');
    expect(c?.reasons[0]?.kind).toBe('name_exact_other_company');
  });
  it('shared info@ mailbox and office line are weak signals', () => {
    const [c] = findDuplicateCandidates({ fullName: '高橋 翔', company: 'プレースホルダー合同会社', emails: ['info@placeholder.example'], phones: ['03-0000-5000'] }, subjects);
    expect(c?.strength).toBe('weak');
    expect(c?.reasons.map((r) => r.kind).sort()).toEqual(['office_phone_exact', 'shared_email']);
  });
  it('job change: same mobile number is a strong candidate', () => {
    const [c] = findDuplicateCandidates({ fullName: '佐藤 健二', company: 'モックシステムズ株式会社', emails: ['kenji.sato@mock-systems.example'], phones: ['070-0000-4001'] }, subjects);
    expect(c?.subjectId).toBe('c_3');
    expect(c?.strength).toBe('strong');
  });
  it('dismissed pairs are not suggested again', () => {
    const r = findDuplicateCandidates({ fullName: '山田 一郎', company: '架空大学', emails: [], phones: [] }, subjects, new Set(['c_1|c_9']), 'c_9');
    expect(r).toHaveLength(0);
  });
});

describe('schema validation', () => {
  it('rejects missing name and invalid e-mail', () => {
    const base = { id: 'c_' + '0'.repeat(24), type: 'contact', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, phones: [], tags: [], status: 'confirmed' };
    expect(Contact.safeParse({ ...base, fullName: '', emails: [] }).success).toBe(false);
    expect(Contact.safeParse({ ...base, fullName: '架空', emails: ['not-an-email'] }).success).toBe(false);
    expect(Contact.safeParse({ ...base, fullName: '架空', emails: [] }).success).toBe(true);
  });
});
