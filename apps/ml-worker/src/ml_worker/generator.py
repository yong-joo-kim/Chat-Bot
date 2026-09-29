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


class OllamaGenerator(Generator):
    """G3 슬롯의 두 번째 백엔드 — Ollama 서버(HTTP API)에 생성을 위탁한다.

    ⚠ **dev-pipeline-validation 전용**(`docs/requirements/nlg-bot-to-bot.md` FR-NG2,
    2026-09-29). `eval/report/generation-model-comparison.md`가 정의한 G3 후보 3종
    (한국어 특화 8B급·다국어 14B급·32B 양자화급, **L40S 실측 대상**)의 대체가 **아니다**.
    이 클래스가 부르는 모델(`qwen3:4b-instruct-2507-q4_K_M` 등, Ollama 4bit 양자화)은
    완전히 다른 체급이며, 이 경로로 얻은 품질 수치는 그 세 후보의 채택 여부를 판단하는
    근거로 쓸 수 없다(FR-0-260). 이 클래스의 목적은 "요청→생성→검증→제안 표시"
    파이프라인이 3050(4GB) 같은 소형 GPU 환경에서도 끝까지 도는지 확인하는 것뿐이다.

    `HFCausalLMGenerator`와 달리 모델을 이 프로세스 메모리에 얹지 않는다 — 별도 Ollama
    서버 프로세스(기본 `http://localhost:11434`)에 HTTP로 위탁한다. 시드→프롬프트 규약
    (`build_prompt`)과 출력 파싱(`parse_candidate_array`)은 그대로 재사용해 `/augment`
    계약(`{ seeds, targetCount, locale } -> { modelId, candidates }`)을 바꾸지 않는다.
    """

    def __init__(
        self,
        *,
        base_url: str,
        model_name: str,
        max_new_tokens: int,
        request_timeout_s: float,
        connect_timeout_s: float,
        model_id: str,
        client: object | None = None,
    ) -> None:
        # 지연 임포트: transformers 백엔드(기본값)에서는 httpx가 필요 없다.
        import httpx

        self._base_url = base_url.rstrip("/")
        self._model_name = model_name
        self._max_new_tokens = max_new_tokens
        # `client`는 단위시험에서 `httpx.Client(transport=httpx.MockTransport(...))`를 주입해
        # 실제 네트워크 없이 연결 성공/실패·모델 유무·타임아웃 분기를 검증하기 위한 것이다
        # (운영 경로는 항상 이 인자를 생략해 기본 클라이언트를 쓴다).
        self._client = client if client is not None else httpx.Client(
            timeout=httpx.Timeout(request_timeout_s, connect=connect_timeout_s)
        )
        self.model_id = model_id
        self._warmed_up = False

        # 부팅 시 실제로 Ollama 서버에 연결되고 그 모델이 로컬에 있는지 확인한다
        # (No.17 §1.4 C-8/R-5 — "mock으로 조용히 대체" 방지). 실패하면 예외를 그대로
        # 던져 프로세스 기동을 막는다 — HFCausalLMGenerator가 모델 로드 실패 시 기동
        # 자체가 실패하는 것과 같은 원칙이다. `app.py`의 `lifespan()`이 이 예외를 잡지
        # 않으므로 기동이 실패로 끝난다(조용한 mock 대체 없음).
        self._verify_server_and_model()

    def _verify_server_and_model(self) -> None:
        try:
            res = self._client.get(f"{self._base_url}/api/tags")
        except Exception as exc:  # noqa: BLE001 — 원인을 그대로 드러내는 것이 목적
            raise RuntimeError(
                f"Ollama 서버({self._base_url})에 연결할 수 없습니다: {exc}. "
                "Ollama가 떠 있는지, OLLAMA_BASE_URL이 맞는지 확인하세요."
            ) from exc
        if res.status_code != 200:
            raise RuntimeError(
                f"Ollama 서버({self._base_url}) 응답 이상: HTTP {res.status_code} — {res.text[:200]}"
            )
        try:
            body = res.json()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Ollama /api/tags 응답을 해석할 수 없습니다: {exc}") from exc

        names: set[str] = set()
        for entry in body.get("models", []) if isinstance(body, dict) else []:
            if not isinstance(entry, dict):
                continue
            for key in ("model", "name"):
                value = entry.get(key)
                if isinstance(value, str):
                    names.add(value)

        candidates = {self._model_name, f"{self._model_name}:latest"}
        if not (names & candidates):
            raise RuntimeError(
                f"Ollama에 모델 '{self._model_name}'이 없습니다(로컬 목록: {sorted(names) or '없음'}). "
                f"`ollama pull {self._model_name}`로 받은 뒤 다시 시작하세요."
            )

    def warmup(self) -> None:
        self.generate(["워밍업 문장입니다."], 1)
        self._warmed_up = True

    @property
    def warmed_up(self) -> bool:
        return self._warmed_up

    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        prompt = build_prompt(seeds, target_count)
        try:
            res = self._client.post(
                f"{self._base_url}/api/generate",
                json={
                    "model": self._model_name,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "num_predict": self._max_new_tokens,
                        "temperature": 0.9,
                        "top_p": 0.95,
                    },
                },
            )
            res.raise_for_status()
            body = res.json()
        except Exception as exc:  # noqa: BLE001 — Generator 계약(§클래스 docstring): 실패 시 빈 배열
            logger.warning("Ollama /api/generate 호출 실패 — 빈 후보로 수렴합니다: %s", exc)
            return []

        if body.get("done_reason") == "length":
            logger.warning(
                "Ollama 응답이 토큰 한도(num_predict=%s)에서 잘렸습니다(targetCount=%s) — "
                "GENERATION_MAX_NEW_TOKENS를 늘리는 것을 검토하세요(No.17 §1.4 C-3).",
                self._max_new_tokens,
                target_count,
            )
        return parse_candidate_array(body.get("response", ""))

    def healthy(self) -> bool:
        return self._client is not None
