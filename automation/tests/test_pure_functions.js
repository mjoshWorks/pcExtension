#!/usr/bin/env node
/**
 * Node.js unit tests for the pure functions inside automation/shopee-price-check.js.
 *
 * The pure block (between PURE_BEGIN / PURE_END markers) contains no Android
 * APIs, so it can be evaluated directly under Node.js.
 *
 * Run from the repo root:
 *     node automation/tests/test_pure_functions.js
 *
 * NOTE: deliberately NOT "use strict" — strict-mode eval scopes function
 * declarations inside itself, and the tests rely on them leaking into scope.
 */

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "shopee-price-check.js"),
  "utf8"
);

const match = src.match(/\/\/ =+ PURE_BEGIN =+([\s\S]*?)\/\/ =+ PURE_END =+/);
if (!match) {
  console.error("FAIL: PURE_BEGIN/PURE_END block not found in shopee-price-check.js");
  process.exit(1);
}
// eslint-disable-next-line no-eval
eval(match[1]);

let failures = 0;
let total = 0;

function check(name, actual, expected) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log("ok   " + name);
  } else {
    failures++;
    console.log("FAIL " + name);
    console.log("  expected: " + JSON.stringify(expected));
    console.log("  actual:   " + JSON.stringify(actual));
  }
}

// ---------------------------------------------------------------------------
// parseShopeeLink
// ---------------------------------------------------------------------------
check("parse canonical /product/ URL", parseShopeeLink("https://shopee.ph/product/117867014/13113966246"), {
  ok: true,
  shopId: "117867014",
  itemId: "13113966246",
  region: "shopee.ph",
  canonical: "https://shopee.ph/product/117867014/13113966246",
  shortLink: false,
});

const slug = parseShopeeLink("https://shopee.ph/Xiaomi-Redmi-12-8GB-128GB-i.117867014.13113966246?af_site=x&pid=y");
check("slug -i. shopId", slug.shopId, "117867014");
check("slug -i. itemId", slug.itemId, "13113966246");
check("slug -i. canonical", slug.canonical, "https://shopee.ph/product/117867014/13113966246");
check("slug -i. ok", slug.ok, true);

check(
  "share text with emoji + URL",
  parseShopeeLink("Check this out 🎉 https://shopee.ph/product/1/2 !"),
  {
    ok: true,
    shopId: "1",
    itemId: "2",
    region: "shopee.ph",
    canonical: "https://shopee.ph/product/1/2",
    shortLink: false,
  }
);

check("short link s.shopee.ph", parseShopeeLink("https://s.shopee.ph/AbC123"), {
  ok: false,
  shortLink: true,
  url: "https://s.shopee.ph/AbC123",
});

check("short link shope.ee", parseShopeeLink("https://shope.ee/abcXYZ"), {
  ok: false,
  shortLink: true,
  url: "https://shope.ee/abcXYZ",
});

check("non-shopee host rejected", parseShopeeLink("https://google.com/product/1/2"), null);

check(
  "scheme-less URL",
  parseShopeeLink("shopee.ph/product/117867014/13113966246"),
  {
    ok: true,
    shopId: "117867014",
    itemId: "13113966246",
    region: "shopee.ph",
    canonical: "https://shopee.ph/product/117867014/13113966246",
    shortLink: false,
  }
);

check("shopee page without IDs", parseShopeeLink("https://shopee.ph/m/flash-sale"), {
  ok: false,
  shortLink: false,
  url: "https://shopee.ph/m/flash-sale",
});

check("empty input", parseShopeeLink(""), null);
check("null input", parseShopeeLink(null), null);

// ---------------------------------------------------------------------------
// stripNumber
// ---------------------------------------------------------------------------
check("stripNumber ₱ with commas", stripNumber("₱1,234.50"), 1234.5);
check("stripNumber PHP no decimals", stripNumber("PHP1,234"), 1234);
check("stripNumber plain", stripNumber("650"), 650);
check("stripNumber range takes low end", stripNumber("₱1,234 - ₱2,000"), 1234);
check("stripNumber garbage", Number.isNaN(stripNumber("no numbers here")), true);

// ---------------------------------------------------------------------------
// formatMoney
// ---------------------------------------------------------------------------
check("formatMoney integer", formatMoney(650), "₱650.00");
check("formatMoney decimals + grouping", formatMoney(1234.5), "₱1,234.50");
check("formatMoney big", formatMoney(1234567.89), "₱1,234,567.89");
check("formatMoney NaN", formatMoney(NaN), "—");
check("formatMoney null", formatMoney(null), "—");

// ---------------------------------------------------------------------------
// PRICE_RE / PCT_OFF_RE / VOUCHER_OFFER_RE
// ---------------------------------------------------------------------------
check("PRICE_RE simple", PRICE_RE.test("₱1,234"), true);
check("PRICE_RE decimals", PRICE_RE.test("₱1,234.50"), true);
check("PRICE_RE PHP prefix", PRICE_RE.test("PHP 1,234.00"), true);
check("PRICE_RE range", PRICE_RE.test("₱1,234 - ₱2,000"), true);
check("PRICE_RE en-dash range", PRICE_RE.test("₱1,234–₱2,000"), true);
check("PRICE_RE rejects sentence", PRICE_RE.test("Voucher ₱50 off"), false);
check("PRICE_RE rejects labeled line", PRICE_RE.test("Original Price: ₱1,000.00"), false);
check("PRICE_RE rejects bare number", PRICE_RE.test("1234"), false);

check("PCT_OFF_RE badge", PCT_OFF_RE.test("-20%"), true);
check("PCT_OFF_RE decimal badge", PCT_OFF_RE.test("-12.5%"), true);
check("PCT_OFF_RE rejects rating", PCT_OFF_RE.test("78%"), false);
check("PCT_OFF_RE rejects plain", PCT_OFF_RE.test("20"), false);

check("VOUCHER_OFFER_RE peso off", VOUCHER_OFFER_RE.test("₱50 off"), true);
check("VOUCHER_OFFER_RE percent off", VOUCHER_OFFER_RE.test("15% off"), true);
check("VOUCHER_OFFER_RE free shipping", VOUCHER_OFFER_RE.test("Free Shipping"), true);
check("VOUCHER_OFFER_RE spends", VOUCHER_OFFER_RE.test("₱100 off (min spend ₱1,000)"), true);
check("VOUCHER_OFFER_RE rejects price", VOUCHER_OFFER_RE.test("₱1,234.00"), false);

// ---------------------------------------------------------------------------
// classifyVoucherLabel / isShortLinkHost
// ---------------------------------------------------------------------------
check("classify shop voucher", classifyVoucherLabel("Shop voucher"), "shop");
check("classify seller voucher", classifyVoucherLabel("Seller coupon"), "shop");
check("classify platform voucher", classifyVoucherLabel("Platform voucher"), "platform");
check("classify shopee voucher", classifyVoucherLabel("Shopee voucher"), "platform");
check("classify generic", classifyVoucherLabel("Vouchers"), "unknown");

check("isShortLinkHost shope.ee", isShortLinkHost("shope.ee"), true);
check("isShortLinkHost s.shopee.ph", isShortLinkHost("s.shopee.ph"), true);
check("isShortLinkHost shopee.ph", isShortLinkHost("shopee.ph"), false);
check("isShortLinkHost empty", isShortLinkHost(""), false);

// ---------------------------------------------------------------------------
console.log("\n" + (total - failures) + "/" + total + " passed");
process.exit(failures ? 1 : 0);
