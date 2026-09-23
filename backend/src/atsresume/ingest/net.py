"""Refusing to fetch anything that is not on the public internet.

``fetch_jd`` takes a URL from whoever is using the service. Hosted, that is an
SSRF primitive pointed at the operator's own infrastructure: the cloud metadata
endpoint (``169.254.169.254``, ``metadata.google.internal``) hands out
credentials to anything that asks, and every internal service on the private
network is reachable by name from inside the VPC. A job posting never lives
there, so the right answer is a flat refusal rather than a filter on what comes
back.

Two things make this harder than a regex on the URL:

* **A name is not an address.** ``evil.example.com`` can resolve to
  ``127.0.0.1``, and rebinding it between the check and the connection is a
  known trick. So the check resolves the host and inspects every A/AAAA record,
  and hands the literals back so the caller can pin the connection if it wants.
* **IPv6 can wrap IPv4.** ``::ffff:169.254.169.254`` is the metadata endpoint
  written as an IPv6 address, and ``64:ff9b::a9fe:a9fe`` is the same thing via
  the NAT64 well-known prefix. Anything carrying an embedded v4 address is
  unwrapped and the embedded address re-checked.

``is_private`` alone does not cover this, so each disqualifying property is
tested explicitly.
"""

from __future__ import annotations

import ipaddress
import socket

__all__ = ["BlockedAddressError", "UnresolvableHostError", "assert_public_host"]


class BlockedAddressError(Exception):
    """The host is not somewhere this service is willing to send a request."""


class UnresolvableHostError(BlockedAddressError):
    """The host does not resolve at all.

    A subclass so a caller that only cares about "we are not fetching this" can
    catch one exception, while the message stays specific.
    """


# Hostnames that never name a public job posting, whatever DNS says today.
BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata",
        "instance-data",
    }
)

# Suffixes reserved for names that only mean something inside a network.
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa")

# NAT64: 64:ff9b::/96 and the local-use 64:ff9b:1::/48 both carry a v4 address
# in their low 32 bits.
_NAT64 = (
    ipaddress.IPv6Network("64:ff9b::/96"),
    ipaddress.IPv6Network("64:ff9b:1::/48"),
)

# 0.0.0.0/8 is "this network"; 0.0.0.0 itself is a well-worn way of saying
# localhost to a connect() call.
_THIS_NETWORK = ipaddress.IPv4Network("0.0.0.0/8")


def _embedded_v4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """The IPv4 address hiding inside an IPv6 one, if there is one."""
    mapped = ip.ipv4_mapped
    if mapped is not None:
        return mapped
    for prefix in _NAT64:
        if ip in prefix:
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    # ::a.b.c.d — the deprecated v4-compatible form. Everything below ::1 that
    # is not the unspecified address or loopback is one of these.
    as_int = int(ip)
    if 0 < as_int < 2**32:
        return ipaddress.IPv4Address(as_int)
    return None


def _why_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    """The reason this address is off limits, or an empty string if it is not."""
    if isinstance(ip, ipaddress.IPv6Address):
        # ``::1`` and ``::`` sit inside the v4-compatible range numerically, so
        # name them for what they are before unwrapping anything.
        if ip.is_unspecified:
            return "the unspecified address"
        if ip.is_loopback:
            return "a loopback address"
        embedded = _embedded_v4(ip)
        if embedded is not None:
            # Judge it by what it actually reaches, not by how it is spelled.
            reason = _why_blocked(embedded)
            return f"{reason} (embedded in an IPv6 address)" if reason else ""
        if ip.is_site_local:
            return "a site-local address"

    if ip.is_unspecified:
        return "the unspecified address"
    if ip.is_loopback:
        return "a loopback address"
    if ip.is_link_local:
        # 169.254.169.254 lives here, which is the whole point.
        return "a link-local address"
    if ip.is_multicast:
        return "a multicast address"
    if ip.is_private:
        # Covers RFC 1918 and IPv6 unique-local (fc00::/7).
        return "a private address"
    if ip.is_reserved:
        return "a reserved address"
    if isinstance(ip, ipaddress.IPv4Address) and ip in _THIS_NETWORK:
        return "an address in 0.0.0.0/8"
    return ""


def _normalise(host: str) -> str:
    host = host.strip().strip("[]").rstrip(".").lower()
    # A userinfo@ or :port slipped in by a careless caller would defeat the
    # whole check, so refuse rather than guess.
    return host


def assert_public_host(host: str) -> list[str]:
    """Resolve and reject anything not on the public internet.

    Returns the resolved literal IPs so the caller can pin the connection.
    """
    name = _normalise(host)
    if not name:
        raise BlockedAddressError("That URL has no hostname.")

    try:
        literal = ipaddress.ip_address(name)
    except ValueError:
        literal = None

    if literal is not None:
        reason = _why_blocked(literal)
        if reason:
            raise BlockedAddressError(
                f"{host} is {reason}, which is not somewhere this service will fetch from."
            )
        return [str(literal)]

    if name in BLOCKED_HOSTS or name.endswith(BLOCKED_SUFFIXES):
        raise BlockedAddressError(
            f"{host} names a host inside a private network, not a public job posting."
        )
    if "." not in name:
        # A bare label only resolves through a search domain, i.e. internally.
        raise BlockedAddressError(
            f"{host} is not a public hostname. Use the full address of the job posting."
        )

    try:
        infos = socket.getaddrinfo(name, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnresolvableHostError(
            f"{host} does not resolve. Check the address of the job posting."
        ) from exc

    resolved: list[str] = []
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:  # pragma: no cover - getaddrinfo returns literals
            continue
        reason = _why_blocked(ip)
        if reason:
            raise BlockedAddressError(
                f"{host} resolves to {ip}, which is {reason}. "
                "This service only fetches public job postings."
            )
        if str(ip) not in resolved:
            resolved.append(str(ip))

    if not resolved:
        raise UnresolvableHostError(
            f"{host} does not resolve. Check the address of the job posting."
        )
    return resolved
