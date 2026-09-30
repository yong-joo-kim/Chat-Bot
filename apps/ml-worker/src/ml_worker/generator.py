"""No.16 증강(G3 로컬 생성모델)의 문장 생성 본체(ADR-0026 §5, DD-101).

- `MockGenerator`: 모델·GPU 없이도 `/augment` 계약을 검증하기 위한 결정론적 구현체
  (`apps/api` 쪽 `local` Provider 통합 테스트, ml-worker 미기동 CI 등에서 사용). 의미를
  보존하지 않으므로 품질 검증에는 쓰지 않는다.
- `HFCausalLMGenerator`: 실제 한국어/다국어 생성모델(Hugging Face `transformers`
  causal LM)을 얹는 실사용 구현체. **모델 선정은 `eval/generation_candidates.py`의
  5지표 실측으로 확정한다**(ADR-0026 §5) — 이 클래스는 어떤 모델이든 `AutoModelForCausalLM`으로
  로드 가능하면 그대로 얹을 수 있는 범용 래퍼일 뿐, 특정 모델 이름을 하드코딩하지 않는다.

- `OllamaGenerator`: Ollama 서버 위탁 — **경량 설치 구성(No.37): 동작 보장·품질 미보증**.
- `VllmGenerator`: 생성 전용 사내 vLLM 서버(OpenAI 호환 대화형 API) 위탁 — 운영 구성(No.37).

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


def strip_think_blocks(text: str) -> str:
    """`<think>…</think>` 블록 제거(여러 개·줄바꿈 포함). 닫히지 않은 `<think>`는 그 뒤 전부 제거.
    닫는 태그만 남은 경우(템플릿이 여는 태그를 미리 넣는 모델)는 마지막 닫는 태그 뒤만 남긴다.
    원격 백엔드(Ollama·vLLM) 응답 전용 — 공용 `parse_candidate_array`는 바꾸지 않는다(ED-4)."""
    out = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    out = re.sub(r"<think>.*\Z", "", out, flags=re.DOTALL)
    if "</think>" in out:
        out = out.rsplit("</think>", 1)[1]
    return out


def salvage_truncated_array(text: str) -> list[str]:
    """토큰 한도로 잘린 JSON 배열에서 **닫힌 문자열 원소만** 복구한다(No.37 §8, R-7).
    마지막 미완 원소는 버린다. 잘림 신호(done_reason/finish_reason == length)가 있을 때만 쓴다."""
    stripped = re.sub(r"```json|```", "", text).strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    if not stripped.startswith("["):
        return parse_candidate_array(text)
    decoder = json.JSONDecoder()
    out: list[str] = []
    pos = 1
    while pos < len(stripped):
        while pos < len(stripped) and stripped[pos] in " \t\r\n,":
            pos += 1
        if pos >= len(stripped) or stripped[pos] != '"':
            break
        try:
            value, pos = decoder.raw_decode(stripped, pos)
        except json.JSONDecodeError:
            break
        out.append(value)
    return out


class Generator(ABC):
    model_id: str
    # No.37 선택 속성 — 기존 구현체는 기본값을 상속한다.
    backend: str = "transformers"  # transformers | ollama | vllm
    profile: str = "standard"  # standard | lightweight (경량 설치 구성 표식 — 품질 보증 아님)
    target_cap: int | None = None  # 1회 생성 상한. None = 계약 상한

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


def _host_of(base_url: str) -> str:
    """로그·오류 메시지용 `scheme://host:port` (경로·자격증명 제외)."""
    from urllib.parse import urlsplit

    parts = urlsplit(base_url)
    host = parts.hostname or "?"
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}"


class OllamaGenerator(Generator):
    """G3 슬롯의 두 번째 백엔드 — Ollama 서버(HTTP API)에 생성을 위탁한다.

    **경량 설치 구성 — 동작 보장·품질 미보증**(No.37 P-3, ADR-0046). 4GB급 GPU에서도 도는
    소형 양자화 모델로 "요청→생성→검증→제안 표시" 흐름이 끝까지 도는지를 보장할 뿐, 품질은
    보증하지 않는다. `eval/report/generation-model-comparison.md`의 G3 후보 3종(한국어 특화
    8B급·다국어 14B급·32B 양자화급, **L40S 실측 대상**)의 대체가 **아니며**, 이 경로의 품질 수치는
    그 세 후보의 채택 근거로 쓸 수 없다(FR-0-260). 운영 G3 채택 판정은 No.17.

    `HFCausalLMGenerator`와 달리 모델을 이 프로세스 메모리에 얹지 않는다 — 별도 Ollama
    서버 프로세스(기본 `http://localhost:11434`)에 HTTP로 위탁한다. 시드→프롬프트 규약
    (`build_prompt`)과 출력 파싱(`parse_candidate_array`)은 그대로 재사용해 `/augment`
    계약(`{ seeds, targetCount, locale } -> { modelId, candidates }`)을 바꾸지 않는다.
    """

    backend = "ollama"
    profile = "lightweight"

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
        target_cap: int = 20,
        warmup_timeout_s: float = 120.0,
    ) -> None:
        # 지연 임포트: transformers 백엔드(기본값)에서는 httpx가 필요 없다.
        import httpx

        self._base_url = base_url.rstrip("/")
        self._model_name = model_name
        self._max_new_tokens = max_new_tokens
        self._connect_timeout_s = connect_timeout_s
        self._warmup_timeout_s = warmup_timeout_s
        self.target_cap = target_cap
        # `client`는 단위시험에서 `httpx.Client(transport=httpx.MockTransport(...))`를 주입해
        # 실제 네트워크 없이 연결 성공/실패·모델 유무·타임아웃 분기를 검증하기 위한 것이다
        # (운영 경로는 항상 이 인자를 생략해 기본 클라이언트를 쓴다). 리다이렉트는 따라가지
        # 않는다(ED-7 — 주소 검사 우회 방지).
        self._client = client if client is not None else httpx.Client(
            timeout=httpx.Timeout(request_timeout_s, connect=connect_timeout_s),
            follow_redirects=False,
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
        """워밍업 요청에만 `warmup_timeout_s`를 적용한다(첫 호출은 모델을 VRAM에 올리느라 오래 걸림).
        결과가 1건 이상일 때만 `warmed_up=True`. 0건이어도 기동을 막지는 않는다(일시 상태일 수 있음)."""
        import httpx

        result = self._generate(
            ["워밍업 문장입니다."], 1, timeout=httpx.Timeout(self._warmup_timeout_s, connect=self._connect_timeout_s)
        )
        self._warmed_up = len(result) >= 1
        if not self._warmed_up:
            logger.warning("Ollama 워밍업이 후보를 만들지 못했습니다 — warmedUp=false로 보고합니다(기동은 계속).")

    @property
    def warmed_up(self) -> bool:
        return self._warmed_up

    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        return self._generate(seeds, target_count)

    def _generate(self, seeds: list[str], target_count: int, timeout: object | None = None) -> list[str]:
        prompt = build_prompt(seeds, target_count)
        extra = {"timeout": timeout} if timeout is not None else {}
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
                **extra,
            )
            res.raise_for_status()
            body = res.json()
        except Exception as exc:  # noqa: BLE001 — Generator 계약(§클래스 docstring): 실패 시 빈 배열
            logger.warning("Ollama /api/generate 호출 실패 — 빈 후보로 수렴합니다: %s", exc)
            return []

        text = strip_think_blocks(str(body.get("response", "")))
        if body.get("done_reason") == "length":
            logger.warning(
                "Ollama 응답이 토큰 한도(num_predict=%s)에서 잘렸습니다(targetCount=%s) — "
                "닫힌 원소만 복구합니다. OLLAMA_MAX_NEW_TOKENS를 늘리는 것을 검토하세요(No.17 §1.4 C-3).",
                self._max_new_tokens,
                target_count,
            )
            return salvage_truncated_array(text)
        return parse_candidate_array(text)

    def healthy(self) -> bool:
        return self._client is not None


class VllmGenerator(Generator):
    """생성 전용 사내 vLLM 서버(OpenAI 호환 `/v1/chat/completions`)에 위탁하는 운영 구성(No.37).

    httpx만 쓴다(OpenAI SDK 미사용 — 전송·재시도 정책이 통제 밖으로 나가지 않게, ADR-0026 §4).
    프롬프트는 `build_prompt()` 한 벌을 단일 `user` 메시지로 보낸다(모델별 `system` 역할 처리 차이를
    피하고 Ollama 경로와 같은 입력으로 정렬). 모든 실패는 빈 배열로 수렴하고, 로그·오류에는 호스트·
    상태 코드·예외 클래스 이름만 남긴다(경로·API 키·응답 본문 0 — ED-8).
    """

    backend = "vllm"
    profile = "standard"

    def __init__(
        self,
        *,
        base_url: str,
        model_name: str,
        api_key: str | None,
        max_new_tokens: int,
        request_timeout_s: float,
        connect_timeout_s: float,
        warmup_timeout_s: float,
        target_cap: int,
        model_id: str,
        client: object | None = None,
    ) -> None:
        import httpx

        base = base_url.strip().rstrip("/")
        if base.endswith("/v1"):
            raise RuntimeError("VLLM_BASE_URL 끝의 '/v1'을 빼고 적으세요(코드가 /v1/... 경로를 붙입니다).")
        self._base_url = base
        self._host = _host_of(base)
        self._model_name = model_name
        self._max_new_tokens = max_new_tokens
        self._connect_timeout_s = connect_timeout_s
        self._warmup_timeout_s = warmup_timeout_s
        self.target_cap = target_cap
        self.model_id = model_id
        self._warmed_up = False
        # 인증 헤더는 요청마다 붙인다(주입 클라이언트에서도 동일하게 동작). 키가 없으면 헤더 없음.
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        # 리다이렉트는 따라가지 않는다(ED-7 — 허용 주소 검사를 3xx로 우회하지 못하게).
        self._client = client if client is not None else httpx.Client(
            timeout=httpx.Timeout(request_timeout_s, connect=connect_timeout_s),
            follow_redirects=False,
        )
        self._verify_server_and_model()

    def _verify_server_and_model(self) -> None:
        try:
            res = self._client.get(f"{self._base_url}/v1/models", headers=self._headers)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"vLLM 서버({self._host})에 연결할 수 없습니다({type(exc).__name__}). "
                "서버가 떠 있는지, VLLM_BASE_URL이 맞는지 확인하세요."
            ) from None
        if 300 <= res.status_code < 400:
            raise RuntimeError(
                f"vLLM 서버({self._host})가 리다이렉트(HTTP {res.status_code})를 응답했습니다. 리다이렉트는 따라가지 않습니다."
            )
        if res.status_code != 200:
            raise RuntimeError(f"vLLM 서버({self._host}) 응답 이상: HTTP {res.status_code}")
        try:
            body = res.json()
            ids = [e["id"] for e in body["data"] if isinstance(e, dict) and isinstance(e.get("id"), str)]
        except Exception:  # noqa: BLE001
            raise RuntimeError(f"vLLM 서버({self._host})의 /v1/models 응답을 해석할 수 없습니다.") from None
        if self._model_name not in ids:
            raise RuntimeError(
                f"vLLM 서버({self._host})가 모델 '{self._model_name}'을 제공하지 않습니다(제공 목록: {sorted(ids) or '없음'}). "
                "vLLM의 `--served-model-name`과 `VLLM_MODEL`이 같은지 확인하세요."
            )

    def warmup(self) -> None:
        import httpx

        result = self._generate(
            ["워밍업 문장입니다."], 1, timeout=httpx.Timeout(self._warmup_timeout_s, connect=self._connect_timeout_s)
        )
        self._warmed_up = len(result) >= 1
        if not self._warmed_up:
            logger.warning("vLLM 워밍업이 후보를 만들지 못했습니다 — warmedUp=false로 보고합니다(기동은 계속).")

    @property
    def warmed_up(self) -> bool:
        return self._warmed_up

    def generate(self, seeds: list[str], target_count: int) -> list[str]:
        return self._generate(seeds, target_count)

    def _generate(self, seeds: list[str], target_count: int, timeout: object | None = None) -> list[str]:
        prompt = build_prompt(seeds, target_count)
        extra = {"timeout": timeout} if timeout is not None else {}
        try:
            res = self._client.post(
                f"{self._base_url}/v1/chat/completions",
                json={
                    "model": self._model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": self._max_new_tokens,
                    "temperature": 0.9,
                    "top_p": 0.95,
                    "stream": False,
                },
                headers=self._headers,
                **extra,
            )
            if res.status_code != 200:
                logger.warning("vLLM 생성 호출 실패(host=%s, HTTP %s) — 빈 후보로 수렴합니다.", self._host, res.status_code)
                return []
            choice = res.json()["choices"][0]
            content = choice["message"]["content"]
            finish_reason = choice.get("finish_reason")
        except Exception as exc:  # noqa: BLE001 — Generator 계약: 실패 시 빈 배열(예외 클래스 이름만 기록)
            logger.warning("vLLM 생성 호출 실패(host=%s, %s) — 빈 후보로 수렴합니다.", self._host, type(exc).__name__)
            return []

        text = strip_think_blocks(content if isinstance(content, str) else "")
        if finish_reason == "length":
            logger.warning(
                "vLLM 응답이 토큰 한도(max_tokens=%s)에서 잘렸습니다(targetCount=%s) — "
                "닫힌 원소만 복구합니다. VLLM_MAX_NEW_TOKENS를 늘리는 것을 검토하세요.",
                self._max_new_tokens,
                target_count,
            )
            return salvage_truncated_array(text)
        return parse_candidate_array(text)

    def healthy(self) -> bool:
        return self._client is not None
