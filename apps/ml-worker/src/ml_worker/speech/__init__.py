"""음성 인식(No.32) — `ML_WORKER_ROLE=speech` 전용 패키지(설계서 voice-ai-설계.md §8, ADR-0052).

이 패키지는 `speech` 역할에서만 import된다(`embed`/`augment`/`both`는 av·faster-whisper 없이 동작).
오디오는 메모리에서만 다룬다 — 임시 파일·하위 프로세스·외부 송신·DB 접근이 없다(VO-3·VO-16 정적 검사).
"""
