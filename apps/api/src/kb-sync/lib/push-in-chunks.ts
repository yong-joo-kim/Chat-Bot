/**
 * [pass 6 · H-4] 압축 해제기에 입력을 **작은 조각**으로 나눠 밀어 넣는다(순수). fflate의 `Gunzip.push`·`Unzip.push`는 받은
 * 입력을 끝까지 해제해 버려(실측: 300KB → 300MB · 2MB → 2GB) 상한을 넘었다는 표식만 세우고 return하는 방식으로는 폭탄을
 * 멈출 수 없다 — 한 번에 해제되는 양이 "입력 조각 × deflate 최대 배율(약 1032)"로 묶이도록 조각마다 위반 여부를 확인하고 즉시
 * 멈춘다. 4KB 조각이면 조각 하나가 만드는 출력은 최대 약 4.2MB다(실측 — 64KB 조각은 67MB, 16KB는 17MB).
 */
export const DECOMPRESS_PUSH_CHUNK_BYTES = 4 * 1024;

/** `push(조각, 마지막 여부)`를 호출하고, 각 조각 뒤에 `shouldStop()`이 참이면 남은 입력을 밀지 않고 멈춘다. 입력이 비어도 1회 밀어 마무리한다. */
export function pushInChunks(push: (chunk: Uint8Array, final: boolean) => void, data: Uint8Array, shouldStop: () => boolean): void {
  if (data.length === 0) {
    push(data, true);
    return;
  }
  for (let offset = 0; offset < data.length; offset += DECOMPRESS_PUSH_CHUNK_BYTES) {
    const end = Math.min(data.length, offset + DECOMPRESS_PUSH_CHUNK_BYTES);
    push(data.subarray(offset, end), end >= data.length);
    if (shouldStop()) return;
  }
}
