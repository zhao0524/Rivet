"""Hand-picked real products suggested for the parts of a concept model.

A concept part is a shape, not a product. For common internal roles (a drone's flight
controller, a gadget's microcontroller, ...) this table names one real product that fills the
role, so the Buy step has somewhere to start. Each entry was fetched from the vendor page on
`CHECKED_AT` with the SKU and price read from the page; `scripts/check_reference_parts.py`
re-checks them. Suggestions are labelled `manufacturer_reference_only`, never
`verified_product`: they were not checked against the concept's sizes, power or wiring.

Only URLs from this table may appear in a concept plan (`check_concept_plan`), so a vision
model can never put its own links in front of the user.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CHECKED_AT = "2026-10-24T00:00:00Z"


@dataclass(frozen=True)
class ReferencePart:
    role: str
    pattern: re.Pattern[str]
    title: str
    vendor: str
    sku: str
    url: str
    price: str
    pack_size: int = 1
    currency: str = "USD"

    def unit_price(self, count: int) -> str:
        """Price per concept part: a 4-pack shared by four props costs a quarter each, but a single
        part drawn as the whole 4-in-1 ESC (or one prop that still needs the pack) costs the whole pack."""
        return f"{float(self.price) / max(1, min(self.pack_size, count)):.2f}"

    @property
    def note(self) -> str:
        pack = f", sold as {self.pack_size} in one ({self.price} {self.currency}); shared across the parts that use it" if self.pack_size > 1 else ""
        return (
            f"Suggested real part for this role: {self.title} ({self.vendor}, SKU {self.sku}){pack}. "
            "Hand-picked, not checked against this design's size, power or wiring."
        )


def _p(role: str, pattern: str, title: str, vendor: str, sku: str, url: str, price: str, pack_size: int = 1) -> ReferencePart:
    return ReferencePart(role, re.compile(pattern, re.I), title, vendor, sku, url, price, pack_size)


_RDQ = "RaceDayQuads"
_RDQ_URL = "https://www.racedayquads.com/products/"

# A 5" 4S quadcopter that fits together: 30x30 flight controller and 4-in-1 ESC, 2207 motors.
DRONE_PARTS: tuple[ReferencePart, ...] = (
    _p("flight_controller", r"flight\s*controller|\bfc\b", "JHEMCU GF30F745 3-6S HD 30x30 Flight Controller", _RDQ,
       "FPVE-JHEMCU-GF30F745-FC-30x30", _RDQ_URL + "jhemcu-gf30f745-3-6s-hd-30x30-flight-controller-mpu6000", "55.49"),
    _p("esc", r"\besc\b|speed\s*controller", "Holybro Tekko32 F4 Metal 65A AM32 4-in-1 ESC (30x30)", _RDQ,
       "23157", _RDQ_URL + "holybro-tekko32-f4-metal-65a-am32-4-in-1-esc", "107.99", pack_size=4),
    _p("power_distribution", r"power\s*distribution|\bpdb\b", "MATEKSYS FCHUB 12S V2 PDB", _RDQ,
       "22614", _RDQ_URL + "draft-pdb-fchub-12s-v2-for-xclass", "35.99"),
    _p("receiver", r"receiver|\brx\b", "RadioMaster RP1 V2 2.4GHz ELRS Nano Receiver", _RDQ,
       "19362", _RDQ_URL + "radiomaster-rp1-v2-2-4ghz-elrs-nano-receiver", "24.99"),
    _p("gps", r"\bgps\b", "HGLRC M100 Pro GPS Module", _RDQ,
       "23368", _RDQ_URL + "hglrc-m100-pro-gps-module", "18.49"),
    _p("camera", r"camera(?!\s*(lens|gimbal|mount|housing))", "Foxeer Mini Cat 4 1200TVL StarLight FPV Camera", _RDQ,
       "23573", _RDQ_URL + "foxeer-mini-cat-4-1200tvl-starlight-fpv-camera", "46.49"),
    _p("motor", r"motor", "iFlight XING2 2207 Unibell Motor 2050KV", _RDQ,
       "23540", _RDQ_URL + "iflight-xing2-2207-unibell-motor-2050kv", "26.99"),
    _p("propeller", r"propeller|\bprop\b|rotor", "HQ Prop 5x4.3x3 V1S Tri-Blade 5\" Prop (4 pack)", _RDQ,
       "7292", _RDQ_URL + "hq-v1s-5x4-3x3-5-prop-choose-your-color", "4.99", pack_size=4),
    _p("battery", r"battery|lipo", "CNHL MiniStar 14.8V 4S 1500mAh 120C LiPo Battery (XT60)", _RDQ,
       "9075", _RDQ_URL + "cnhl-1500mah-120c-4s-ministar-li-po-battery", "36.49"),
    _p("frame", r"\bframe\b|\barms?\b", "DeepSpace Seeker 5 DC Frame Kit (arms and plates)", _RDQ,
       "23644", _RDQ_URL + "deepspace-seeker-5-dc-frame-kit", "69.49", pack_size=4),
)

# Small hobby electronics: a microcontroller, motor driver, motors, wheels, sensors, battery.
GADGET_PARTS: tuple[ReferencePart, ...] = (
    _p("motor_driver", r"motor\s*driver|h-?bridge", "SparkFun Motor Driver - Dual TB6612FNG (with Headers)", "SparkFun",
       "ROB-14450", "https://www.sparkfun.com/sparkfun-motor-driver-dual-tb6612fng-with-headers.html", "14.50"),
    _p("microcontroller", r"micro\s*controller|\bmcu\b|esp32|arduino|(controller|control|main|logic|circuit)\s*board|\bpcb\b",
       "Adafruit HUZZAH32 - ESP32 Feather Board", "Adafruit",
       "3405", "https://www.adafruit.com/product/3405", "19.95"),
    _p("servo", r"servo", "Micro servo", "Adafruit", "169", "https://www.adafruit.com/product/169", "5.95"),
    _p("gear_motor", r"motor", "Hobby Gearmotor - 140 RPM (Pair)", "SparkFun",
       "ROB-13302", "https://www.sparkfun.com/hobby-gearmotor-140-rpm-pair.html", "7.50", pack_size=2),
    _p("wheel", r"wheel|tire|tyre", "Wheel - 65mm (Rubber Tire, Pair)", "SparkFun",
       "ROB-13259", "https://www.sparkfun.com/wheel-65mm-rubber-tire-pair.html", "4.50", pack_size=2),
    _p("distance_sensor", r"ultrasonic|distance\s*sensor|range\s*(finder|sensor)|sonar", "Ultrasonic Distance Sensor - 5V (HC-SR04)",
       "SparkFun", "SEN-15569", "https://www.sparkfun.com/ultrasonic-distance-sensor-hc-sr04.html", "5.25"),
    _p("gps", r"\bgps\b", "Adafruit Ultimate GPS Breakout - 66 channel w/10 Hz updates", "Adafruit",
       "746", "https://www.adafruit.com/product/746", "29.95"),
    _p("battery", r"battery|lipo", "Lithium Ion Polymer Battery - 3.7v 500mAh", "Adafruit",
       "1578", "https://www.adafruit.com/product/1578", "7.95"),
)

ALL_PARTS: tuple[ReferencePart, ...] = DRONE_PARTS + GADGET_PARTS
REFERENCE_URLS: frozenset[str] = frozenset(p.url for p in ALL_PARTS)

_DRONE = re.compile(r"drone|quad-?copter|multi-?rotor|hexa-?copter|uav|fpv", re.I)
# Shapes that are part of a bigger product and never bought on their own.
_NOT_A_PRODUCT = re.compile(r"\b(lens|gimbal|cover|shell|housing|body|leg|skid|case|enclosure|lid|antenna|wire|cable)\b", re.I)


def suggest(object_type: str, part_name: str, category: str) -> ReferencePart | None:
    """The suggested product for one concept part, or None when no curated role fits it."""
    if category == "wire" or _NOT_A_PRODUCT.search(part_name):
        return None
    table = DRONE_PARTS if _DRONE.search(object_type) else GADGET_PARTS
    return next((p for p in table if p.pattern.search(part_name)), None)
