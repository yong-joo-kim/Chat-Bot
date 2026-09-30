"""No.37 생성 백엔드 주소 검사(`backend_guard`) 순수 함수 시험 — 이름 해석은 가짜 해석기로 주입해
DNS를 쓰지 않는다(설계서 §11.2, AC-ED4-1/2)."""
from __future__ import annotations

import pytest

from ml_worker.backend_guard import assert_backend_url_allowed


def _resolver(mapping: dict[str, list[str]]):
    def resolve(host: str) -> list[str]:
        if host not in mapping:
            raise OSError("unknown host")
        return mapping[host]

    return resolve


def _check(url, allowed="", require=False, mapping=None):
    assert_backend_url_allowed(url, allowed, require, _resolver(mapping or {}))


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8000",
        "http://127.5.6.7",
        "http://[::1]:11434",
        "http://10.0.5.20:8000",
        "http://172.16.0.1",
        "http://172.31.255.254",
        "http://192.168.1.10:8000/base",
        "http://[fd12::1]:8000",
        "http://localhost:11434",
        "https://LOCALHOST",
    ],
)
def test_loopback_and_private_are_allowed(url):
    _check(url)


@pytest.mark.parametrize(
    "url",
    ["http://8.8.8.8:9", "http://172.32.0.1", "http://100.64.0.1", "http://[2001:4860::1]", "http://192.169.0.1"],
)
def test_public_addresses_are_rejected(url):
    with pytest.raises(RuntimeError, match="GENERATION_BACKEND_ALLOWED_HOSTS"):
        _check(url)


def test_allowlist_exact_host_port_and_wildcard_case_insensitive():
    _check("http://8.8.8.8:9", allowed="8.8.8.8")
    _check("http://8.8.8.8:9", allowed="8.8.8.8:9")
    with pytest.raises(RuntimeError):
        _check("http://8.8.8.8:9", allowed="8.8.8.8:10")
    _check("https://gw.Corp.Example", allowed="*.corp.example", mapping={"gw.corp.example": ["203.0.113.5"]})
    with pytest.raises(RuntimeError):
        _check("https://corp.example", allowed="*.corp.example", mapping={"corp.example": ["203.0.113.5"]})
    _check("https://GW.corp.example:443", allowed=" GW.CORP.EXAMPLE:443 ", mapping={"gw.corp.example": ["203.0.113.5"]})


def test_require_allowlist_rejects_private_unless_listed():
    with pytest.raises(RuntimeError, match="REQUIRE_ALLOWLIST"):
        _check("http://127.0.0.1:8000", require=True)
    with pytest.raises(RuntimeError, match="REQUIRE_ALLOWLIST"):
        _check("http://localhost:11434", require=True)
    _check("http://127.0.0.1:8000", allowed="127.0.0.1:8000", require=True)


@pytest.mark.parametrize(
    "url",
    ["http://169.254.169.254", "http://[fe80::1]", "http://0.0.0.0:8000", "http://[::]:8000", "http://224.0.0.1"],
)
def test_link_local_unspecified_multicast_always_rejected_even_if_listed(url):
    host = url.split("//")[1].split("/")[0].split(":")[0].strip("[]") if "[" not in url else ""
    allowed = host if host else "fe80::1,::"
    with pytest.raises(RuntimeError, match="링크로컬"):
        _check(url, allowed=allowed)


def test_userinfo_is_rejected_and_message_has_no_credentials():
    with pytest.raises(RuntimeError) as exc:
        _check("http://user:s3cret@127.0.0.1:8000")
    assert "s3cret" not in str(exc.value)


@pytest.mark.parametrize("url", ["ftp://127.0.0.1", "127.0.0.1:8000", "http://"])
def test_bad_scheme_or_missing_host_rejected(url):
    with pytest.raises(RuntimeError):
        _check(url)


def test_name_resolution_all_addresses_must_be_private():
    _check("http://vllm.internal:8000", mapping={"vllm.internal": ["10.0.0.5", "10.0.0.6"]})
    with pytest.raises(RuntimeError, match="사설"):
        _check("http://vllm.internal:8000", mapping={"vllm.internal": ["10.0.0.5", "8.8.4.4"]})


def test_unresolvable_name_rejected_unless_allowlisted():
    with pytest.raises(RuntimeError, match="해석"):
        _check("http://nowhere.invalid:8000")
    _check("http://nowhere.invalid:8000", allowed="nowhere.invalid")


def test_name_resolving_to_link_local_rejected_even_if_listed():
    with pytest.raises(RuntimeError, match="링크로컬"):
        _check("http://meta.internal", allowed="meta.internal", mapping={"meta.internal": ["169.254.169.254"]})
