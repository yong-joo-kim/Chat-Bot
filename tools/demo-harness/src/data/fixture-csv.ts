// ⑦ 고정 발화 CSV(설계 §7.8) — UTF-8 · 머리글 `발화,발생 횟수,출처 메모` · 200행(중복 0).
// 조합으로 만들어 저장소에 고정 파일(`fixtures/utterances-demo.csv`)로 커밋한다. 단위 시험이 이 함수 출력과 파일이 같은지 확인한다.
// 개인정보는 없다 — 단, 개인정보를 가린 줄(미리보기 항목 시연용) 2개만 가린 표시가 섞여 있다.

export const FIXTURE_HEADER = '발화,발생 횟수,출처 메모';

interface Group {
  name: string;
  count: number;
  heads: string[];
  tails: string[];
  memo: string;
}

const GROUPS: Group[] = [
  {
    name: '배송 지연',
    count: 35,
    heads: ['주문한 지 일주일이 지났는데', '어제 시킨 상품이', '택배가 아직', '배송 상태가 계속 그대로인데', '물건이 도착 예정일을 넘겼는데', '출고됐다고 했는데'],
    tails: ['도착하지 않았어요', '언제 오는지 알려 주세요', '어디쯤 왔는지 모르겠어요', '지연되는 이유가 궁금해요', '빨리 받을 수 있나요', '아무 연락이 없어요'],
    memo: '상담 녹취 1월',
  },
  {
    name: '환불 반품',
    count: 35,
    heads: ['받은 상품이 마음에 안 들어서', '사이즈가 맞지 않아서', '상품에 흠집이 있어서', '잘못 주문해서', '다른 상품이 와서', '단순 변심으로'],
    tails: ['반품하고 싶어요', '환불받을 수 있나요', '교환 절차를 알려 주세요', '돈은 언제 돌려받나요', '반품 택배는 누가 부르나요', '환불 수수료가 있나요'],
    memo: '상담 녹취 1월',
  },
  {
    name: '회원정보',
    count: 25,
    heads: ['휴대폰 번호가 바뀌어서', '이름이 잘못 등록돼서', '로그인 비밀번호를 잊어서', '가입한 이메일이 기억나지 않아서', '주소를 새로 등록하려고'],
    tails: ['어디서 고치나요', '수정 방법을 알려 주세요', '다시 설정하고 싶어요', '변경이 안 돼요', '탈퇴하려면 어떻게 하나요'],
    memo: '상담 녹취 2월',
  },
  {
    name: '포인트',
    count: 40,
    heads: ['적립금이', '포인트가', '구매 포인트가', '이벤트 포인트가', '소멸 예정 포인트가', '포인트 사용이'],
    tails: ['아직 들어오지 않았어요', '언제 적립되는지 궁금해요', '왜 사라졌는지 모르겠어요', '얼마나 남았는지 알고 싶어요', '결제할 때 쓸 수 있나요', '유효기간이 언제까지인가요', '조회가 안 돼요', '두 배로 쌓인다고 했는데 확인해 주세요'],
    memo: '상담 녹취 2월',
  },
  {
    name: '선물 포장',
    count: 30,
    heads: ['생일 선물로 보낼 건데', '부모님께 드릴 선물이라', '친구에게 보내는 거라', '답례품으로 쓰려고', '기념일 선물인데'],
    tails: ['포장해 주실 수 있나요', '메시지 카드도 넣을 수 있나요', '포장 비용이 따로 있나요', '선물 상자 크기를 고를 수 있나요', '받는 분 주소로 바로 보낼 수 있나요', '가격표는 빼고 보내 주세요'],
    memo: '상담 녹취 3월',
  },
  {
    name: '기타 잡담',
    count: 35,
    heads: ['오늘 날씨가', '주말에도', '새로 나온 상품은', '이 쇼핑몰은', '이벤트 당첨자는', '신상품 입고는'],
    tails: ['어떤가요', '언제 알 수 있나요', '어디서 보나요', '계속 하나요', '알림을 받을 수 있나요', '추천해 주실 수 있나요', '궁금해서 물어봐요'],
    memo: '상담 녹취 3월',
  },
];

/** 개인정보를 가린 줄(미리보기에서 "가린 줄" 개수를 보이기 위한 2개). */
const MASKED_ROWS = ['카드 번호 [카드번호]로 결제했는데 포인트가 안 들어와요', '주민번호 [주민등록번호]로 가입했는데 회원 정보를 고치고 싶어요'];

function escapeCsv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildFixtureRows(): Array<{ text: string; count: number; memo: string }> {
  const rows: Array<{ text: string; count: number; memo: string }> = [];
  const seen = new Set<string>();
  let n = 0;
  for (const g of GROUPS) {
    let made = 0;
    const total = g.heads.length * g.tails.length;
    for (let i = 0; i < total && made < g.count; i++) {
      const h = g.heads[i % g.heads.length];
      const t = g.tails[Math.floor(i / g.heads.length)];
      const s = `${h} ${t}`;
      if (seen.has(s)) continue;
      seen.add(s);
      n++;
      rows.push({ text: s, count: 1 + ((n * 7) % 12), memo: g.memo });
      made++;
    }
    if (made < g.count) throw new Error(`${g.name} 그룹의 조합이 모자랍니다(${made}/${g.count})`);
  }
  // 가린 줄 2개는 마지막 그룹(기타)의 끝 2행을 대체한다(총 200행 유지)
  rows.splice(rows.length - 2, 2, ...MASKED_ROWS.map((text, i) => ({ text, count: 2 + i, memo: '상담 녹취 3월' })));
  return rows;
}

export function buildFixtureCsv(): string {
  const lines = [FIXTURE_HEADER, ...buildFixtureRows().map((r) => [escapeCsv(r.text), String(r.count), escapeCsv(r.memo)].join(','))];
  return lines.join('\n') + '\n';
}
