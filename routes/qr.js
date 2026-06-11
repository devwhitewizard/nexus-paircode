const { casperId, removeFile } = require('../lib');
const QRCode = require('qrcode');
const express = require('express');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
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

    async function CASPER_QR_CODE() {
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

            Casper.ev.on('creds.update', saveCreds);
            Casper.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;
                if (qr && !responseSent) {
                    const qrImage = await QRCode.toDataURL(qr);
                    if (!res.headersSent) {
                        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Nexus-1MD | QR CODE</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background-color: #0d0e15;
            font-family: Arial, sans-serif;
            color: #fff;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
        }
        .container {
            width: 100%;
            max-width: 600px;
        }
        .qr-container {
            position: relative;
            margin: 20px auto;
            width: 300px;
            height: 300px;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .qr-code {
            width: 300px;
            height: 300px;
            padding: 10px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 0 0 10px rgba(0,242,254,0.1), 0 0 0 20px rgba(0,242,254,0.05), 0 0 30px rgba(0,242,254,0.2);
        }
        .qr-code img {
            width: 100%;
            height: 100%;
        }
        h1 {
            color: #fff;
            margin: 0 0 15px 0;
            font-size: 28px;
            font-weight: 800;
            text-shadow: 0 0 10px rgba(0,242,254,0.3);
        }
        p {
            color: #ccc;
            margin: 20px 0;
            font-size: 16px;
        }
        .back-btn {
            display: inline-block;
            padding: 12px 25px;
            margin-top: 15px;
            background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
            color: #000;
            text-decoration: none;
            border-radius: 30px;
            font-weight: bold;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0,242,254,0.2);
        }
        .back-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,242,254,0.4);
        }
        .pulse {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0,242,254,0.4); }
            70% { box-shadow: 0 0 0 15px rgba(0,242,254,0); }
            100% { box-shadow: 0 0 0 0 rgba(0,242,254,0); }
        }
        @media (max-width: 480px) {
            .qr-container {
                width: 260px;
                height: 260px;
            }
            .qr-code {
                width: 220px;
                height: 220px;
            }
            h1 {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>NEXUS-1MD QR CODE</h1>
        <div class="qr-container">
            <div class="qr-code pulse">
                <img src="${qrImage}" alt="QR Code"/>
            </div>
        </div>
        <p>Scan this QR code with your phone's WhatsApp Linked Devices to connect.</p>
        <a href="./" class="back-btn">Back</a>
    </div>
</body>
</html>
                        `);
                        responseSent = true;
                    }
                }

                if (connection === "open") {
                    sessionSentSuccess = true;
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
                    await delay(5000);
                    CASPER_QR_CODE();
                }
            });
        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent) {
                res.status(500).json({ code: "QR Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
        }
    }

    try {
        await CASPER_QR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;
