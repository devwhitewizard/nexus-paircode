const { nexusId, removeFile } = require('../lib');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    BufferJSON,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const sessionDir = path.join(__dirname, '../temp');
const qrSessions = new Map();

// Ensure temp dir exists
try {
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
} catch (e) {
    console.error('[qr] Failed to create temp dir:', e.message);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function safeEnd(sock) {
    try { if (sock && typeof sock.end === 'function') sock.end(); } catch (_) {}
}

function buildSession(creds) {
    const json = JSON.stringify(creds, BufferJSON.replacer);
    return 'NEXUS~' + Buffer.from(json).toString('base64');
}

function resolveJid(creds, user) {
    const raw = (creds && creds.me && creds.me.id) || (user && user.id) || '';
    const clean = raw.split(':')[0].split('@')[0];
    return clean ? clean + '@s.whatsapp.net' : '';
}

async function cleanupQrSession(id, delaySec = 0) {
    if (delaySec > 0) await delay(delaySec * 1000);
    try { await removeFile(path.join(sessionDir, id)); } catch (e) {
        console.error(`[qr:${id}] Cleanup error:`, e.message);
    }
    qrSessions.delete(id);
}

// ─── GET /qr  —  serve the QR frontend page ─────────────────────────────────
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
        .qr-code { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .qr-code img { width: 100%; height: 100%; border-radius: 10px; }
        .spinner {
            width: 50px; height: 50px;
            border: 4px solid rgba(0, 242, 254, 0.1);
            border-top: 4px solid var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        h1 { color: var(--primary); margin: 0 0 10px 0; font-size: 2rem; font-weight: 800; text-shadow: 0 0 10px rgba(0,242,254,0.3); }
        p { color: var(--text-light); margin: 10px 0; font-size: 1rem; }
        .status-msg { font-weight: 600; color: var(--primary); margin: 1.5rem 0; min-height: 24px; }
        .back-btn {
            display: inline-block; padding: 12px 30px;
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            color: #000; text-decoration: none; border-radius: 30px;
            font-weight: bold; box-shadow: 0 4px 15px rgba(0,242,254,0.3);
            cursor: pointer;
        }
        .back-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,242,254,0.4); }
        .success-icon { font-size: 4rem; color: #4caf50; animation: bounce 0.6s ease; }
        @keyframes bounce { 0% { transform: scale(0.3); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
        #session-container textarea {
            width: 100%; height: 80px; padding: 10px;
            background: #1b1b2f; border: 1px solid rgba(0, 242, 254, 0.3);
            border-radius: 8px; color: #00f2fe; font-family: monospace;
            font-size: 0.9rem; resize: none; text-align: center;
            margin-bottom: 1rem; outline: none; box-sizing: border-box;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>NEXUS-1MD QR</h1>
        <div class="qr-container" id="qrContainer">
            <div class="qr-code" id="qrCodeDiv"><div class="spinner"></div></div>
        </div>
        <div class="status-msg" id="statusMsg">Initializing session...</div>

        <div id="session-container" style="display:none; margin-top:1rem;">
            <p style="color:#4caf50; font-weight:bold; margin-bottom:0.5rem;">Connected Successfully!</p>
            <p>Your Session ID:</p>
            <textarea id="session-id" readonly></textarea>
            <button id="copy-session-btn" class="back-btn" style="margin-bottom:1rem; width:100%; border:none;">
                <i class="fas fa-copy"></i> COPY SESSION ID
            </button>
        </div>

        <a href="./" class="back-btn">Back</a>
    </div>

    <script>
        let sessionId = null;
        let pollInterval = null;
        let retries = 0;
        const MAX_RETRIES = 3;

        function setStatus(msg) {
            document.getElementById('statusMsg').innerText = msg;
        }

        function showError(msg) {
            setStatus(msg);
            document.getElementById('qrCodeDiv').innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ff9800;"></i>';
        }

        async function startQRFlow() {
            try {
                const res = await fetch('/qr/start');
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showError(err.error || 'Server error. Please refresh.');
                    return;
                }
                const data = await res.json();
                sessionId = data.sessionId;

                if (!sessionId) {
                    showError('Failed to generate session. Please refresh.');
                    return;
                }

                setStatus('Generating QR code...');

                pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetch('/qr/status?id=' + sessionId);

                        if (statusRes.status === 404) {
                            clearInterval(pollInterval);
                            showError('Session expired. Refresh the page to try again.');
                            return;
                        }

                        if (!statusRes.ok) {
                            retries++;
                            if (retries >= MAX_RETRIES) {
                                clearInterval(pollInterval);
                                showError('Connection lost. Please refresh.');
                            }
                            return;
                        }
                        retries = 0;

                        const statusData = await statusRes.json();

                        if (statusData.paired && statusData.session) {
                            clearInterval(pollInterval);
                            document.getElementById('qrContainer').innerHTML = '<div class="success-icon">✓</div>';
                            setStatus('Paired Successfully!');
                            document.getElementById('session-id').value = statusData.session;
                            document.getElementById('session-container').style.display = 'block';
                        } else if (statusData.qr) {
                            document.getElementById('qrCodeDiv').innerHTML = '<img src="' + statusData.qr + '" alt="QR Code"/>';
                            setStatus('Scan this QR code with WhatsApp → Linked Devices');
                        } else {
                            setStatus('Waiting for WhatsApp connection...');
                        }
                    } catch (e) {
                        console.error('Poll error:', e);
                    }
                }, 3000);

            } catch (err) {
                console.error('Start error:', err);
                showError('Failed to connect. Please refresh.');
            }
        }

        document.getElementById('copy-session-btn').addEventListener('click', () => {
            const box = document.getElementById('session-id');
            box.select();
            navigator.clipboard.writeText(box.value).then(() => {
                const btn = document.getElementById('copy-session-btn');
                const old = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> COPIED!';
                setTimeout(() => { btn.innerHTML = old; }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                document.execCommand('copy');
            });
        });

        window.onload = startQRFlow;
    </script>
</body>
</html>
    `);
});

// ─── GET /qr/start  —  spin up a Baileys QR session ─────────────────────────
router.get('/start', async (req, res) => {
    const sessionId = nexusId(8);
    const sessionEntry = { sock: null, qr: null, paired: false, expired: false, session: null };
    qrSessions.set(sessionId, sessionEntry);

    // Auto-expire after 2 min
    const expireTimer = setTimeout(() => {
        if (!sessionEntry.paired) {
            sessionEntry.expired = true;
            safeEnd(sessionEntry.sock);
            cleanupQrSession(sessionId);
            console.log(`[qr:${sessionId}] Expired (timeout)`);
        }
    }, 120000);

    async function connectQR() {
        if (sessionEntry.expired || sessionEntry.paired) return;

        // Baileys version
        let version;
        try {
            ({ version } = await fetchLatestBaileysVersion());
        } catch (e) {
            console.error(`[qr:${sessionId}] fetchLatestBaileysVersion failed:`, e.message);
            version = [2, 3000, 1014080102];
        }

        // Auth state
        let state, saveCreds;
        try {
            ({ state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, sessionId)));
        } catch (e) {
            console.error(`[qr:${sessionId}] useMultiFileAuthState failed:`, e.message);
            clearTimeout(expireTimer);
            cleanupQrSession(sessionId);
            return;
        }

        // Create socket
        let Nexus;
        try {
            Nexus = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ['Nexus-1MD', 'Chrome', '120.0.0'],
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });
            sessionEntry.sock = Nexus;
        } catch (e) {
            console.error(`[qr:${sessionId}] makeWASocket failed:`, e.message);
            clearTimeout(expireTimer);
            cleanupQrSession(sessionId);
            return;
        }

        // Creds update
        Nexus.ev.on('creds.update', async () => {
            try { await saveCreds(); } catch (e) {
                console.error(`[qr:${sessionId}] saveCreds error:`, e.message);
            }
        });

        // Connection events
        Nexus.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                sessionEntry.qr = qr;
                console.log(`[qr:${sessionId}] QR updated`);
            }

            if (connection === 'open') {
                clearTimeout(expireTimer);
                sessionEntry.paired = true;
                console.log(`[qr:${sessionId}] Connection opened`);

                // Build session immediately
                try {
                    await delay(3000); // let creds settle
                    sessionEntry.session = buildSession(state.creds);
                    console.log(`[qr:${sessionId}] Session built (${sessionEntry.session.length} chars)`);
                } catch (e) {
                    console.error(`[qr:${sessionId}] buildSession failed:`, e.message);
                }

                // Fire-and-forget WA messages
                ;(async () => {
                    try {
                        const userJid = resolveJid(state.creds, Nexus.user);
                        if (!userJid) {
                            console.warn(`[qr:${sessionId}] Could not resolve JID — skipping WA message`);
                            return;
                        }
                        console.log(`[qr:${sessionId}] Sending session to ${userJid}`);

                        await Nexus.sendMessage(userJid, {
                            text: `⏳ *NEXUS-1MD CONNECTING* ⏳\n\nConnection successful! Generating your session ID...`
                        });

                        await delay(5000);

                        if (sessionEntry.session) {
                            const name = (Nexus.user && Nexus.user.name) ? Nexus.user.name : 'User';

                            // Message 2: Session ID ALONE — easy to copy
                            await Nexus.sendMessage(userJid, {
                                text: sessionEntry.session
                            });

                            await delay(3000);

                            // Message 3: Info footer
                            await Nexus.sendMessage(userJid, {
                                text: `✅ *Session generated for ${name}!*\n\n> Copy the message above and paste it as your SESSION_ID\n\n🌐 https://nexus-md.vercel.app/\n📦 github.com/devwhitewizard/nexus-v1md\n🚀 Deploy on render.com\n\n_Powered by Nexus-1MD_`
                            });
                            await delay(8000);
                        }
                    } catch (e) {
                        console.error(`[qr:${sessionId}] WA message error:`, e.message);
                    } finally {
                        safeEnd(Nexus);
                        // Keep entry alive for 60s for polling to retrieve session
                        setTimeout(() => cleanupQrSession(sessionId), 60000);
                    }
                })();
            }

            else if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log(`[qr:${sessionId}] Connection closed — code: ${code}`);

                if (!sessionEntry.paired && !sessionEntry.expired) {
                    if (code !== DisconnectReason.loggedOut && code !== 401) {
                        console.log(`[qr:${sessionId}] Retrying...`);
                        await delay(5000);
                        connectQR().catch(e => {
                            console.error(`[qr:${sessionId}] Retry error:`, e.message);
                        });
                    } else {
                        clearTimeout(expireTimer);
                        cleanupQrSession(sessionId);
                    }
                }
            }
        });
    }

    // Kick off connection
    try {
        await connectQR();
        res.json({ sessionId });
    } catch (e) {
        console.error(`[qr:${sessionId}] Start failed:`, e.message);
        clearTimeout(expireTimer);
        cleanupQrSession(sessionId);
        res.status(500).json({ error: 'Failed to initialize QR session' });
    }
});

// ─── GET /qr/status?id=<id> ─────────────────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Session ID required' });

        const session = qrSessions.get(id);
        if (!session) return res.status(404).json({ error: 'Session not found or expired' });

        if (session.paired && session.session) {
            return res.json({ paired: true, session: session.session });
        }

        if (!session.qr) {
            return res.status(202).json({ status: 'waiting' });
        }

        let qrImage;
        try {
            qrImage = await QRCode.toDataURL(session.qr, {
                errorCorrectionLevel: 'H',  // highest — tolerates up to 30% damage
                type: 'image/png',
                quality: 1,
                margin: 2,
                width: 512,                 // large enough for any phone camera
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });
        } catch (e) {
            console.error(`[qr:${id}] QRCode.toDataURL failed:`, e.message);
            return res.status(500).json({ error: 'Failed to render QR code' });
        }

        return res.json({ qr: qrImage });
    } catch (e) {
        console.error('[qr] /status error:', e.message);
        return res.status(500).json({ error: 'Status check failed' });
    }
});

module.exports = router;
