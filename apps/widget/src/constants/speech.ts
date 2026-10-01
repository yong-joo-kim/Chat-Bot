/**
 * [신규 No.32] 음성 AI 위젯 문구·상수(voice-ai-ui-spec §8.1~§8.3 — 이 표가 전부다).
 * 위젯은 zod를 번들에 넣지 않으므로 공개 계약 상수는 문자열로 복제한다(시험이 shared-types와 같은 값인지 단언).
 * 첫 사용 고지(VO-W4) 문구·키는 **법무 확인 전이라 만들지 않는다**(빈 문자열 포함 금지).
 */
export const WIDGET_FEATURE_SPEECH_V1 = 'speech-v1';

/** 녹음 최대 길이(초) · 녹음 용량 상한(바이트) · 기기 음성 대기(ms) · 인식 요청 대기 상한(ms — 명세 F-4). */
export const SPEECH_LIMITS = {
  maxRecordSeconds: 30,
  tenLeftSeconds: 10,
  maxAudioBytes: 1024 * 1024,
  voicesWaitMs: 2000,
  uploadDeadlineMs: 15000,
  audioBitsPerSecond: 32000,
} as const;

/** `transcribeSpeech`가 던지는 오류 분류(설계 §9.6) + 세션 헤더 불량(`VALIDATION_FAILED`). */
export type SpeechClientErrorKind =
  | 'UNAVAILABLE'
  | 'BUSY'
  | 'INVALID'
  | 'TOO_LARGE'
  | 'FAILED'
  | 'RATE_LIMITED'
  | 'DISABLED'
  | 'SESSION'
  | 'NETWORK';

export const SPEECH_MESSAGES = {
  micLabel: '말하기',
  micLabelRetry: '다시 말하기',
  micLabelPreparing: '마이크 준비 중…',
  micLabelStop: '말하기 끝내기',
  micLabelBusy: '글자로 바꾸는 중…',
  micHint: '눌러서 말하면 글자로 바꿔 입력창에 넣어 줘요. 최대 30초까지 말할 수 있어요.',
  cancelLabel: '취소',
  preparing: '마이크를 준비하고 있어요',
  recording: (n: number) => `듣고 있어요 · 남은 시간 ${n}초`,
  recordingAnnounce: "듣고 있어요. 말씀이 끝나면 '말하기 끝내기'를 눌러 주세요. 최대 30초예요.",
  tenLeft: '10초 남았어요.',
  autoEnded: '30초가 되어 녹음을 마쳤어요.',
  sizeEnded: '녹음이 길어져 여기서 마쳤어요.',
  uploading: '글자로 바꾸는 중이에요',
  done: '글자로 바꿨어요. 내용을 확인하고 고친 뒤 전송해 주세요.',
  empty: '말소리가 들리지 않았어요. 다시 말씀해 주세요.',
  recCanceled: '녹음을 취소했어요.',
  sttCanceled: '글자로 바꾸기를 취소했어요.',
  interrupted: '녹음이 중단됐어요. 다시 말씀해 주세요.',
  permDenied: '마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크를 허용한 뒤 새로고침해 주세요.',
  siteBlocked: '이 사이트에서는 음성 입력을 쓸 수 없어요. 글자로 입력해 주세요.',
  noDevice: '마이크를 찾을 수 없어요. 마이크가 연결되어 있는지 확인해 주세요.',
  deviceBusy: '마이크를 쓸 수 없어요. 다른 앱이 마이크를 쓰고 있는지 확인해 주세요.',
  unavailable: '지금은 음성 입력을 쓸 수 없어요. 글자로 입력해 주세요.',
  busy: '음성 인식이 잠시 붐벼요. 글자로 입력하거나 잠시 뒤 다시 시도해 주세요.',
  invalid: '녹음을 읽지 못했어요. 다시 말씀해 주세요.',
  tooLarge: '녹음이 너무 길어요. 30초 안으로 말씀해 주세요.',
  failed: '음성을 글자로 바꾸지 못했어요. 글자로 입력해 주세요.',
  rateLimited: '음성 입력을 너무 자주 했어요. 잠시 뒤에 다시 해 주세요.',
  sessionBad: '녹음을 처리하지 못했어요. 다시 시도해 주세요.',
  network: '네트워크가 불안정해요. 연결을 확인한 뒤 다시 시도하거나 글자로 입력해 주세요.',
  // 읽기(듣기)
  listenLabel: '듣기',
  listenAria: '이 답변 듣기',
  stopLabel: '멈추기',
  stopAria: '듣기 멈추기',
  autoReadLabel: '답변 소리로 듣기',
  autoReadOn: '켜짐',
  autoReadOff: '꺼짐',
  autoReadHelp: '새 답변이 오면 자동으로 읽어 줘요. 스크린리더를 쓰면 소리가 겹칠 수 있어요. 안내 문구는 읽지 않아요.',
  voiceChecking: '읽기 음성을 확인하고 있어요.',
  voiceUnavailable: '이 기기에는 한국어 읽기 음성이 없어 소리로 들려드릴 수 없어요.',
  listenWhileRecording: '녹음 중에는 답변을 들을 수 없어요.',
  listenError: '지금은 소리로 들려드릴 수 없어요.',
} as const;

/** 오류 분류 → 상태 줄 문구(§5.3). */
export const SPEECH_ERROR_NOTICE: Readonly<Record<SpeechClientErrorKind, string>> = {
  UNAVAILABLE: SPEECH_MESSAGES.unavailable,
  BUSY: SPEECH_MESSAGES.busy,
  INVALID: SPEECH_MESSAGES.invalid,
  TOO_LARGE: SPEECH_MESSAGES.tooLarge,
  FAILED: SPEECH_MESSAGES.failed,
  RATE_LIMITED: SPEECH_MESSAGES.rateLimited,
  DISABLED: SPEECH_MESSAGES.siteBlocked,
  SESSION: SPEECH_MESSAGES.sessionBad,
  NETWORK: SPEECH_MESSAGES.network,
};
