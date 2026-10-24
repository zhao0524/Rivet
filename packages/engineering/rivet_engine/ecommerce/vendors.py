"""Vendor registry and denylist (plan 3.2 steps 3 and 5).

Known shops map to a stable vendor id and tier; unknown hosts are kept with tier `unknown` so
the user still sees the offer, labelled. Price aggregators and affiliate link farms are dropped
because they never are the page a part is bought from. Changed by PR, never by a model.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from rivet_engine.ecommerce.models import Vendor, VendorTier
from rivet_engine.sourcing.evidence import HOST_TIERS, HostTier, host_of

# domain -> (vendor id, display name, tier). Longest matching suffix wins.
VENDORS: dict[str, tuple[str, str, VendorTier]] = {
    "adafruit.com": ("adafruit", "Adafruit Industries", "manufacturer"),
    "sparkfun.com": ("sparkfun", "SparkFun Electronics", "manufacturer"),
    "pololu.com": ("pololu", "Pololu", "manufacturer"),
    "seeedstudio.com": ("seeedstudio", "Seeed Studio", "manufacturer"),
    "dfrobot.com": ("dfrobot", "DFRobot", "manufacturer"),
    "pimoroni.com": ("pimoroni", "Pimoroni", "manufacturer"),
    "thepihut.com": ("thepihut", "The Pi Hut", "authorized_distributor"),
    "digikey.com": ("digikey", "Digi-Key", "authorized_distributor"),
    "digikey.ca": ("digikey", "Digi-Key", "authorized_distributor"),
    "digikey.co.uk": ("digikey", "Digi-Key", "authorized_distributor"),
    "mouser.com": ("mouser", "Mouser Electronics", "authorized_distributor"),
    "mouser.co.uk": ("mouser", "Mouser Electronics", "authorized_distributor"),
    "mouser.de": ("mouser", "Mouser Electronics", "authorized_distributor"),
    "element14.com": ("element14", "element14", "authorized_distributor"),
    "newark.com": ("newark", "Newark", "authorized_distributor"),
    "farnell.com": ("farnell", "Farnell", "authorized_distributor"),
    "arrow.com": ("arrow", "Arrow Electronics", "authorized_distributor"),
    "rs-online.com": ("rs-online", "RS", "authorized_distributor"),
    "lcsc.com": ("lcsc", "LCSC Electronics", "authorized_distributor"),
    "robotshop.com": ("robotshop", "RobotShop", "reseller"),
    "amazon.com": ("amazon", "Amazon", "marketplace"),
    "amazon.co.uk": ("amazon", "Amazon", "marketplace"),
    "amazon.de": ("amazon", "Amazon", "marketplace"),
    "amazon.ca": ("amazon", "Amazon", "marketplace"),
    "ebay.com": ("ebay", "eBay", "marketplace"),
    "ebay.co.uk": ("ebay", "eBay", "marketplace"),
    "ebay.de": ("ebay", "eBay", "marketplace"),
    "aliexpress.com": ("aliexpress", "AliExpress", "marketplace"),
    "aliexpress.us": ("aliexpress", "AliExpress", "marketplace"),
    # SYNTHETIC TEST-ONLY vendors on reserved .example hosts (never fetched live).
    "maker-shop.example": ("maker-shop", "Maker Shop (TEST)", "manufacturer"),
    "dist-one.example": ("dist-one", "Dist One (TEST)", "authorized_distributor"),
    "dist-two.example": ("dist-two", "Dist Two (TEST)", "authorized_distributor"),
    "eu-reseller.example": ("eu-reseller", "EU Reseller (TEST)", "reseller"),
    "bargain-bay.example": ("bargain-bay", "Bargain Bay (TEST)", "marketplace"),
}

# Price comparison sites, datasheet mirrors and affiliate link farms: never a checkout page.
DENYLIST: frozenset[str] = frozenset(
    {
        "pricegrabber.com",
        "shopzilla.com",
        "pricerunner.com",
        "idealo.de",
        "idealo.co.uk",
        "google.com",
        "shopping.google.com",
        "bing.com",
        "findchips.com",
        "oemsecrets.com",
        "octopart.com",
        "alldatasheet.com",
        "datasheetspdf.com",
        "datasheet4u.com",
        "slickdeals.net",
        "dealnews.com",
        "camelcamelcamel.com",
        "pinterest.com",
        "facebook.com",
        "youtube.com",
        "affiliate-spam.example",
        "price-aggregator.example",
    }
)

HOST_TIER_TO_VENDOR_TIER: dict[HostTier, VendorTier] = {
    "manufacturer": "manufacturer",
    "distributor": "authorized_distributor",
    "teardown": "unknown",
    "community": "unknown",
}

_ID_CLEAN = re.compile(r"[^a-z0-9_.-]+")


def _suffix_match(host: str, table) -> str | None:
    best: str | None = None
    for domain in table:
        if host == domain or host.endswith("." + domain):
            if best is None or len(domain) > len(best):
                best = domain
    return best


def registrable_domain(host: str) -> str:
    """The shop-level domain for an unknown host: last two labels, or three for ccSLDs like co.uk."""
    labels = host.split(".")
    if len(labels) >= 3 and labels[-2] in {"co", "com", "org", "net", "ac", "gov"} and len(labels[-1]) == 2:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:]) if len(labels) >= 2 else host


def is_denylisted(url: str) -> bool:
    host = host_of(url)
    return bool(host) and _suffix_match(host, DENYLIST) is not None


def vendor_for_url(url: str) -> Vendor:
    """Vendor record for a page URL. Unknown hosts get tier `unknown` and an id from the domain."""
    host = host_of(url)
    if not host or urlparse(url).scheme != "https":
        raise ValueError(f"vendor lookup needs an https URL, got {url[:80]!r}")
    known = _suffix_match(host, VENDORS)
    if known is not None:
        vendor_id, name, tier = VENDORS[known]
        return Vendor(id=vendor_id, name=name, tier=tier, domain=known)
    domain = registrable_domain(host)
    allowlisted = _suffix_match(host, HOST_TIERS)
    tier: VendorTier = HOST_TIER_TO_VENDOR_TIER[HOST_TIERS[allowlisted]] if allowlisted else "unknown"
    vendor_id = _ID_CLEAN.sub("-", domain.lower()).strip("-.")[:63] or "unknown"
    return Vendor(id=vendor_id, name=domain, tier=tier, domain=domain)


def is_synthetic_vendor(vendor: Vendor) -> bool:
    return vendor.domain.endswith(".example")


__all__ = [
    "DENYLIST",
    "HOST_TIER_TO_VENDOR_TIER",
    "VENDORS",
    "is_denylisted",
    "is_synthetic_vendor",
    "registrable_domain",
    "vendor_for_url",
]
