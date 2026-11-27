const fs = require("fs");
const path = require("path");

// Sends WhatsApp messages from the owner's own WhatsApp account, linked as a
// device (like WhatsApp Web) through Baileys. Link once with
// scripts/whatsappLink.js; the session is kept in WHATSAPP_AUTH_DIR.
//
// This is not WhatsApp's official API. Keep it to a few messages a day to
// known contacts, or WhatsApp may ban the number.

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.resolve(__dirname, "..", ".whatsapp-auth");
const CONNECT_TIMEOUT_MS = 90 * 1000;

// libsignal (inside Baileys) console.logs whole session objects, key
// material included, on every session change. Keep those out of the logs.
const SIGNAL_NOISE = /^(Closing session|Opening session|Removing old closed session|Closing open session|Session error|Decrypted message with closed session)/;
for (const method of ["log", "info", "warn"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
        if (typeof args[0] === "string" && SIGNAL_NOISE.test(args[0])) return;
        original(...args);
    };
}

let baileys; // ESM-only package, loaded on first use
async function lib() {
    if (!baileys) baileys = await import("@whiskeysockets/baileys");
    return baileys;
}

function silentLogger() {
    const noop = () => {};
    const logger = { level: "silent", trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
    logger.child = () => logger;
    return logger;
}

/**
 * Opens a connection and resolves with the socket once WhatsApp says it is
 * open. With `pairPhone` (digits with country code) and no saved session,
 * calls `onPairingCode(code)` with the code to type in on the phone.
 */
async function connect({ pairPhone, onPairingCode } = {}) {
    const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await lib();
    fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });

    const deadline = Date.now() + (pairPhone ? 5 * 60 * 1000 : CONNECT_TIMEOUT_MS);
    let pairingAsked = false;

    // Pairing ends with WhatsApp asking for a restart, so this loops.
    for (;;) {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        if (!state.creds.registered && !pairPhone) {
            throw new Error("WhatsApp is not linked yet. Run: node scripts/whatsappLink.js <your number with country code>");
        }
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
        const sock = makeWASocket({
            version,
            auth: state,
            logger: silentLogger(),
            browser: Browsers.ubuntu("Chrome"),
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            syncFullHistory: false,
        });
        sock.ev.on("creds.update", saveCreds);

        const outcome = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ timeout: true }), Math.max(deadline - Date.now(), 1000));
            sock.ev.on("connection.update", async (u) => {
                if (u.qr && pairPhone && !pairingAsked && !state.creds.registered) {
                    pairingAsked = true;
                    try {
                        const code = await sock.requestPairingCode(pairPhone);
                        onPairingCode?.(code);
                    } catch (err) {
                        clearTimeout(timer);
                        resolve({ error: err });
                    }
                }
                if (u.connection === "open") {
                    clearTimeout(timer);
                    resolve({ open: true });
                }
                if (u.connection === "close") {
                    clearTimeout(timer);
                    resolve({ closed: u.lastDisconnect?.error?.output?.statusCode });
                }
            });
        });

        if (outcome.open) return sock;
        sock.end(undefined);
        if (outcome.error) throw outcome.error;
        if (outcome.timeout) throw new Error("Timed out connecting to WhatsApp.");
        if (outcome.closed === DisconnectReason.loggedOut) {
            throw new Error("WhatsApp logged this device out. Link it again with scripts/whatsappLink.js.");
        }
        if (Date.now() > deadline) throw new Error(`WhatsApp connection closed (${outcome.closed}).`);
        // restartRequired after pairing, or a dropped connection: try again.
        await new Promise((r) => setTimeout(r, 2000));
    }
}

const jidOf = (number) => `${String(number).replace(/\D/g, "")}@s.whatsapp.net`;

/**
 * Sends each {png, caption} to each number (digits with country code), in
 * order. A number that fails does not stop the others.
 */
async function sendImages(numbers, messages) {
    const sock = await connect();
    const sent = [];
    const failed = [];
    try {
        for (const n of numbers) {
            try {
                const [found] = await sock.onWhatsApp(jidOf(n));
                if (!found?.exists) throw new Error("not on WhatsApp");
                for (const m of messages) {
                    await sock.sendMessage(found.jid, { image: m.png, caption: m.caption, mimetype: "image/png" });
                    await new Promise((r) => setTimeout(r, 2000));
                }
                sent.push(n);
            } catch (err) {
                failed.push({ number: n, error: err.message });
            }
            await new Promise((r) => setTimeout(r, 3000));
        }
        // Give the last upload time to finish before closing.
        await new Promise((r) => setTimeout(r, 5000));
        return { sent, failed };
    } finally {
        sock.end(undefined);
    }
}

module.exports = { connect, sendImages, AUTH_DIR };
