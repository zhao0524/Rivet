# Five hand-picked products: research and one live run

Researched and run live on 2026-10-24. **Superseded as a data source by the showcase catalogue in
[`plan-showcase.md`](plan-showcase.md)** (`fixtures/showcase/`, ingested from maker parts-list
pages). These five products were curated by hand from shop pages rather than from one parts-list
page, so they do not pass that ingest gate as is. They stay here as research and as search-box
examples: every identifier below works in the **Shop parts** search box, and the results table is
what one live run found. Adding them to the catalogue needs a "curated parts list" manifest entry
(see "Next step" at the end).

## How to run it

```bash
# API: live offers, OpenAI web search (OPENAI_API_KEY from .env or .env.local)
RIVET_OFFERS_PROVIDER=live RIVET_OFFERS_SEARCH=auto uvicorn rivet_api.main:app --port 8000
# Web against that API
NEXT_PUBLIC_RIVET_USE_FIXTURES=false pnpm --filter web dev      # then /studio?shop=1
```

Every product and part identifier below was read from the listed page on 2026-10-24. "Seed pages" are
the shop pages each identifier was read from.

## 1. Bitcraze Crazyflie 2.1 Brushless (drone)

Kit SKU `100060743` at [store.bitcraze.io](https://store.bitcraze.io/products/crazyflie-2-1-brushless) (480 USD).

| Part | Qty | Identifiers | Seed pages |
|---|---|---|---|
| Brushless motor 08028-10000KV | 4 | SKU `114993549`, MPN `08028-10000KV` | Bitcraze; EXP-Tech (alias `170-114993549`) |
| 350 mAh LiPo battery | 1 | SKU `114993131` | Bitcraze |
| Propeller 55-35 (4 CCW + 4 CW), green | 1 | SKU `800000007` | Bitcraze |
| 5 legs + 5 guards | 1 | SKU `114993546` | Bitcraze |
| Control board | 1 | not sold separately | none (shown as "Not sold separately") |

## 2. Raspberry Pi 5 desktop (single-board computer)

| Part | Qty | Identifiers | Seed pages |
|---|---|---|---|
| Raspberry Pi 5, 8 GB | 1 | MPN `SC1112`, GTIN `5056561803326` | Adafruit (alias `5813`) |
| Official 27 W USB-C power supply | 1 | Adafruit `5814` | Adafruit |
| Official Pi 5 case | 1 | Adafruit `5816` | Adafruit |
| Official Active Cooler | 1 | Adafruit `5815` | Adafruit |
| Official micro HDMI to HDMI cable | 1 | Adafruit `4302` | Adafruit |

## 3. SO-ARM101 robot arm (LeRobot)

Assembled kit SKU `100046482` at [Seeed Studio](https://www.seeedstudio.com/SO-ARM-101-Assembled-Kit-Pro-p-6691.html).

| Part | Qty | Identifiers | Seed pages |
|---|---|---|---|
| Feetech ST3215-C047 12 V 30 kg servo | 6 | Seeed `108090003`, MPN `ST3215-C047` | Seeed |
| Feetech ST3215-C044 7.4 V servo, 1:191 | 2 | Seeed `101090141`, MPN `ST3215-C044` | none (web search) |
| Feetech ST3215-C046 7.4 V servo, 1:147 | 3 | Seeed `101090142`, MPN `ST3215-C046` | none (web search) |
| Bus Servo Driver Board for XIAO | 2 | Seeed `105990190` | Seeed |

## 4. 2WD obstacle-avoiding mini rover (Rivet's own product family)

| Part | Qty | Identifiers | Seed pages |
|---|---|---|---|
| Mini Round Robot Chassis Kit, 2WD with DC motors | 1 | Adafruit `3216` | Adafruit |
| ESP32-S3 Feather, 4 MB flash, 2 MB PSRAM | 1 | Adafruit `5477` | Adafruit |
| DC Motor + Stepper FeatherWing | 1 | Adafruit `2927` | Adafruit |
| Ultrasonic distance sensor (HC-SR04 compatible) | 1 | Adafruit `4007` | Adafruit |
| 4 x AA battery holder with switch | 1 | Adafruit `830` | Adafruit |

## 5. Framework Laptop 13 (repairable parts)

| Part | Qty | Identifiers | Seed pages |
|---|---|---|---|
| Battery, 61 Wh | 1 | `FRANGWAT01` | frame.work |
| Power adapter, 60 W USB-C | 1 | `FRANCHPH0B` (regional plug variant) | frame.work |
| USB-C Expansion Card | 2 | `FRACCKBZ01` | frame.work |
| USB-A Expansion Card | 1 | `FRACCABZ01` | frame.work |
| Ethernet Expansion Card | 1 | `FRACCTBZ00` | frame.work |

Framework charged us in CAD and showed regional SKUs because of our location. The engine records the
currency the page itself states and never converts it.

## What one live run found (2026-10-24, OpenAI web search, no distributor API keys)

Ranked offers per part. "No price" means the page confirmed the SKU but published no machine-readable
price with a currency. All prices are as of the check and may have changed.

| Part | Verified offers found |
|---|---|
| Crazyflie motor | none in this run: Bitcraze and EXP-Tech answered 429 (rate limited), RobotShop disallows robots. An earlier run verified the Bitcraze page (no price) |
| Crazyflie battery | Bitcraze 12.00 USD |
| Crazyflie propellers | Pakronics 13.84 AUD, in stock (Bitcraze seed rate-limited this run) |
| Crazyflie legs and guards | Bitcraze 10.00 USD |
| Raspberry Pi 5, 8 GB | Adafruit 200.00 USD in stock; PiShop.us (no price); two unknown brokers, one at 2.40 USD (an implausible price, see plan 9.4) |
| Pi power supply / case / cooler / HDMI cable | Adafruit 14.04 / 12.00 / 13.50 / 11.81 USD, in stock; Jameco also lists the case (no price) |
| SO-ARM101 12 V servo | Seeed 22.00 USD in stock; zavod.dev 3510 RUB backorder |
| SO-ARM101 7.4 V servo 1:191 | Seeed 20.00 USD in stock; zavod.dev 3191 RUB backorder |
| SO-ARM101 7.4 V servo 1:147 | seeedstudio.com.tr (no price, backorder) |
| Bus servo driver board | Seeed 5.90 USD in stock |
| Rover chassis | Adafruit 19.95 USD and Digi-Key 19.95 USD, both out of stock |
| ESP32-S3 Feather | Adafruit 17.50 USD in stock; Digi-Key India 1672.13 INR; Jameco (no price) |
| Motor FeatherWing | Adafruit 19.95 USD; Digi-Key 31.86 CAD; Digi-Key Austria 21.02 EUR; Jameco (no price) |
| Ultrasonic sensor | Adafruit 3.95 USD; Digi-Key Singapore 5.91 SGD |
| Battery holder | Adafruit 2.95 USD; Digi-Key 4.71 CAD; Jameco (no price) |
| Framework battery | Framework 95.00 CAD (stock not stated); two unknown "compatible battery" shops kept as possible matches only |
| Framework charger / USB-C / USB-A / Ethernet | Framework 64.00 / 12.00 / 12.00 / 51.00 CAD |

Ledger entries seen in every run, by design: `needs_api_key` for Mouser, DigiKey, Nexar and element14; `blocked`
for hosts that disallow robots or rate-limit; `skipped` for search and category pages.

## Search box examples

- `08028-10000KV` with manufacturer `Bitcraze`: the motor by MPN.
- `5056561803326`: sent as a GTIN (valid check digit) and matched against JSON-LD `gtin13`.
- `SC1112`: Raspberry Pi part number; brokers and resellers that quote it.
- `FRACCKBZ01`: a Framework SKU, priced from the store's embedded variant data.

## Next step

Extend `ManifestEntry` with an optional curated `parts` list (name, quantity, SKU, MPN,
manufacturer, vendor page URL). Ingest would then fetch each vendor page and verify it exactly as
it does for parts read from a maker page, with `bom_quote` naming the manifest entry as the source.
