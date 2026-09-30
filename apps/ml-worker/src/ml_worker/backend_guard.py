"""생성 백엔드(Ollama/vLLM) 주소 검사 — 순수 함수(No.37, 설계서 §11, ADR-0046).

G3 시드는 "사내 전송 전제"로 마스킹하지 않는다. API의 출구 게이트(ADR-0040)는 API → ml-worker
구간까지만 보므로, ml-worker → 생성 백엔드 구간은 이 검사가 통제한다. ml-worker는 DB·API
설정을 읽지 않으므로(ADR-0024 §갱신 1-③) 자체 검사로 막는다.

규칙 요약:
- 스킴 http·https만, 호스트 필수, URL 안 사용자 정보(`user:pass@`) 금지.
- 링크로컬(169.254/16·fe80::/10)·미지정(0.0.0.0·::)·멀티캐스트는 허용 목록에 있어도 항상 거부.
- 허용 목록(`host` | `host:port` | `*.suffix`, 대소문자 무시)에 있으면 허용.
- `require_allowlist=True`이면 목록 밖은 루프백·사설이라도 거부.
- IP 리터럴은 루프백·사설만, 이름은 `localhost` 또는 해석된 모든 주소가 루프백·사설일 때만 허용.
실패 시 `RuntimeError`(메시지에는 호스트만 — 경로·자격증명 0).
"""
from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit

Resolver = Callable[[str], list[str]]

_PRIVATE_NETS = tuple(
    ipaddress.ip_network(n)
    for n in ("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
)


def default_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None)
    return sorted({str(info[4][0]) for info in infos})


def parse_allowed_hosts(raw: str) -> list[str]:
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _to_ip(text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    ip = ipaddress.ip_address(text.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _is_forbidden(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return ip.is_link_local or ip.is_unspecified or ip.is_multicast


def _is_loopback_or_private(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return any(ip in net for net in _PRIVATE_NETS if net.version == ip.version)


def _matches_allowlist(host: str, port: int, entries: list[str]) -> bool:
    for entry in entries:
        if entry.startswith("*."):
            if host.endswith(entry[1:]) and len(host) > len(entry) - 1:
                return True
        elif entry == host or entry == f"{host}:{port}":
            return True
    return False


def _literal_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return _to_ip(host)
    except ValueError:
        return None


def is_loopback_url(url: str) -> bool:
    """URL 호스트가 `localhost` 또는 루프백 IP 리터럴인지(이름 해석은 하지 않는다)."""
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return False
    if host == "localhost":
        return True
    ip = _literal_ip(host)
    return ip is not None and ip.is_loopback


def assert_backend_url_allowed(
    url: str,
    allowed_hosts: str | list[str] = "",
    require_allowlist: bool = False,
    resolver: Resolver | None = None,
) -> None:
    resolve = resolver or default_resolver
    entries = parse_allowed_hosts(allowed_hosts) if isinstance(allowed_hosts, str) else [
        e.strip().lower() for e in allowed_hosts if e.strip()
    ]

    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        explicit_port = parts.port
    except ValueError as exc:
        raise RuntimeError("생성 백엔드 주소 형식이 올바르지 않습니다.") from exc
    if parts.scheme not in ("http", "https"):
        raise RuntimeError("생성 백엔드 주소는 http 또는 https만 허용합니다.")
    if not host:
        raise RuntimeError("생성 백엔드 주소에 호스트가 없습니다.")
    if parts.username is not None or parts.password is not None:
        raise RuntimeError(
            f"생성 백엔드 주소({host})에 사용자 정보(user:pass@)를 넣을 수 없습니다. 인증은 VLLM_API_KEY로만 설정하세요."
        )
    port = explicit_port or (443 if parts.scheme == "https" else 80)

    literal = _literal_ip(host)
    resolved: list[str] = []
    if literal is None and host != "localhost":
        try:
            resolved = resolve(host)
        except Exception:  # noqa: BLE001 — 해석 실패는 아래에서 허용 여부에 따라 처리
            resolved = []

    # 항상 금지: 링크로컬·미지정·멀티캐스트(허용 목록으로도 못 연다).
    candidates = [literal] if literal is not None else [_to_ip(a) for a in resolved]
    for ip in candidates:
        if _is_forbidden(ip):
            raise RuntimeError(
                f"생성 백엔드 주소({host})가 링크로컬·미지정·멀티캐스트 대역이라 허용되지 않습니다."
            )

    allowed_by_list = _matches_allowlist(host, port, entries)
    if allowed_by_list:
        return
    if require_allowlist:
        raise RuntimeError(
            f"생성 백엔드 주소({host})가 GENERATION_BACKEND_ALLOWED_HOSTS에 없습니다"
            "(GENERATION_BACKEND_REQUIRE_ALLOWLIST=true — 루프백·사설 대역도 명시해야 합니다)."
        )

    deny = (
        f"생성 백엔드 주소({host})가 루프백·사설 대역이 아닙니다. 사내 서버가 맞다면 "
        "GENERATION_BACKEND_ALLOWED_HOSTS에 명시하세요(마스킹하지 않은 예문 시드가 이 주소로 전송됩니다)."
    )
    if literal is not None:
        if not _is_loopback_or_private(literal):
            raise RuntimeError(deny)
        return
    if host == "localhost":
        return
    if not resolved:
        raise RuntimeError(f"생성 백엔드 주소({host})의 이름을 해석할 수 없습니다. IP 주소를 쓰거나 GENERATION_BACKEND_ALLOWED_HOSTS에 명시하세요.")
    if not all(_is_loopback_or_private(_to_ip(a)) for a in resolved):
        raise RuntimeError(deny)
