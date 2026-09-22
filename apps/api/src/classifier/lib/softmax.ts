/**
 * 수치적으로 안정적인 softmax(ADR-0027 §1 — 다항 로지스틱 회귀의 출력층). DB·Nest 무의존 순수 함수.
 * 최댓값을 빼고 지수화해 오버플로를 방지한다(표준 관행).
 */
export function softmax(logits: ArrayLike<number>): Float64Array {
  const n = logits.length;
  const out = new Float64Array(n);
  if (n === 0) return out;

  let max = -Infinity;
  for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  if (sum === 0) {
    // 극단적으로 모든 로짓이 -Infinity인 이례적 입력 — 균등분포로 수렴시켜 NaN을 만들지 않는다.
    return new Float64Array(n).fill(1 / n);
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
  return out;
}
