# Test product candidate: Bitcraze Crazyflie 2.1 Brushless

Researched 2026-10-24. Prices and stock come from search-result summaries and may have changed. Re-check live pages before relying on them.

## What was asked for

Find a drone, or an equivalent product, that we would want to use Rivet for, where:

- the product has about 5 parts,
- every part has a SKU or model number,
- the parts can actually be purchased.

The goal is a realistic test product for the "upload an image, verify it is a real product, then trace every part that makes it up" flow described in [`docs/plan-verified-parts.md`](docs/plan-verified-parts.md) (epic #72).

## Result

The best candidate found is the **Bitcraze Crazyflie 2.1 Brushless**, an open-source micro quadcopter sold as a kit and as individual spare parts.

Four of the five parts have SKUs found at a distributor, and the fifth has a number from one retailer only. The kit itself has a SKU on the manufacturer's own page. Nothing below was independently confirmed on every page; see "Verification status".

| # | Part | Model or SKU found | Source | Price and stock |
|---|------|--------------------|--------|-----------------|
| 1 | Complete kit (control board, 4 motors, guards, battery, propellers) | Bitcraze SKU `100060743`; Robotshop `RB-Bcz-10`, manufacturer # `100060743` | [Bitcraze store](https://store.bitcraze.io/products/crazyflie-2-1-brushless), [Robotshop](https://www.robotshop.com/products/bitcraze-crazyflie-21-brushless) | $480; 3 in stock at Robotshop |
| 2 | Brushless motor 08028-10000KV (kit contains 4) | Model `08028-10000KV`; Robotshop `RB-Bcz-33`; Pakronics listing `114993549` | [Robotshop](https://www.robotshop.com/products/bitcraze-crazyflie-21-brushless-motor-08028-10000kv), [Pakronics](https://www.pakronics.com.au/products/brushless-motor-114993549) | $20 at Bitcraze, $26.54 at Robotshop |
| 3 | 350 mAh LiPo battery | Robotshop `RB-Bcz-18`, manufacturer # `114993131` | [Robotshop](https://www.robotshop.com/products/bitcraze-350mah-lipo-battery) | $12 at Bitcraze, $16.37 at Robotshop; restocking soon |
| 4 | Propellers 55-35, 4 CCW + 4 CW | Robotshop `RB-Bcz-38` (green), `RB-Bcz-32` (black) | [Robotshop green](https://robotshop.com/products/bitcraze-propeller-55-35-4ccw4cw-green), [Robotshop black](https://robotshop.com/products/bitcraze-propeller-55-35-4ccw4cw-black) | $6 at Bitcraze, $7.89 / $7.45 at Robotshop |
| 5 | Legs and guards (5 of each) | `BC-114993546` at Tinytronics only; no Bitcraze or Robotshop SKU found | [Tinytronics](https://www.tinytronics.nl/shop/en/platforms-and-systems/bitcraze-crazyflie) | $10 at Bitcraze, €12.25 at Tinytronics |

Other kit contents (screws, deck connectors, micro-USB cable, foam pad, tools) have no spare-part SKU listed and are not counted as parts here.

## Verification status

What was opened and read directly:

- The Bitcraze kit page and the Bitcraze spare-parts page (page 1 only).

What came from search-result summaries only:

- The Robotshop SKUs and prices, the Pakronics motor listing, and the Tinytronics legs-and-guards number.

Known gaps and conflicts:

- The Bitcraze product page shows a SKU only for the main kit. Its spare-part links use URL slugs and show no part numbers, prices or stock.
- Different retailers use different SKUs for the same part (for example the kit is `RB-Bcz-10` at Robotshop and `RBC-Sed-62` at Robotshop UK). A resolver must match on manufacturer number and brand, not on one retailer's SKU.
- No SKU was found for the control board on its own. The related Crazyflie Bolt 1.1 ($205) is a separate product, and it was not checked whether it is the same board.
- The Crazyflie 2.1+ Brushless sold by Generation Robots (about EUR 600) is a different product. Do not mix its SKUs in.
- The battery was out of stock ("restocking soon") at Robotshop at the time of the search.

## Why it suits Rivet

- It exercises both source tiers that can produce `verified`: manufacturer (Bitcraze) and distributor (Robotshop, Pakronics, Tinytronics).
- The mismatched retailer SKUs and the missing guards SKU make it a natural `partial_match` golden case for issue #87.
- Nearby products (the 2.1+ Brushless, other micro drones) work as "what similar products use" examples.

## Alternative considered

A DIY 5-inch FPV quad (frame, flight controller, ESC, motors, propellers) is a common category. The parts lists found name parts such as the SpeedyBee F405 and EMAX Eco 2207, but no store SKUs were confirmed, so it ranks second.

## Next steps (not done)

- Confirm the Bolt 1.1 relationship and a SKU for the legs and guards at a second source.
- Record the pages as fixtures for the golden set (#87).
