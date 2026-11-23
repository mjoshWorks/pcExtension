# Shopee Price Check — on-phone automation (AutoX.js)

A floating panel that reads **4 parameters** off any Shopee product page on your
phone — the same spec as the original PDF handoff:

| Field | Where it comes from |
|---|---|
| **Original Price** | the struck-through price shown next to the sale price |
| **Product Discount** | original − current price, plus the `-20%` badge when visible |
| **Shop Voucher** | offer text near the "Shop voucher" row on the product page |
| **Platform Voucher** | offer text near the "Platform/Shopee voucher" row |

Everything is read from the **real Shopee app** on **your** logged-in account —
so app-only promos and your own vouchers are visible to it. No backend, no
anti-bot problem, no store review, no fees.

> ⚠️ **Read-only by design.** The script never taps vouchers, never adds to
> cart, never checks out. Automating claims/purchases is the pattern that gets
> Shopee accounts banned. Keep it a reader.

---

## Requirements

- Android 7.0 or newer
- The **Shopee app** (e.g. shopee.ph), installed and **logged in**
- **AutoX.js** — a free, open-source Android automation app that runs
  JavaScript and can read any app's screen (accessibility API, no root)

## Step 1 — Install AutoX.js

1. Download the latest APK from one of these GitHub releases pages:
   - **AutoX v7 (actively maintained):** https://github.com/aiselp/AutoX/releases
   - AutoX v6 (older, widely used): https://github.com/kkevsekk1/AutoX/releases
   - AutoJs6 (alternative): https://github.com/SuperMonster003/AutoJs6/releases
2. Open the APK on your phone (allow "install unknown apps" if asked) and install.
3. Open AutoX.js once.

## Step 2 — Put the script on the phone

1. Get `shopee-price-check.js` onto the phone (download it, or copy it over USB).
2. Find AutoX.js's script folder: open the app → menu/drawer → **Settings →
   Script path** (default is usually `/sdcard/脚本/` or `/sdcard/Scripts/`).
3. Copy the `.js` file into that folder.
4. The script now appears in AutoX.js's file list.

## Step 3 — Grant the permissions (one-time)

Run the script once, then grant when prompted (or set these in advance):

| Permission | Where | Why |
|---|---|---|
| **Accessibility service** | Settings → Accessibility → AutoX.js → ON | reading the Shopee screen |
| **Display over other apps** | Settings → Apps → AutoX.js → Appear on top | the floating panel |
| **Storage** | AutoX.js prompt | the CSV log + UI dumps |

Keep the AutoX **Accessibility service ON** — it is what lets the script read
Shopee's screen and start the app from the background.

## Step 4 — Use it

Run `shopee-price-check.js` from AutoX.js. A small panel appears:

```
🛒 Shopee Price Check                              ✕
[ Paste Shopee link (empty = use clipboard)      ]
[ Go ]  [ Read screen ]  [ Dump UI ]
Ready. …
```

**Two ways to price-check:**

- **A — you already have a link:** copy the Shopee link anywhere (Shopee app →
  Share → Copy link), switch to the panel, tap **Go**. It resolves short links
  (`shope.ee`, `s.shopee.ph`), opens the product in the Shopee app, waits for
  the page, reads it, and shows the 4 fields.
- **B — you're already browsing:** open the product in the Shopee app (for
  products with variations, tap the variation you want first), then tap
  **Read screen**.

Drag the panel by its orange title to move it. Every result is also appended
to `price_log.csv` next to the script (timestamp, IDs, values, notes).

> 💡 Android 10+ may block background clipboard reads. If **Go** says no link
> was found, paste the link into the panel's input box instead (long-press →
> Paste) and tap **Go** again.

---

## What the result means

```
Item 13113966246 · shop 117867014
Original Price: ₱1,000.00
Product Discount: -₱200.00 (-20%)
Shop Voucher: ₱50 off min spend ₱500
Platform Voucher: 15% off  ·  Free Shipping
— vouchers are page-visible offers; final discount depends on claiming & checkout
```

- **Prices** are exact — read from the app's own display.
- **Vouchers** are the offers *visible on the page for your account*. Shopee
  sometimes personalizes/finalizes vouchers at checkout, so treat them as the
  **best-available estimate**, exactly like the original PDF concluded.
- **Variations**: by design (per the PDF conversation), the script reads
  whatever variation is selected on screen; use *Read screen* after picking one.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Enable the AutoX.js Accessibility service" | Settings → Accessibility → AutoX.js → ON, run script again |
| Floating panel never appears | Allow "Display over other apps" for AutoX.js |
| "The Shopee app did not come to the front" | The link opened in a browser instead of the app — open the product in the Shopee app, then tap **Read screen**. Also make sure Shopee is installed & logged in |
| Price found but vouchers say "none found" | Scroll the product page so the voucher rows are visible, tap **Read screen** again |
| Everything says "not found" after a Shopee app update | The layout changed — tap **Dump UI** and send me the `dump_*.txt` file so the patterns can be re-tuned |
| Go says no link found | Android 10+ clipboard restriction — paste the link into the input box manually |
| Panel disappears when Shopee is fullscreen | Disable battery optimization for AutoX.js (some ROMs kill background apps; lock AutoX in Recents on MIUI/ColorOS/One UI) |

## For maintainers (how it works)

- `shopee-price-check.js` is a **single self-contained file** — easiest thing
  to copy onto a phone.
- The **pure logic** (link parsing, number formatting, text-pattern tables)
  lives between `PURE_BEGIN` / `PURE_END` markers and is unit-tested under
  Node.js: `node automation/tests/test_pure_functions.js`.
- Screen extraction walks the **accessibility tree** and matches text
  patterns (`PRICE_RE`, `PCT_OFF_RE`, `VOUCHER_OFFER_RE`) — deliberately not
  resource-ids, which Shopee reshuffles between releases. Off-screen nodes
  (including our own hidden panel) are excluded by bounds checks.
- If patterns drift, run **Dump UI** on a product page and compare what Shopee
  now renders against the regexes at the top of the file.

## Rules & limits

- Personal, read-only use. Don't add auto-claim/auto-checkout — ban risk.
- English/₱ (Philippines) UI patterns are assumed; other Shopee regions need
  their own currency/label patterns.
- Heuristics, not a contract: Shopee can move rows around at any time.
