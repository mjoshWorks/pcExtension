# pcExtension

Price-check assistant for **Shopee PH**: shows an item's Original Price,
Product Discount, Shop Voucher and Platform Voucher in one place.

## Why it's not a browser extension anymore

The project started as a desktop Chrome extension (see the original handoff
PDF). The constraint that changed everything: **price checking must happen on
a phone**, and Chrome for Android doesn't support extensions. The project
therefore pivoted to **on-phone automation** that reads the real Shopee app —
logged-in vouchers, app-only promos, zero anti-bot issues.

Full analysis: [`docs/feasibility-notes.md`](docs/feasibility-notes.md).

## Layout

| Path | What it is |
|---|---|
| `automation/shopee-price-check.js` | **The product.** Self-contained AutoX.js script — floating panel that opens a pasted Shopee link in the Shopee app and reads the 4 parameters off the screen |
| `automation/README.md` | Install & usage guide (AutoX.js setup, permissions, troubleshooting) |
| `automation/tests/` | Node.js unit tests for the pure parsing logic |
| `docs/feasibility-notes.md` | Feasibility analysis of the original extension idea and the pivot rationale |

## Quick start

1. Install [AutoX.js](https://github.com/aiselp/AutoX/releases) on your Android phone.
2. Copy `automation/shopee-price-check.js` into AutoX.js's script folder.
3. Grant Accessibility + Overlay + Storage permissions.
4. Run the script → copy a Shopee link → tap **Go** (or browse in Shopee and tap **Read screen**).

See [`automation/README.md`](automation/README.md) for the full guide.

## Status

MVP (v0.1.0), **read-only** by design. Prices are exact; vouchers are the
page-visible "best available" estimate (Shopee finalizes vouchers at
checkout). Variations: select one on screen, then tap *Read screen*.

## Dev

```bash
node automation/tests/test_pure_functions.js   # unit tests (no Android needed)
```
