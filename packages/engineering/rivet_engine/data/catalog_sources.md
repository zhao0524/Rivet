# Catalog source ledger — `catalog-v1.1-2026-10-24`

Every value in `components.json` traces to a page below, or is marked `approximated` /
`unverified` / `unknown` in the record's `evidence`. All pages were read on **2026-10-24**.
Prices are the single-unit (1–9) USD list price on that date. Stock status is as shown
that day and will drift.

## Conventions

- `current_limit_a` on a **motor** port is the measured **stall** current at the top of
  the rated voltage. On a **driver output** it is the **continuous** per-channel rating;
  peak ratings are in the port `notes`.
- `voltage_min_v` / `voltage_max_v` on a supply output is the expected output range. On an
  input it is the accepted range. On I2C pins it is the accepted logic range.
- `price_amount: "0.00"` is used only for parts that ship inside another kit
  (Shadow Chassis nub caster and battery holder). They are never bought separately.
- One BOM unit = one purchasable item as sold (the jumper wire pack is one unit of 40 wires).
- Mount positions and `allowed_mates` are a rendering/placement model, not measured CAD.
  Records that say `bounds_verified: false` or `dimensions: "approximated"` must not be
  used for a verified clearance claim.

## Parts

| catalog_id | Source | What the source states | What remains unknown or approximated |
|---|---|---|---|
| `board.esp32_devkitc_v4_wroom32e` | [Adafruit 3269](https://www.adafruit.com/product/3269), [Espressif DevKitC guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html), [ESP32 datasheet](https://cdn-shop.adafruit.com/product-files/3269/esp32_datasheet_en_0.pdf) | ESP32-WROOM-32E module; 55.3 × 28.0 × 12.9 mm; $15.00; out of stock. Header pin table; GPIO6–11 wired to SPI flash ("avoid using these pins"); IO34/35/36/39 type I; power from micro-USB, 5V pin or 3V3 pin, only one at a time | 3V3 regulator current; USB input tolerance (USB 2.0 nominal used); no mounting holes (foam-tape mount assumed) |
| `driver.adafruit_tb6612_2448` | [Adafruit 2448](https://www.adafruit.com/product/2448), [Learn guide pinouts](https://learn.adafruit.com/adafruit-tb6612-h-bridge-dc-stepper-motor-driver-breakout/pinouts) | VM 4.5–13.5 V; Vcc 2.7–5.5 V; 1.2 A continuous per channel, 3 A peak ~20 ms; 27 × 19 × 3 mm; 1.8 g; STBY 10K pull-up; $6.95; in stock | Thermal limits for sustained stall |
| `motor.adafruit_tt_gearbox_200rpm_3777` | [Adafruit 3777](https://www.adafruit.com/product/3777), [diagram](https://cdn-shop.adafruit.com/product-files/3777/3777_diagram.jpg) | 3–6 VDC; no-load 150–160 mA; measured stall 1.1 A @3 V, 1.2 A @4.5 V, 1.5 A @6 V; 1:48; 70 × 22 × 18 mm; 30.6 g; $2.95; in stock | Shaft offset inside the body (approximated); fit in Shadow Chassis motor mounts assumed from TT form factor |
| `wheel.adafruit_tt_wheel_3766` | [Adafruit 3766](https://www.adafruit.com/product/3766) | One wheel per order; TT gearbox motors only; 63 × 29 mm; $1.50; in stock | Which figure is diameter (63 mm diameter assumed) |
| `chassis.sparkfun_shadow_rob13301` | [SparkFun ROB-13301](https://www.sparkfun.com/products/13301) | 196 × 126 × 44 mm (53.25 mm with nub caster); includes plates, motor mounts, struts, micro-controller mounts, battery pack clip, one nub caster, one 4xAA holder with barrel jack; $14.95; in stock | Mount coordinates (approximated); compatible motor SKUs not listed |
| `caster.sparkfun_shadow_nub` | [SparkFun ROB-13301](https://www.sparkfun.com/products/13301) | Included in kit | Dimensions (approximated from the 53.25 mm overall height) |
| `power.sparkfun_shadow_4xaa_holder` | [SparkFun ROB-13301](https://www.sparkfun.com/products/13301) | Included in kit; barrel jack termination | Output 3.2–6.4 V derived from 4 × the listed alkaline cell range; current rating; plug size and polarity; dimensions |
| `accessory.adafruit_aa_alkaline_4pack_3349` | [Adafruit 3349](https://www.adafruit.com/product/3349) | 4 alkaline AA cells; 1.6 V fresh to 0.8 V dead; typically 3000 mAh; $2.95; in stock | Dimensions (standard AA size assumed) |
| `power.adafruit_usb_power_bank_5000_4288` | [Adafruit 4288](https://www.adafruit.com/product/4288) | 5000 mAh; 2 × USB-A 5 V up to 2.1 A; 90 × 63 × 12.5 mm; 101 g; $26.95; in stock | Per-port current split |
| `sensor.adafruit_vl53l0x_3317` | [Adafruit 3317](https://www.adafruit.com/product/3317), [Learn guide pinouts](https://learn.adafruit.com/adafruit-vl53l0x-micro-lidar-distance-sensor-breakout/pinouts) | Vin 3–5 V; level-shifted I2C; address 0x29; ~30–1200 mm; ~35° cone; 21 × 18 × 2.8 mm; 1.3 g; $14.95; in stock | Range on dark or angled targets |
| `sensor.adafruit_vl53l1x_3967` | [Adafruit 3967](https://www.adafruit.com/product/3967) | "3–5 V power or logic"; level shifting; address 0x29; up to 400 cm; 27° FoV; 25.5 × 17.5 × 4.6 mm; 1.8 g; $14.95; in stock | Formal Vin rating; XSHUT/GPIO levels |
| `wiring.adafruit_stemma_qt_to_male_4209` | [Adafruit 4209](https://www.adafruit.com/product/4209) | 150 mm; red 3.3 V, black GND, blue SDA, yellow SCL; $0.95; in stock | — |
| `wiring.adafruit_jumper_mm_40x150_758` | [Adafruit 758](https://www.adafruit.com/product/758) | 40 × 150 mm male/male, 28 AWG; $3.95; in stock | — |
| `wiring.adafruit_usb_a_microb_3ft_592` | [Adafruit 592](https://www.adafruit.com/product/592) | USB A to Micro-B, ~1 m; $2.95; in stock | — |
| `accessory.adafruit_dc_jack_terminal_368` | [Adafruit 368](https://www.adafruit.com/product/368) | 2.1 mm DC jack to screw terminals; $2.00; in stock | Voltage/current rating; dimensions; match to the holder's plug |
| `accessory.adafruit_half_breadboard_64` | [Adafruit 64](https://www.adafruit.com/product/64) | 400 tie points; 82.6 × 55 × 9.3 mm; adhesive foam back; $4.95; in stock | — |

## ESP32 pin restrictions

Strapping pins GPIO0/2/5/12/15, input-only GPIO34–39, flash GPIO6–11 and TXD/RXD on GPIO1/3 are
confirmed on the [ESP-IDF GPIO reference](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html).
The ESP32 datasheet PDF linked from the Adafruit page was **not** read. ESP-IDF also says GPIO16–17
are "usually connected to the SPI flash and PSRAM"; the DevKitC guide reserves them only on WROVER
modules. This board is WROOM-32E, but the wiring profile allocates 16/17 last so the default rover
does not use them.

## Physical fit (`fit_evidence.json`)

Mount kinds in `components.json` are a geometry model, not proof that parts fit. `fit_evidence.json`
records, per mounted pair, whether a source documents the fit:

- **Documented:** TT wheel on TT motor (Adafruit 3766); nub caster and 4xAA holder on the Shadow
  Chassis (both ship with it).
- **Not documented, blocking:** Adafruit TT motor in the Shadow Chassis motor mounts. SparkFun's
  [assembly guide](https://learn.sparkfun.com/tutorials/assembly-guide-for-redbot-with-shadow-chassis)
  uses the Hobby Gearmotor (ROB-13302) with ROB-13259 wheels.
- **Not documented, advisory:** foam-tape/breadboard placement of the ESP32 board, driver, power
  bank and range sensor.

## Considered and not used

- **Adafruit 3216 Mini Round Robot Chassis Kit:** out of stock on 2026-10-24, and it bundles motors and wheels (the BOM would double-count them).
- **SparkFun ROB-13302 Hobby Gearmotor (pair):** stall current not published (only a 250 mA max load), so a current check could never pass; also sold as a pair.
- **SparkFun ROB-13259 65 mm wheel (pair):** sold in pairs and fits DAGU motors, not confirmed for the TT motor.
- **Adafruit 1959 USB battery pack:** no longer stocked.
- **HC-SR04 ultrasonic sensors:** 5 V echo output needs a level shifter for ESP32 inputs (spec §6 B1).
