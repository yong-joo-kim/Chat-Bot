"""STT 모델 사전 내려받기 — 폐쇄망 반입용 수동 도구(설계서 §8.5, FR-VO7-2). 서비스 기동 경로가 아니다.

인터넷이 되는 장비에서 한 번 실행해 모델을 디렉터리에 받고, 그 디렉터리를 폐쇄망 서버로 복사한 뒤
`STT_MODEL_ID=<디렉터리 경로>` 또는 `STT_MODEL_DIR=<캐시 루트>`로 가리킨다. 기동 중에는 내려받지 않는다.

사용:  python scripts/fetch_stt_model.py large-v3-turbo --out ./models/large-v3-turbo
주의:  모델 가중치·faster-whisper·CTranslate2·PyAV·FFmpeg 빌드·Silero VAD 라이선스 원문을 확인한 뒤
       반입한다(U-4 — eval/report 부록에 이름·조건·확인일 기록). 이 스크립트는 라이선스를 판정하지 않는다.
"""
from __future__ import annotations

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="faster-whisper(CTranslate2) 모델 사전 내려받기")
    parser.add_argument("model", help="모델 크기 이름(예: small, large-v3-turbo) 또는 HF 저장소 ID")
    parser.add_argument("--out", required=True, help="저장 디렉터리(폐쇄망으로 복사할 대상)")
    parser.add_argument("--revision", default=None, help="HF 리비전(고정 권장)")
    args = parser.parse_args()

    try:
        from faster_whisper.utils import download_model
    except ImportError:
        print('faster-whisper가 필요합니다: pip install -e ".[speech]"', file=sys.stderr)
        return 1
    path = download_model(args.model, output_dir=args.out, revision=args.revision)
    print(f"내려받기 완료: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
