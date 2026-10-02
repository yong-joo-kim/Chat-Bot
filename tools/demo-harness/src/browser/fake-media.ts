// [DT-2] 가짜 마이크 기동 인자(설계 §8.1 · 실기동 확인 X-1) — 합성 음성 WAV를 가상 마이크로 한 번 흘려보낸다.
// 공백·마침표가 든 경로도 그대로 동작한다(2026-10-02 실측 · Edge 154). 권한은 인자가 아니라 출처 한정 grantPermissions로 준다.

/** 가짜 오디오 파일이 없으면 인자를 붙이지 않는다(10분판·음성 입력 끔). */
export function fakeMediaArgs(wavPath: string | undefined): string[] {
  if (!wavPath) return [];
  return ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}%noloop`];
}
