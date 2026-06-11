const { casperId, removeFile } = require('../lib');
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
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "../temp");

router.get('/', async (req, res) => {
    const id = casperId();
    let num = req.query.number;
    let responseSent = false;
    let sessionCleanedUp = false;
    let sessionSentSuccess = false;

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

    async function CASPER_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        try {
            let Casper = makeWASocket({
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

            if (!Casper.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^0-9]/g, '');
                
                let code = null;
                try {
                    code = await Casper.requestPairingCode(num);
                } catch (codeErr) {
                    console.error("Error requesting pairing code:", codeErr);
                }

                if (!code) {
                    throw new Error('Failed to generate pairing code');
                }

                if (!responseSent && !res.headersSent) {
                    res.json({ code: code });
                    responseSent = true;
                }
            }

            Casper.ev.on('creds.update', saveCreds);
            Casper.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    sessionSentSuccess = true;
                    // Wait for creds to be fully populated/written
                    await delay(5000);
                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 10;
                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath, 'utf-8');
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(2000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read error:", readError);
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        await cleanUpSession();
                        return;
                    }

                    try {
                        let compressedData = zlib.gzipSync(sessionData);
                        let b64data = compressedData.toString('base64');
                        const fullSession = 'Nexus-1MD~' + b64data;
                        
                        await Casper.sendMessage(Casper.user.id, { 
                            text: `🌟 *NEXUS-1MD SESSION* 🌟\n\n👋 Hello ${Casper.user.name || 'User'}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${fullSession}\`\`\`\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-v1md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-1MD*`
                        });
                        
                        await delay(3000);
                        await Casper.logout();
                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                    } finally {
                        await cleanUpSession();
                    }
                } else if (connection === "close" && !sessionSentSuccess && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    console.log("Reconnecting...");
                    await delay(5000);
                    CASPER_PAIR_CODE();
                }
            });
        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: "Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
        }
    }

    try {
        await CASPER_PAIR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;
