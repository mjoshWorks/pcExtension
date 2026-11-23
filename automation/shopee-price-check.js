/**
 * ============================================================================
 *  Shopee Price Check — on-phone automation for AutoX.js (Android)
 * ============================================================================
 *  What it does
 *  ------------
 *  Puts a small floating panel on top of any app. From that panel you can:
 *    1. "Go"          — take a Shopee link (from the input box, or the
 *                       clipboard), open it in the Shopee app, wait for the
 *                       product page to load, and read the price / voucher
 *                       info straight off the screen.
 *    2. "Read screen" — read the 4 parameters from whatever product page is
 *                       currently open in the Shopee app (use this for items
 *                       with variations: select the variation first, then tap).
 *    3. "Dump UI"     — save the full accessibility tree of the current screen
 *                       to a text file, used to tune the text patterns when
 *                       Shopee updates its app layout.
 *
 *  The 4 parameters (same spec as the original PDF handoff):
 *      Original Price / Product Discount / Shop Voucher / Platform Voucher
 *
 *  Design rules
 *  ------------
 *  - 100% READ-ONLY. It never taps vouchers, never adds to cart, never
 *    checks out. Reading your own screen is passive and invisible to Shopee;
 *    automating claims/purchases is the pattern that gets accounts banned.
 *  - Extraction is heuristic (text patterns, not resource-ids) so it survives
 *    most Shopee app updates. If it ever breaks, tap "Dump UI" and adjust the
 *    regexes below.
 *  - Voucher values are the offers visible on the page for YOUR account.
 *    Platform vouchers usually finalize at checkout, so treat them as the
 *    "best available" estimate, not a guaranteed final price.
 *
 *  Requirements: Android 7+, AutoX.js app (Accessibility + Overlay + Storage
 *  permissions), Shopee app installed and logged in.
 * ============================================================================
 */

var VERSION = "0.1.0";

// --- tunables ---------------------------------------------------------------
var PRICE_AREA_RATIO = 0.72;      // price must appear in the top 72% of screen
var VOUCHER_PROXIMITY_PX = 320;   // chip must be within this px of a voucher label
var OPEN_TIMEOUT_MS = 10000;      // wait for the Shopee app to come to front
var PAGE_LOAD_TIMEOUT_MS = 15000; // wait for a price to appear on the page
var LOG_FILE_NAME = "price_log.csv";

// ============================ PURE_BEGIN ====================================
// Pure helper functions (no Android APIs). Unit-tested by
// automation/tests/test_pure_functions.js under Node.js — keep this block
// runnable outside AutoX.js (ES5 only).

var PRICE_RE = /^(?:₱|PHP\s?)\s*[\d,]+(?:\.\d{1,2})?(?:\s*[-–~]\s*(?:₱|PHP\s?)\s*[\d,]+(?:\.\d{1,2})?)?$/;
var PCT_OFF_RE = /^-\d+(?:\.\d+)?%$/;
var VOUCHER_OFFER_RE = /(?:₱|php)\s?[\d,]+(?:\.\d{1,2})?\s*off|\d+\s*%\s*off|free\s*shipping/i;

/** "₱1,234.50" -> 1234.5 ; "₱1,234 - ₱2,000" -> 1234 (low end) ; else NaN */
function stripNumber(s) {
    if (s == null) return NaN;
    var m = String(s).replace(/,/g, "").match(/(\d+)(?:\.\d{1,2})?/);
    return m ? parseFloat(m[0]) : NaN;
}

/** 650 -> "₱650.00" ; 1234.5 -> "₱1,234.50" */
function formatMoney(n) {
    if (n == null || isNaN(n)) return "—";
    var fixed = Number(n).toFixed(2);
    var parts = fixed.split(".");
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "₱" + whole + "." + parts[1];
}

/** shope.ee / s.shopee.ph / s.shopee.com.my ... */
function isShortLinkHost(host) {
    return /^(shope\.ee|s\.shopee\.[a-z.]+|shp\.ee)$/i.test(String(host || ""));
}

/**
 * Parse any pasted Shopee-ish text into a structured link.
 * Returns one of:
 *   { ok:true,  shopId, itemId, region, canonical, shortLink:false }
 *   { ok:false, shortLink:bool, url }          (no product IDs in the text)
 *   null                                       (not a Shopee link at all)
 */
function parseShopeeLink(input) {
    if (!input) return null;
    var text = String(input).trim();
    if (!text) return null;

    var urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    var url = urlMatch ? urlMatch[0] : null;
    if (!url && text.indexOf("shopee") >= 0) {
        url = "https://" + text.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
    }
    if (!url) return null;

    var host = "";
    var hostMatch = url.match(/^https?:\/\/([^\/?#]+)/i);
    if (hostMatch) host = hostMatch[1].toLowerCase();

    var looksShopee = !host || host.indexOf("shopee") >= 0 || isShortLinkHost(host);
    if (!looksShopee) return null;

    var idMatch = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
    if (idMatch) {
        var region = (host && host.indexOf("shopee") === 0) ? host : "shopee.ph";
        return {
            ok: true,
            shopId: idMatch[1],
            itemId: idMatch[2],
            region: region,
            canonical: "https://" + region + "/product/" + idMatch[1] + "/" + idMatch[2],
            shortLink: false
        };
    }
    return { ok: false, shortLink: isShortLinkHost(host), url: url };
}

/** "Shop voucher" -> "shop" ; "Platform voucher"/"Shopee voucher" -> "platform" */
function classifyVoucherLabel(t) {
    var s = String(t || "");
    if (/platform|shopee/i.test(s)) return "platform";
    if (/shop|seller|store/i.test(s)) return "shop";
    return "unknown";
}
// ============================= PURE_END =====================================

// --- small utils ------------------------------------------------------------
function pad2(n) { return (n < 10 ? "0" : "") + n; }

function nowStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
        " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function fileStamp() {
    var d = new Date();
    return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
        "_" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function csvEscape(v) {
    return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
}

function waitUntil(fn, timeoutMs, intervalMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (fn()) return true; } catch (e) { /* stale nodes etc. */ }
        sleep(intervalMs || 400);
    }
    return false;
}

// --- UI-tree snapshot -------------------------------------------------------
/**
 * Snapshot the accessibility tree into plain objects.
 * Object: { text, desc, cls, b }  — b is an android.graphics.Rect (or null).
 */
function snapshotNodes() {
    var out = [];
    var MAX_NODES = 6000;
    var root = auto.root;

    function walk(node, depth) {
        if (!node || out.length >= MAX_NODES || depth > 60) return;
        var b = null, t = null, d = null, cls = "";
        try { b = node.bounds(); } catch (e) { b = null; }
        try { t = node.textOrNull(); } catch (e) { t = null; }
        try { d = node.descOrNull(); } catch (e) { d = null; }
        try { cls = String(node.className() || ""); } catch (e) { cls = ""; }
        out.push({ text: t, desc: d, cls: cls, b: b });
        var c = 0;
        try { c = node.childCount(); } catch (e) { c = 0; }
        for (var i = 0; i < c; i++) {
            var ch = null;
            try { ch = node.child(i); } catch (e) { ch = null; }
            walk(ch, depth + 1);
        }
    }
    walk(root, 0);
    return out;
}

function nodeText(n) {
    var t = (n.text != null ? String(n.text) : "") || (n.desc != null ? String(n.desc) : "");
    return t.replace(/^\s+|\s+$/g, "");
}

/** Fast check: is there anything on screen that looks like a price? */
function quickPriceProbe() {
    var nodes = snapshotNodes();
    for (var i = 0; i < nodes.length; i++) {
        var t = nodeText(nodes[i]);
        if (t && PRICE_RE.test(t)) return true;
    }
    return false;
}

/** Fast check: is there any voucher-ish text on screen? */
function quickVoucherProbe() {
    var nodes = snapshotNodes();
    for (var i = 0; i < nodes.length; i++) {
        var t = nodeText(nodes[i]);
        if (t && (/voucher|coupon|promo/i.test(t) || VOUCHER_OFFER_RE.test(t))) return true;
    }
    return false;
}

// --- extraction (heuristic, tuned via Dump UI) -------------------------------
/**
 * Read the 4 parameters from the CURRENT screen of the Shopee app.
 * Returns:
 * {
 *   priceFound, originalPrice (number|null), currentPrice (number|null),
 *   productDiscount (number|null), productDiscountPct ("-20%"|null),
 *   shopVoucherOffers: [strings], platformVoucherOffers: [strings],
 *   unknownVoucherOffers: [strings], notes: [strings]
 * }
 */
function extractBreakdown() {
    var nodes = snapshotNodes();
    var screenH = 2400, screenW = 1080;
    try { screenH = device.height || screenH; } catch (e) {}
    try { screenW = device.width || screenW; } catch (e) {}

    var prices = [];   // { text, value, b }
    var pcts = [];     // { text, b }
    var labels = [];   // { text, kind, cy }
    var chips = [];    // { text, cy }

    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var b = n.b;
        if (!b) continue;
        // skip off-screen nodes (incl. our own hidden floating panel)
        if (b.right <= 0 || b.bottom <= 0 || b.top >= screenH || b.left >= screenW) continue;

        var t = nodeText(n);
        if (!t) continue;
        var cy = (b.top + b.bottom) / 2;

        if (PRICE_RE.test(t)) {
            if (cy < screenH * PRICE_AREA_RATIO) prices.push({ text: t, value: stripNumber(t), b: b });
        } else if (PCT_OFF_RE.test(t)) {
            if (cy < screenH * PRICE_AREA_RATIO) pcts.push({ text: t, b: b });
        }
        if (t.length <= 60 && /voucher|coupon|promo/i.test(t)) {
            labels.push({ text: t, kind: classifyVoucherLabel(t), cy: cy });
        }
        if (t.length <= 80 && VOUCHER_OFFER_RE.test(t)) {
            chips.push({ text: t.replace(/\s+/g, " "), cy: cy });
        }
    }

    // Current price = the largest text on screen (font-size proxy),
    // tie-break: the one higher up.
    var current = null;
    for (var j = 0; j < prices.length; j++) {
        var p = prices[j];
        if (!current ||
            p.b.height() > current.b.height() ||
            (p.b.height() === current.b.height() && p.b.top < current.b.top)) {
            current = p;
        }
    }

    // Original price = another price with a HIGHER value, nearest to the
    // current one (Shopee shows the struck-through price next to the sale one).
    var original = null, bestOrigDist = -1;
    if (current) {
        for (var k = 0; k < prices.length; k++) {
            var q = prices[k];
            if (q === current || isNaN(q.value) || !(q.value > current.value)) continue;
            var dist = Math.abs(q.b.centerX() - current.b.centerX()) +
                       Math.abs(q.b.centerY() - current.b.centerY());
            if (!original || dist < bestOrigDist) { original = q; bestOrigDist = dist; }
        }
    }

    // Discount badge ("-20%"), nearest to the current price.
    var pct = null, bestPctDist = -1;
    if (current) {
        for (var m = 0; m < pcts.length; m++) {
            var s = pcts[m];
            var d2 = Math.abs(s.b.centerX() - current.b.centerX()) +
                     Math.abs(s.b.centerY() - current.b.centerY());
            if (!pct || d2 < bestPctDist) { pct = s; bestPctDist = d2; }
        }
    }

    // Voucher offers: chips found near their label row.
    var shopOffers = [], platOffers = [], unkOffers = [];
    var seen = {};
    function pushOffer(arr, txt) {
        if (!seen[txt]) { seen[txt] = true; arr.push(txt); }
    }
    if (labels.length > 0) {
        for (var a = 0; a < labels.length; a++) {
            var lb = labels[a];
            var nearest = null, nd = -1;
            for (var c = 0; c < chips.length; c++) {
                var dd = Math.abs(chips[c].cy - lb.cy);
                if (dd <= VOUCHER_PROXIMITY_PX && (nearest === null || dd < nd)) {
                    nearest = chips[c]; nd = dd;
                }
            }
            if (nearest) {
                if (lb.kind === "shop") pushOffer(shopOffers, nearest.text);
                else if (lb.kind === "platform") pushOffer(platOffers, nearest.text);
                else pushOffer(unkOffers, nearest.text);
            }
        }
    } else {
        for (var e2 = 0; e2 < chips.length; e2++) pushOffer(unkOffers, chips[e2].text);
    }

    var productDiscount = null;
    if (original && current && original.value > current.value) {
        productDiscount = original.value - current.value;
    }

    var notes = [];
    if (!current) notes.push("no price text found on screen");
    if (labels.length === 0 && chips.length === 0) notes.push("no voucher text found on screen");
    if (prices.length > 2) notes.push(prices.length + " price-like texts found (variation page or noisy screen)");

    return {
        priceFound: !!current,
        originalPrice: original ? original.value : null,
        currentPrice: current ? current.value : null,
        productDiscount: productDiscount,
        productDiscountPct: pct ? pct.text : null,
        shopVoucherOffers: shopOffers,
        platformVoucherOffers: platOffers,
        unknownVoucherOffers: unkOffers,
        notes: notes
    };
}

// --- network -----------------------------------------------------------------
/** Follow a short link (shope.ee etc.) to its final URL. Returns string|null. */
function resolveRedirect(url) {
    try {
        var conn = new java.net.URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36");
        conn.getResponseCode();
        var finalUrl = String(conn.getURL().toString());
        conn.disconnect();
        return finalUrl;
    } catch (e) {
        console.error("resolveRedirect failed: " + e);
        return null;
    }
}

// --- device / app -------------------------------------------------------------
function detectShopeePackage() {
    var candidates = ["Shopee", "Shopee PH", "shopee"];
    for (var i = 0; i < candidates.length; i++) {
        try {
            var p = app.getPackageName(candidates[i]);
            if (p) return String(p);
        } catch (e) { /* keep trying */ }
    }
    return "com.shopee.ph"; // sensible default for the PH app
}

function uiStatus(s) {
    ui.run(function () {
        try { w.results.setText(s); } catch (e) { /* window may be gone */ }
    });
}

function hideWindow() { try { w.setPosition(-2000, -2000); } catch (e) {} }
function showWindow() { try { w.setPosition(winX, winY); } catch (e) {} }

/**
 * Read the current screen, waiting for the page to load first.
 * Optionally does one gentle scroll if no price shows up (lazy-loaded rows).
 */
function readScreenInternal(allowScroll) {
    var found = waitUntil(quickPriceProbe, PAGE_LOAD_TIMEOUT_MS, 500);
    if (!found && allowScroll) {
        try {
            var w1 = device.width, h1 = device.height;
            swipe(w1 / 2, h1 * 0.60, w1 / 2, h1 * 0.48, 350); // small scroll down
        } catch (e) { /* swipe needs accessibility; ignore */ }
        found = waitUntil(quickPriceProbe, 6000, 500);
    }
    var data = extractBreakdown();
    if (!found) {
        try { // scroll back so the user doesn't lose their place
            var w2 = device.width, h2 = device.height;
            swipe(w2 / 2, h2 * 0.48, w2 / 2, h2 * 0.60, 300);
        } catch (e) {}
    }
    return data;
}

/** Open a URL (deep-links into the Shopee app when possible) and read it. */
function openAndExtractUrl(url, info) {
    var pkg = detectShopeePackage();
    uiStatus("Opening Shopee…");
    app.startActivity({ action: "android.intent.action.VIEW", data: url });

    var opened = waitUntil(function () { return currentPackage() === pkg; }, OPEN_TIMEOUT_MS, 300);
    if (!opened) {
        showWindow();
        uiStatus("The Shopee app did not come to the front (the link may have opened in a browser).\n" +
            "Open the product in the Shopee app, then tap 'Read screen'.");
        return;
    }
    sleep(1500); // let the page settle
    uiStatus("Reading product page…");
    hideWindow();
    var data = readScreenInternal(true);
    showWindow();

    if (!data.priceFound) {
        uiStatus("Opened Shopee but could not find a price on screen.\n" +
            "If the product has variations, select one, then tap 'Read screen'.\n" +
            "Tap 'Dump UI' to capture the screen so the patterns can be tuned.");
        return;
    }
    logRow(info, data);
    showResults(info, data);
}

// --- output -------------------------------------------------------------------
function showResults(info, data) {
    var lines = [];
    if (info && info.shopId) lines.push("Item " + info.itemId + " · shop " + info.shopId);

    var originalLine;
    if (data.originalPrice != null) originalLine = formatMoney(data.originalPrice);
    else if (data.currentPrice != null) originalLine = formatMoney(data.currentPrice) + " (no struck-through price found)";
    else originalLine = "not found";
    lines.push("Original Price: " + originalLine);

    var discText = "none found";
    if (data.productDiscount != null && data.productDiscount > 0) {
        discText = "-" + formatMoney(data.productDiscount) +
            (data.productDiscountPct ? " (" + data.productDiscountPct + ")" : "");
    } else if (data.productDiscountPct) {
        discText = data.productDiscountPct + " (badge only)";
    }
    lines.push("Product Discount: " + discText);

    lines.push("Shop Voucher: " +
        (data.shopVoucherOffers.length ? data.shopVoucherOffers.join("  ·  ") : "none found"));

    var platText;
    if (data.platformVoucherOffers.length) platText = data.platformVoucherOffers.join("  ·  ");
    else if (data.unknownVoucherOffers.length) platText = data.unknownVoucherOffers.join("  ·  ") + "  (type unsure)";
    else platText = "none found";
    lines.push("Platform Voucher: " + platText);

    lines.push("— vouchers are page-visible offers; final discount depends on claiming & checkout");
    uiStatus(lines.join("\n"));
}

function logRow(info, data) {
    try {
        var path = files.cwd() + "/" + LOG_FILE_NAME;
        if (!files.exists(path)) {
            files.createWithDirs(path);
            files.append(path, "timestamp,source,shop_id,item_id,original_price,current_price," +
                "product_discount,discount_pct,shop_vouchers,platform_vouchers,unknown_vouchers,notes\n");
        }
        var row = [
            nowStamp(),
            info ? info.canonical : "current-screen",
            info ? info.shopId : "",
            info ? info.itemId : "",
            data.originalPrice != null ? data.originalPrice : "",
            data.currentPrice != null ? data.currentPrice : "",
            data.productDiscount != null ? data.productDiscount : "",
            data.productDiscountPct || "",
            data.shopVoucherOffers.join(" | "),
            data.platformVoucherOffers.join(" | "),
            data.unknownVoucherOffers.join(" | "),
            data.notes.join(" | ")
        ].map(csvEscape).join(",");
        files.append(path, row + "\n");
    } catch (e) {
        console.error("logRow failed: " + e);
    }
}

/** Save the whole accessibility tree to a text file (for tuning patterns). */
function dumpUi() {
    var nodes = snapshotNodes();
    var path = files.cwd() + "/dump_" + fileStamp() + ".txt";
    var pkg = "?";
    try { pkg = String(currentPackage() || "?"); } catch (e) {}
    var lines = ["# AutoX UI dump " + nowStamp() + " — package: " + pkg];
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var b = n.b ? (n.b.left + "," + n.b.top + "," + n.b.right + "," + n.b.bottom) : "?,?,?,?";
        var t = (n.text != null ? String(n.text) : "").replace(/\r?\n/g, "\\n");
        var d = (n.desc != null ? String(n.desc) : "").replace(/\r?\n/g, "\\n");
        lines.push(i + "\t" + n.cls + "\ttext=" + t + "\tdesc=" + d + "\tbounds=" + b);
    }
    files.createWithDirs(path);
    files.write(path, lines.join("\n"));
    return path;
}

// ============================================================================
//  Floating window + handlers
// ============================================================================

if (auto.service == null) {
    toastLog("Please enable the AutoX.js Accessibility service (Android Settings → Accessibility), then run this script again.");
    auto.waitFor(); // resumes once the service is enabled
}

// AutoX.js inflates this XML layout (E4X literal — Rhino-specific syntax).
var LAYOUT_XML =
    <frame w="*" h="auto">
        <vertical bg="#F2FFFFFF" padding="8dp" w="*" h="auto">
            <horizontal w="*" h="wrap_content">
                <text id="titleBar" text="🛒 Shopee Price Check" textStyle="bold" textColor="#ee4d2d" textSize="14sp" layout_weight="1" w="0dp" h="wrap_content"/>
                <button id="closeBtn" text="✕" textSize="12sp" w="wrap_content" h="wrap_content"/>
            </horizontal>
            <input id="linkInput" hint="Paste Shopee link (empty = use clipboard)" textSize="12sp" inputType="text" maxLines="1" w="*" h="wrap_content"/>
            <horizontal w="*" h="wrap_content">
                <button id="goBtn" text="Go" textSize="12sp" layout_weight="1" w="0dp" h="wrap_content"/>
                <button id="readBtn" text="Read screen" textSize="12sp" layout_weight="1" w="0dp" h="wrap_content"/>
                <button id="dumpBtn" text="Dump UI" textSize="12sp" layout_weight="1" w="0dp" h="wrap_content"/>
            </horizontal>
            <text id="results" text="Ready.
• Copy a Shopee link anywhere, then tap 'Go'
• Or open a product in Shopee and tap 'Read screen'" textSize="12sp" textColor="#333333" w="*" h="wrap_content"/>
        </vertical>
    </frame>;

var w = null;
try {
    w = floaty.rawWindow(LAYOUT_XML);
} catch (e) {
    toastLog("Could not create the floating window. Allow 'Display over other apps' for AutoX.js, then run the script again.\n" + e);
    exit();
}

var winX = 16, winY = 140;
try { w.setPosition(winX, winY); } catch (e) {}

// Drag the panel around by its title bar.
var lastTouchX = 0, lastTouchY = 0;
try {
    w.titleBar.setOnTouchListener(function (view, event) {
        var action = event.getAction();
        if (action === 0) {            // MotionEvent.ACTION_DOWN
            lastTouchX = event.getRawX();
            lastTouchY = event.getRawY();
        } else if (action === 2) {     // MotionEvent.ACTION_MOVE
            var dx = event.getRawX() - lastTouchX;
            var dy = event.getRawY() - lastTouchY;
            lastTouchX = event.getRawX();
            lastTouchY = event.getRawY();
            winX += dx;
            winY += dy;
            w.setPosition(winX, winY);
        }
        return false;
    });
} catch (e) {
    console.error("drag handler: " + e);
}

// "Go" — parse link (input box → clipboard), open Shopee, read, display.
w.goBtn.on("click", function () {
    threads.start(function () {
        try {
            var input = "";
            ui.run(function () {
                try { input = String(w.linkInput.getText() || ""); } catch (e) { input = ""; }
            });
            if (!input.replace(/^\s+|\s+$/g, "")) {
                try { input = String(getClip() || ""); } catch (e) { input = ""; }
            }
            input = input.replace(/^\s+|\s+$/g, "");
            if (!input) {
                toastLog("No link found. Paste a Shopee link into the box " +
                    "(the clipboard can be blocked while AutoX is in the background).");
                return;
            }

            uiStatus("Parsing link…");
            var info = parseShopeeLink(input);
            if (!info) {
                uiStatus("That doesn't look like a Shopee link.");
                return;
            }

            if (!info.ok && info.shortLink) {
                uiStatus("Resolving short link…");
                var finalUrl = resolveRedirect(info.url);
                if (finalUrl) {
                    var parsed2 = parseShopeeLink(finalUrl);
                    if (parsed2 && parsed2.ok) info = parsed2;
                    else info = { ok: false, shortLink: false, url: finalUrl };
                }
            }

            var urlToOpen = info.ok ? info.canonical : (info.url || input);
            openAndExtractUrl(urlToOpen, info.ok ? info : null);
        } catch (e) {
            showWindow();
            toastLog("Go failed: " + e);
            console.error(e);
        }
    });
});

// "Read screen" — read whatever product page is currently open.
w.readBtn.on("click", function () {
    threads.start(function () {
        try {
            uiStatus("Reading current screen…");
            hideWindow();
            sleep(400);
            var data = readScreenInternal(true);
            showWindow();
            if (!data || !data.priceFound) {
                uiStatus("No price found on the current screen.\n" +
                    "Open a product page in the Shopee app first, then tap 'Read screen'.\n" +
                    "('Dump UI' saves the screen contents to help tune the patterns.)");
                return;
            }
            logRow(null, data);
            showResults(null, data);
        } catch (e) {
            showWindow();
            toastLog("Read failed: " + e);
            console.error(e);
        }
    });
});

// "Dump UI" — save the accessibility tree for tuning.
w.dumpBtn.on("click", function () {
    threads.start(function () {
        try {
            var path = dumpUi();
            toastLog("UI dumped to: " + path);
        } catch (e) {
            toastLog("Dump failed (is the Accessibility service on?): " + e);
        }
    });
});

w.closeBtn.on("click", function () {
    try { w.close(); } catch (e) {}
    exit();
});

// Keep the script alive while the floating window exists.
setInterval(function () {}, 2000);
