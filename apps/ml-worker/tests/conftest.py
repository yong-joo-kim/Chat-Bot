"""테스트는 전부 mock 임베더로 돈다 — 실제 모델 다운로드·GPU 없이 계약(HTTP 스키마·
배치 상한·헬스체크)을 검증한다. 매칭 품질 실측은 eval/sweep_thresholds.py의 책임이다."""
import os

os.environ["EMBEDDING_MODEL_ID"] = "mock"
os.environ["EMBEDDING_DEVICE"] = "cpu"
