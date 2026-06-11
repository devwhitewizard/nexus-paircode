const { nexusId, removeFile } = require('../lib');
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
    fetchLatestBaileysVersion,
    BufferJSON
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "../temp");
const qrSessions = new Map();

// Endpoint to serve the QR code frontend page
router.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Nexus-1MD | QR CODE</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary: #00f2fe;
            --secondary: #4facfe;
            --accent: #7000ff;
            --text: #ffffff;
            --text-light: #d3d3d3;
            --background: #0a0a12;
            --card-bg: #10101d;
            --shadow: 0 10px 20px rgba(0, 242, 254, 0.15);
            --transition: all 0.3s ease;
        }
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background-color: var(--background);
            font-family: 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif;
            color: var(--text);
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
            background-image: radial-gradient(circle at 10% 20%, rgba(0, 242, 254, 0.08) 0%, transparent 20%), 
                              radial-gradient(circle at 90% 80%, rgba(112, 0, 255, 0.08) 0%, transparent 20%);
        }
        .container {
            background-color: var(--card-bg);
            padding: 2.5rem;
            border-radius: 20px;
            box-shadow: var(--shadow);
            width: 100%;
            max-width: 500px;
            border: 1px solid rgba(0, 242, 254, 0.2);
            position: relative;
        }
        .qr-container {
            position: relative;
            margin: 2rem auto;
            width: 260px;
            height: 260px;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #fff;
            border-radius: 15px;
            padding: 10px;
            box-shadow: 0 0 20px rgba(0,242,254,0.2);
        }
        .qr-code {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .qr-code img {
            width: 100%;
            height: 100%;
            border-radius: 10px;
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(0, 242, 254, 0.1);
            border-top: 4px solid var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h1 {
            color: var(--primary);
            margin: 0 0 10px 0;
            font-size: 2rem;
            font-weight: 800;
            text-shadow: 0 0 10px rgba(0, 242, 254, 0.3);
        }
        p {
            color: var(--text-light);
            margin: 10px 0;
            font-size: 1rem;
        }
        .status-msg {
            font-weight: 600;
            color: var(--primary);
            margin: 1.5rem 0;
            min-height: 24px;
        }
        .back-btn {
            display: inline-block;
            padding: 12px 30px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            color: #000;
            text-decoration: none;
            border-radius: 30px;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(0,242,254,0.3);
        }
        .back-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,242,254,0.4);
        }
        .success-icon {
            font-size: 4rem;
            color: #4caf50;
            animation: bounce 0.6s ease;
        }
        @keyframes bounce {
            0% { transform: scale(0.3); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>NEXUS-1MD QR</h1>
        <div class="qr-container" id="qrContainer">
            <div class="qr-code" id="qrCodeDiv">
                <div class="spinner"></div>
            </div>
        </div>
        <div class="status-msg" id="statusMsg">Initializing session...</div>
        
        <div id="session-container" style="display: none; margin-top: 1rem;">
            <p style="color: #4caf50; font-weight: bold; margin-bottom: 0.5rem;">Connected Successfully!</p>
            <p>Your Session ID is:</p>
            <textarea id="session-id" readonly style="width: 100%; height: 80px; padding: 10px; background: #1b1b2f; border: 1px solid rgba(0, 242, 254, 0.3); border-radius: 8px; color: #00f2fe; font-family: monospace; font-size: 0.9rem; resize: none; text-align: center; margin-bottom: 1rem; outline: none;"></textarea>
            <button id="copy-session-btn" class="back-btn" style="margin-bottom: 1rem; width: 100%; border: none;">
                <i class="fas fa-copy"></i> COPY SESSION ID
            </button>
        </div>

        <a href="./" class="back-btn">Back</a>
    </div>

    <script>
        let sessionId = null;
        let pollInterval = null;

        async function startQRFlow() {
            try {
                const res = await fetch('/qr/start');
                const data = await res.json();
                sessionId = data.sessionId;

                if (!sessionId) {
                    document.getElementById('statusMsg').innerText = 'Failed to generate session ID.';
                    return;
                }

                document.getElementById('statusMsg').innerText = 'Generating QR code...';
                
                pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetch('/qr/status?id=' + sessionId);
                        const statusData = await statusRes.json();

                        if (statusRes.status === 200 && statusData.qr) {
                            document.getElementById('qrCodeDiv').innerHTML = '<img src="' + statusData.qr + '" alt="QR Code"/>';
                            document.getElementById('statusMsg').innerText = 'Scan this QR code with WhatsApp Linked Devices';
                        } else if (statusRes.status === 200 && statusData.paired && statusData.session) {
                            clearInterval(pollInterval);
                            document.getElementById('qrContainer').innerHTML = '<div class="success-icon">✓</div>';
                            document.getElementById('statusMsg').innerText = 'Paired Successfully!';
                            document.getElementById('session-id').value = statusData.session;
                            document.getElementById('session-container').style.display = 'block';
                        } else if (statusRes.status === 202) {
                            document.getElementById('statusMsg').innerText = 'Waiting for WhatsApp connection...';
                        } else {
                            clearInterval(pollInterval);
                            document.getElementById('statusMsg').innerText = 'Session expired. Refresh the page to try again.';
                            document.getElementById('qrCodeDiv').innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff9800;"></i>';
                        }
                    } catch (e) {
                        console.error('Polling error:', e);
                    }
                }, 3000);
            } catch (err) {
                console.error(err);
                document.getElementById('statusMsg').innerText = 'Error initializing connection.';
            }
        }

        document.getElementById('copy-session-btn').addEventListener('click', () => {
            const sessionBox = document.getElementById('session-id');
            sessionBox.select();
            navigator.clipboard.writeText(sessionBox.value).then(() => {
                const btn = document.getElementById('copy-session-btn');
                const oldHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> COPIED!';
                setTimeout(() => {
                    btn.innerHTML = oldHTML;
                }, 2000);
            });
        });

        window.onload = startQRFlow;
    </script>
</body>
</html>
    `);
});

// Endpoint to spin up a new Baileys socket session
router.get('/start', async (req, res) => {
    try {
        const sessionId = nexusId(8);
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, sessionId));

        const sessionEntry = {
            sock: null,
            qr: null,
            paired: false,
            expired: false
        };
        qrSessions.set(sessionId, sessionEntry);

        // Auto-cleanup after 2 minutes to prevent socket/memory leaks
        const timeout = setTimeout(async () => {
            if (qrSessions.has(sessionId)) {
                console.log(`[${sessionId}] QR session expired (timeout)`);
                sessionEntry.expired = true;
                try {
                    if (sessionEntry.sock) sessionEntry.sock.end();
                } catch (e) {}
                await removeFile(path.join(sessionDir, sessionId));
                qrSessions.delete(sessionId);
            }
        }, 120000);

        async function connectQR() {
            if (sessionEntry.expired || sessionEntry.paired) return;

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

            sessionEntry.sock = Nexus;

            Nexus.ev.on('creds.update', saveCreds);
            Nexus.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;
                
                if (qr) {
                    sessionEntry.qr = qr;
                }

                if (connection === "open") {
                    clearTimeout(timeout);
                    sessionEntry.paired = true;

                    try {
                        const rawJid = (state.creds && state.creds.me && state.creds.me.id) || (Nexus.user && Nexus.user.id) || "";
                        const cleanJid = rawJid.split(":")[0].split("@")[0];
                        const userJid = cleanJid ? cleanJid + "@s.whatsapp.net" : rawJid;

                        await Nexus.sendMessage(userJid, { 
                            text: `⏳ *NEXUS-1MD CONNECTING* ⏳\n\nConnection successful! Please wait a moment while we generate your secure session ID...`
                        });

                        await delay(5000);

                        const sessionData = JSON.stringify(state.creds, BufferJSON.replacer);
                        let b64data = Buffer.from(sessionData).toString('base64');
                        const fullSession = 'NEXUS~' + b64data;
                        sessionEntry.session = fullSession;

                        await Nexus.sendMessage(userJid, { 
                            text: `🌟 *NEXUS-1MD SESSION* 🌟\n\n👋 Hello ${Nexus.user.name || 'User'}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${fullSession}\`\`\`\n\n*Official Website*\n| https://nexus-md.vercel.app/\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-v1md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-1MD*`
                        });
                        
                        await delay(8000);
                        Nexus.end();
                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                    } finally {
                        await removeFile(path.join(sessionDir, sessionId));
                        qrSessions.delete(sessionId);
                    }
                } else if (connection === "close" && !sessionEntry.paired && !sessionEntry.expired) {
                    const shouldReconnect = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode !== 401;
                    if (shouldReconnect) {
                        console.log(`[${sessionId}] Reconnecting QR socket...`);
                        await delay(5000);
                        connectQR();
                    } else {
                        clearTimeout(timeout);
                        await removeFile(path.join(sessionDir, sessionId));
                        qrSessions.delete(sessionId);
                    }
                }
            });
        }

        await connectQR();
        res.json({ sessionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to initialize QR session" });
    }
});

// Endpoint to poll QR code image data/pairing status
router.get('/status', async (req, res) => {
    const sessionId = req.query.id;
    const session = qrSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: "Session not found or expired" });
    }

    if (session.paired && session.session) {
        return res.json({ paired: true, session: session.session });
    }

    if (!session.qr) {
        return res.status(202).json({ status: "waiting" });
    }

    try {
        const qrImage = await QRCode.toDataURL(session.qr);
        res.json({ qr: qrImage });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate QR data URL" });
    }
});

module.exports = router;
