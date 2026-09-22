"""No.16 증강(G3 로컬 생성모델)의 문장 생성 본체(ADR-0026 §5, DD-101).

- `MockGenerator`: 모델·GPU 없이도 `/augment` 계약을 검증하기 위한 결정론적 구현체
  (`apps/api` 쪽 `local` Provider 통합 테스트, ml-worker 미기동 CI 등에서 사용). 의미를
  보존하지 않으므로 품질 검증에는 쓰지 않는다.
- `HFCausalLMGenerator`: 실제 한국어/다국어 생성모델(Hugging Face `transformers`
  causal LM)을 얹는 실사용 구현체. **모델 선정은 `eval/generation_candidates.py`의
  5지표 실측으로 확정한다**(ADR-0026 §5) — 이 클래스는 어떤 모델이든 `AutoModelForCausalLM`으로
  로드 가능하면 그대로 얹을 수 있는 범용 래퍼일 뿐, 특정 모델 이름을 하드코딩하지 않는다.

`apps/api`는 이 계층을 전혀 모른다 — `POST /augment { seeds, targetCount, locale }
-> { modelId, candidates }` 계약만 안다(설계서 §5.2).
"""
from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod

logger = logging.getLogger("ml_worker.generator")

SYSTEM_INSTRUCTION = (
    "너는 한국어 챗봇의 의도(intent) 예문을 늘리는 도구다. "
    "아래 JSON 배열로 주어지는 '시드 문장들'과 같은 의도(같은 목적)를 표현하는, "
    "자연스러운 한국어 구어체 질문/문장을 새로 만들어라.\n"
    "규칙:\n"
    "- 시드 문장들과 의미가 달라지면 안 된다.\n"
    "- 시드 문장을 그대로 베끼거나 조사·어미만 바꾼 사실상 동일한 문장은 만들지 마라.\n"
    "- 존댓말/반말을 다양하게 섞어라.\n"
    "- 욕설·비속어·개인정보를 포함하지 마라.\n"
    "- 한국어 문장만 만들어라.\n"
    "- 출력은 오직 JSON 문자열 배열이어야 한다. 예: [\"문장1\", \"문장2\"]\n"
    "- 다른 설명, 코드블록 표시, 번호 매기기를 붙이지 마라."
)


def build_prompt(seeds: list[str], target_count: int) -> str:
    payload = json.dumps({"seeds": seeds, "targetCount": target_count, "locale": "ko"}, ensure_ascii=False)
    return f"{SYSTEM_INSTRUCTION}\n\n{payload}"


def parse_candidate_array(text: str) -> list[str]:
    """모델 출력에서 문자열 배열을 뽑아낸다. 실패해도 예외를 던지지 않고 최선의 폴백을 시도한다
    (`apps/api` 쪽 `parseCandidateArray`와 같은 원칙 — 이 서비스도 외부 위험 출력을 신뢰하지 않는다)."""
    stripped = re.sub(r"```json|```", "", text).strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    lines = [re.sub(r"^[-*\d.)\s]+", "", line).strip() for line in stripped.split("\n")]
    return [line for line in lines if line]


class Generator(ABC):
    model_id: str

    @abstractmethod
    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        """검증 전 원시 후보를 반환한다. 실패 시 빈 리스트(예외 전파 금지 — 호출부 계약과 동일)."""

    @abstractmethod
    def healthy(self) -> bool: ...


class MockGenerator(Generator):
    model_id = "mock-generator@0"

    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        if not seeds:
            return []
        out: list[str] = []
        i = 0
        while len(out) < target_count and i <= target_count * 4:
            seed = seeds[i % len(seeds)]
            out.append(f"{seed} (로컬 생성 mock {i + 1})")
            i += 1
        return out

    def healthy(self) -> bool:
        return True


class HFCausalLMGenerator(Generator):
    def __init__(
        self,
        *,
        model_name: str,
        revision: str,
        device: str,
        max_new_tokens: int,
        model_id: str,
    ) -> None:
        # 지연 임포트: mock 모드·embed 전용 프로파일에서는 torch/transformers 로드가 필요 없다.
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self._torch = torch
        self._tokenizer = AutoTokenizer.from_pretrained(model_name, revision=revision)
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        self._model = AutoModelForCausalLM.from_pretrained(
            model_name, revision=revision, torch_dtype=dtype
        ).to(device)
        self._model.eval()
        self._device = device
        self._max_new_tokens = max_new_tokens
        self.model_id = model_id
        self._warmed_up = False

    def warmup(self) -> None:
        self.generate(["워밍업 문장입니다."], 1)
        self._warmed_up = True

    @property
    def warmed_up(self) -> bool:
        return self._warmed_up

    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        prompt = build_prompt(seeds, target_count)
        inputs = self._tokenizer(prompt, return_tensors="pt").to(self._device)
        with self._torch.no_grad():
            output = self._model.generate(
                **inputs,
                max_new_tokens=self._max_new_tokens,
                do_sample=True,
                temperature=0.9,
                top_p=0.95,
                pad_token_id=self._tokenizer.eos_token_id,
            )
        generated = self._tokenizer.decode(output[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True)
        return parse_candidate_array(generated)

    def healthy(self) -> bool:
        return self._model is not None
