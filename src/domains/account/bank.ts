import { detect, institutions } from 'korean-account';
import { InputError } from '../settlement/amount';

// Issue-bank codes used for settlement and the corresponding CMS layouts.
// Reference behavior: Da-Moa/Backend, bank account normalization.
const names: Record<string, string> = {
    '002': 'KDB산업은행', '003': 'IBK기업은행', '004': 'KB국민은행', '007': '수협은행',
    '011': '농협', '020': '우리은행', '023': 'SC제일은행', '027': '한국씨티은행',
    '030': '수협중앙회', '031': 'iM뱅크', '032': '부산은행', '034': '광주은행',
    '035': '제주은행', '037': '전북은행', '039': '경남은행', '045': '새마을금고',
    '048': '신협', '050': '저축은행', '064': '산림조합', '071': '우체국', '081': '하나은행',
    '088': '신한은행', '089': '케이뱅크', '090': '카카오뱅크', '092': '토스뱅크',
    '209': '유안타증권', '218': 'KB증권', '227': '다올투자증권',
    '238': '미래에셋증권', '240': '삼성증권', '243': '한국투자증권', '247': 'NH투자증권',
    '261': '교보증권', '262': '아이엠증권', '263': '현대차증권', '264': '키움증권',
    '265': 'LS증권', '266': 'SK증권', '267': '대신증권', '269': '한화투자증권',
    '270': '하나증권', '271': '토스증권', '278': '신한투자증권', '279': 'DB증권',
    '280': '유진투자증권', '287': '메리츠증권',
};

export const accountBankName = (code: string) => names[code === '012' ? '011' : code] ?? code;

export const bankOptions = [
    // IBK 2026 개인금융 인사이트, 이용 중인 개인금융 주거래은행 (p. 7).
    '004', '092', '088', '090', '011', '020', '081', '089', '003',
    // 나머지 개인 계좌용 국내 은행. 한글 이름을 먼저 표시한다.
    '039', '034', '032', '007', '037', '035', '027', '031', '002', '023',
].map(value => ({ value, label: value === '011' ? 'NH농협은행' : accountBankName(value) }));

const grouping: Record<string, [RegExp, number[]][]> = {
    '002': [[/^(031|032|037)\d{11}$/, [3, 4, 4, 3]]],
    '003': [[/^\d{14}$/, [3, 6, 2, 3]]],
    '004': [[/^\d{14}$/, [6, 2, 6]]],
    '007': [[/^(1400|1410)\d{8}$/, [4, 4, 4]]],
    '032': [[/^104\d{10}$/, [3, 4, 4, 2]]],
    '081': [[/^402\d{11}$/, [3, 6, 5]]],
    '088': [[/^(230|223)\d{9}$/, [3, 3, 6]]],
    '089': [[/^(1102|1001)\d{8}$/, [4, 4, 4]]],
    '090': [[/^(\d355|3310)\d{9}$/, [4, 2, 7]]],
    '092': [[/^1000\d{8}$/, [4, 4, 4]], [/^300\d{9}$/, [4, 4, 4]]],
};

function catalogMatch(digits: string, codes: string[]) {
    const eligible = institutions.filter(item => codes.includes(item.code)).map(item => item.id);
    if (!eligible.length) return undefined;
    const [result] = detect(digits, { include: eligible, minScore: 7, limit: 1 });
    return result?.matchedPattern.template.replace(/-/g, '').length === digits.length ? result : undefined;
}

function format(digits: string, code: string) {
    if (/^01[016789]\d{7,8}$/.test(digits)) return digits;
    const sizes = grouping[code]?.find(([pattern]) => pattern.test(digits))?.[1];
    if (sizes) {
        let end = 0;
        return sizes.map(size => digits.slice(end, end += size)).join('-');
    }
    return catalogMatch(digits, [code === '081' ? '005' : code])?.formatted ?? digits;
}

export function normalizeAccount(bankCode: string, input: string, name: string) {
    if (!bankOptions.some(option => option.value === bankCode)) throw new InputError('목록에서 은행을 선택해 주세요.');
    const digits = input.replace(/[ -]/g, '');
    if (!/^[0-9]{1,16}$/.test(digits)) throw new InputError('계좌번호는 숫자 16자리 이내로 입력해 주세요.');
    const accountHolder = name.normalize('NFC').trim();
    if (!accountHolder || accountHolder.length > 40 || /[\p{Cc}\p{Cf}]/u.test(accountHolder)) {
        throw new InputError('예금주명을 확인해 주세요.');
    }
    const code = bankCode === '011' ? catalogMatch(digits, ['011', '012'])?.institution.code ?? bankCode : bankCode;
    return { bankCode: code, formattedAccountNumber: format(digits, code), accountHolder };
}
