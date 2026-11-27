// One-time: link the owner's WhatsApp to this server as a device.
//   node scripts/whatsappLink.js 91XXXXXXXXXX
// Prints an 8-character code. On the phone: WhatsApp > Settings > Linked
// devices > Link a device > Link with phone number instead, and type it in.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
const { connect, AUTH_DIR } = require("../services/whatsapp");

async function main() {
    const phone = String(process.argv[2] || "").replace(/\D/g, "");
    if (phone.length < 10) {
        console.error("Usage: node scripts/whatsappLink.js <your WhatsApp number with country code, e.g. 9198XXXXXXXX>");
        process.exit(1);
    }
    const sock = await connect({
        pairPhone: phone,
        onPairingCode: (code) => {
            const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
            console.log(`\nPAIRING CODE: ${pretty}\n`);
            console.log("On your phone: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead.");
            console.log("Type the code there. Waiting up to 5 minutes...\n");
        },
    });
    console.log(`Linked. Session saved in ${AUTH_DIR}`);
    await new Promise((r) => setTimeout(r, 5000));
    sock.end(undefined);
    process.exit(0);
}

main().catch((err) => {
    console.error("Linking failed:", err.message);
    process.exit(1);
});
