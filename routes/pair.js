const { nexusId, removeFile } = require('../lib');
const zlib = require('zlib');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    BufferJSON
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "../temp");
const pairSessions = new Map();

router.get('/', async (req, res) => {
    const id = nexusId(8);
    let num = req.query.number;
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                await removeFile(path.join(sessionDir, id));
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function NEXUS_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        try {
            let Nexus = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });

            const sessionEntry = {
                sock: Nexus,
                paired: false,
                expired: false,
                session: null
            };
            pairSessions.set(id, sessionEntry);

            if (!Nexus.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^0-9]/g, '');
                
                let code = null;
                try {
                    code = await Nexus.requestPairingCode(num);
                } catch (codeErr) {
                    console.error("Error requesting pairing code:", codeErr);
                }

                if (!code) {
                    throw new Error('Failed to generate pairing code');
                }

                if (!responseSent && !res.headersSent) {
                    res.json({ code: code, sessionId: id });
                    responseSent = true;
                }
            }

            Nexus.ev.on('creds.update', saveCreds);
            Nexus.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    sessionEntry.paired = true;

                    // Build session and store immediately so polling can retrieve it
                    try {
                        await delay(3000); // let creds settle
                        const sessionData = JSON.stringify(state.creds, BufferJSON.replacer);
                        const b64data = Buffer.from(sessionData).toString('base64');
                        const fullSession = 'NEXUS~' + b64data;
                        sessionEntry.session = fullSession;
                        console.log(`[pair:${id}] Session ID stored. Length: ${fullSession.length}`);
                    } catch (buildErr) {
                        console.error(`[pair:${id}] Error building session:`, buildErr);
                    }

                    // Send WhatsApp messages in background (best effort)
                    ;(async () => {
                        try {
                            const rawJid = (state.creds && state.creds.me && state.creds.me.id) || (Nexus.user && Nexus.user.id) || "";
                            const cleanJid = rawJid.split(":")[0].split("@")[0];
                            const userJid = cleanJid ? cleanJid + "@s.whatsapp.net" : rawJid;
                            console.log(`[pair:${id}] Sending session to JID: ${userJid}`);

                            await Nexus.sendMessage(userJid, { 
                                text: `⏳ *NEXUS-1MD CONNECTING* ⏳\n\nConnection successful! Please wait a moment while we generate your secure session ID...`
                            });

                            await delay(5000);

                            await Nexus.sendMessage(userJid, { 
                                text: `🌟 *NEXUS-1MD SESSION* 🌟\n\n👋 Hello ${Nexus.user ? Nexus.user.name : 'User'}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${sessionEntry.session}\`\`\`\n\n*Official Website*\n| https://nexus-md.vercel.app/\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-v1md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-1MD*`
                            });

                            await delay(8000);
                        } catch (sendError) {
                            console.error(`[pair:${id}] Error sending session message:`, sendError);
                        }

                        // Gracefully close, defer cleanup so polling can still find session
                        try { Nexus.end(); } catch(e) {}
                        setTimeout(async () => {
                            await cleanUpSession();
                            pairSessions.delete(id);
                            console.log(`[pair:${id}] Pair session cleaned up.`);
                        }, 60000);
                    })();
                } else if (connection === "close" && !sessionEntry.paired && !sessionEntry.expired) {
                    const shouldReconnect = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode !== 401;
                    if (shouldReconnect) {
                        console.log("Reconnecting...");
                        await delay(5000);
                        NEXUS_PAIR_CODE();
                    } else {
                        await cleanUpSession();
                        pairSessions.delete(id);
                    }
                }
            });
        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: "Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
            pairSessions.delete(id);
        }
    }

    try {
        await NEXUS_PAIR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        pairSessions.delete(id);
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

// Endpoint to poll pairing status and retrieve session ID
router.get('/status', async (req, res) => {
    const id = req.query.id;
    const session = pairSessions.get(id);

    if (!session) {
        return res.status(404).json({ error: "Session not found or expired" });
    }

    if (session.paired && session.session) {
        return res.json({ paired: true, session: session.session });
    }

    return res.json({ paired: false });
});

module.exports = router;
