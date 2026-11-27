const { Resvg } = require("@resvg/resvg-js");

// Draws the evening's pick lists as PNGs that read well on a phone, for the
// daily WhatsApp message.

const W = 1080;
const PAD = 48;
const ROW = 46;
const FONT = "DejaVu Sans, Noto Sans, Arial, sans-serif";
const C = {
    bg: "#ffffff",
    ink: "#17202b",
    muted: "#5d6b7a",
    line: "#e3e8ee",
    band: "#f4f7fa",
    accent: "#1f5fae",
    up: "#0f7a4f",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const signed = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const money = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

function formatDay(day) {
    const d = new Date(`${day}T00:00:00Z`);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// Columns: #, stock, confidence, expected move, last close.
const COLS = [
    { x: PAD + 8, anchor: "start" },
    { x: PAD + 70, anchor: "start" },
    { x: W - PAD - 380, anchor: "end" },
    { x: W - PAD - 190, anchor: "end" },
    { x: W - PAD - 8, anchor: "end" },
];

function text(x, y, s, { size = 26, weight = 400, fill = C.ink, anchor = "start", family = FONT } = {}) {
    return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

function section(y, title, rows, confKey, confLabel) {
    const out = [];
    if (title) {
        out.push(text(PAD, y + 40, title, { size: 34, weight: 700 }));
        y += 64;
    }
    const heads = ["#", "Stock", confLabel, "Expected", "Last close"];
    heads.forEach((h, i) => out.push(text(COLS[i].x, y + 30, h.toUpperCase(), { size: 19, weight: 700, fill: C.muted, anchor: COLS[i].anchor })));
    y += 44;
    out.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="2" fill="${C.line}"/>`);
    if (!rows.length) {
        out.push(text(PAD + 8, y + 40, "No stock passed today.", { size: 24, fill: C.muted }));
        return { svg: out.join(""), y: y + 64 };
    }
    rows.forEach((r, i) => {
        const top = y + i * ROW;
        if (i % 2 === 1) out.push(`<rect x="${PAD}" y="${top + 2}" width="${W - 2 * PAD}" height="${ROW}" fill="${C.band}"/>`);
        const base = top + 32;
        const sym = r.symbol.length > 18 ? `${r.symbol.slice(0, 17)}…` : r.symbol;
        out.push(text(COLS[0].x, base, String(i + 1), { size: 24, fill: C.muted }));
        out.push(text(COLS[1].x, base, sym, { size: 26, weight: 700 }));
        out.push(text(COLS[2].x, base, `${r[confKey].toFixed(1)}%`, { size: 26, weight: 700, fill: C.accent, anchor: "end" }));
        out.push(text(COLS[3].x, base, signed(r.expected), { size: 24, fill: r.expected >= 0 ? C.up : "#b8342c", anchor: "end" }));
        out.push(text(COLS[4].x, base, money(r.lastClose), { size: 24, fill: C.muted, anchor: "end" }));
    });
    return { svg: out.join(""), y: y + rows.length * ROW + 24 };
}

const LISTS = [
    { key: "big-jump", title: "Big jump: likely to rise 4% or more", rows: "up4", conf: "chanceUp4", label: "Chance 4%+" },
    { key: "steady", title: "Steady rise: likely to rise 2% to 4%", rows: "up2", conf: "chanceBand", label: "Chance 2-4%" },
    { key: "positive", title: "Positive signal", rows: "positive", conf: "chanceUp2", label: "Chance 2%+" },
];

/**
 * One PNG per list (Big jump, Steady rise, Positive signal), each with its
 * own heading, so they read as separate pictures on WhatsApp.
 * @returns {{key: string, title: string, count: number, png: Buffer}[]}
 */
function renderPicksPngs(picks) {
    return LISTS.map((list) => {
        const rows = picks[list.rows] || [];
        const parts = [];
        let y = PAD;
        parts.push(text(PAD, y + 40, list.title, { size: 38, weight: 700 }));
        parts.push(text(PAD, y + 82, `Next trading day · prediction made after close on ${formatDay(picks.day)} · liquid stocks`, { size: 22, fill: C.muted }));
        y += 92;
        const s = section(y, "", rows, list.conf, list.label);
        parts.push(s.svg);
        const H = s.y + PAD - 24;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${C.bg}"/>${parts.join("")}</svg>`;
        const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }, fitTo: { mode: "width", value: W } }).render().asPng();
        return { key: list.key, title: list.title, count: rows.length, png };
    });
}

module.exports = { renderPicksPngs };
