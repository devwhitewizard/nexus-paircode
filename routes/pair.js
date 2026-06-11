const { nexusId, removeFile } = require('../lib');
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
const pairSessions = new Map();

// Ensure temp dir exists
try {
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
} catch (e) {
    console.error('[pair] Failed to create temp dir:', e.message);
}

// ─── Helper: safely end socket ─────────────────────────────────────────────
function safeEnd(sock) {
    try { if (sock && typeof sock.end === 'function') sock.end(); } catch (_) {}
}

// ─── Helper: build NEXUS session string ────────────────────────────────────
function buildSession(creds) {
    const json = JSON.stringify(creds, BufferJSON.replacer);
    return 'NEXUS~' + Buffer.from(json).toString('base64');
}

// ─── Helper: extract clean JID ─────────────────────────────────────────────
function resolveJid(creds, user) {
    const raw = (creds && creds.me && creds.me.id) || (user && user.id) || '';
    const clean = raw.split(':')[0].split('@')[0];
    return clean ? clean + '@s.whatsapp.net' : '';
}

// ─── Helper: deferred cleanup ──────────────────────────────────────────────
async function cleanupSession(id, delaySec = 0) {
    if (delaySec > 0) await delay(delaySec * 1000);
    try { await removeFile(path.join(sessionDir, id)); } catch (e) {
        console.error(`[pair:${id}] Cleanup error:`, e.message);
    }
    pairSessions.delete(id);
}

// ─── GET /code?number=<phone> ───────────────────────────────────────────────
router.get('/', async (req, res) => {
    // ── Input validation ──
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num || num.length < 7) {
        return res.status(400).json({ error: 'Valid phone number required' });
    }

    const id = nexusId(8);
    let responseSent = false;

    function sendResponse(data, status = 200) {
        if (!responseSent && !res.headersSent) {
            res.status(status).json(data);
            responseSent = true;
        }
    }

    // ── Session entry ──
    const sessionEntry = { sock: null, paired: false, expired: false, session: null };
    pairSessions.set(id, sessionEntry);

    // ── Auto-expire after 3 min ──
    const expireTimer = setTimeout(() => {
        if (!sessionEntry.paired) {
            sessionEntry.expired = true;
            safeEnd(sessionEntry.sock);
            cleanupSession(id);
            console.log(`[pair:${id}] Session expired (timeout)`);
        }
    }, 180000);

    async function NEXUS_PAIR() {
        // ── Baileys version ──
        let version;
        try {
            ({ version } = await fetchLatestBaileysVersion());
        } catch (e) {
            console.error(`[pair:${id}] fetchLatestBaileysVersion failed:`, e.message);
            version = [2, 3000, 1014080102]; // fallback version
        }

        // ── Auth state ──
        let state, saveCreds;
        try {
            ({ state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id)));
        } catch (e) {
            console.error(`[pair:${id}] useMultiFileAuthState failed:`, e.message);
            sendResponse({ error: 'Failed to initialize auth state' }, 500);
            clearTimeout(expireTimer);
            cleanupSession(id);
            return;
        }

        // ── Create socket ──
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
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });
            sessionEntry.sock = Nexus;
        } catch (e) {
            console.error(`[pair:${id}] makeWASocket failed:`, e.message);
            sendResponse({ error: 'Failed to create socket' }, 500);
            clearTimeout(expireTimer);
            cleanupSession(id);
            return;
        }

        // ── Request pairing code ──
        if (!Nexus.authState.creds.registered) {
            try {
                await delay(3000);
                const code = await Nexus.requestPairingCode(num);
                if (!code) throw new Error('Received empty pairing code');
                sendResponse({ code, sessionId: id });
                console.log(`[pair:${id}] Pairing code sent for number ${num}`);
            } catch (e) {
                console.error(`[pair:${id}] requestPairingCode failed:`, e.message);
                sendResponse({ error: 'Failed to generate pairing code. Try again.' }, 500);
                clearTimeout(expireTimer);
                safeEnd(Nexus);
                cleanupSession(id);
                return;
            }
        }

        // ── Creds update ──
        Nexus.ev.on('creds.update', async () => {
            try { await saveCreds(); } catch (e) {
                console.error(`[pair:${id}] saveCreds failed:`, e.message);
            }
        });

        // ── Connection events ──
        Nexus.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                clearTimeout(expireTimer);
                sessionEntry.paired = true;
                console.log(`[pair:${id}] Connection opened`);

                // Build session string immediately
                try {
                    sessionEntry.session = buildSession(state.creds);
                    console.log(`[pair:${id}] Session built (${sessionEntry.session.length} chars)`);
                } catch (e) {
                    console.error(`[pair:${id}] buildSession failed:`, e.message);
                    // Session won't be available via polling but don't crash
                }

                // Fire-and-forget: send WhatsApp messages
                ;(async () => {
                    try {
                        const userJid = resolveJid(state.creds, Nexus.user);
                        if (!userJid) {
                            console.warn(`[pair:${id}] Could not resolve JID — skipping WA message`);
                            return;
                        }
                        console.log(`[pair:${id}] Sending session message to ${userJid}`);

                        await Nexus.sendMessage(userJid, {
                            text: `⏳ *NEXUS-1MD CONNECTING* ⏳\n\nConnection successful! Generating your session ID...`
                        });

                        await delay(5000);

                        if (sessionEntry.session) {
                            const name = (Nexus.user && Nexus.user.name) ? Nexus.user.name : 'User';
                            await Nexus.sendMessage(userJid, {
                                text: `🌟 *NEXUS-1MD SESSION* 🌟\n\n👋 Hello ${name}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${sessionEntry.session}\`\`\`\n\n*Official Website*\n| https://nexus-md.vercel.app/\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-v1md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-1MD*`
                            });
                            await delay(8000);
                        }
                    } catch (e) {
                        console.error(`[pair:${id}] WA message error:`, e.message);
                    } finally {
                        safeEnd(Nexus);
                        // Keep session in map for 60s so UI polling can still retrieve it
                        setTimeout(() => cleanupSession(id), 60000);
                    }
                })();
            }

            else if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log(`[pair:${id}] Connection closed — code: ${code}`);

                if (!sessionEntry.paired && !sessionEntry.expired) {
                    if (code !== DisconnectReason.loggedOut && code !== 401) {
                        // Transient error — retry
                        console.log(`[pair:${id}] Retrying...`);
                        await delay(5000);
                        NEXUS_PAIR().catch(e => {
                            console.error(`[pair:${id}] Retry error:`, e.message);
                        });
                    } else {
                        // Auth failure — don't retry
                        clearTimeout(expireTimer);
                        cleanupSession(id);
                    }
                }
            }
        });
    }

    // ── Kick off ──
    try {
        await NEXUS_PAIR();
    } catch (e) {
        console.error(`[pair:${id}] Unexpected error:`, e.message);
        sendResponse({ error: 'Unexpected server error' }, 500);
        clearTimeout(expireTimer);
        cleanupSession(id);
    }
});

// ─── GET /code/status?id=<id> ───────────────────────────────────────────────
router.get('/status', (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'Session ID required' });

        const session = pairSessions.get(id);
        if (!session) return res.status(404).json({ error: 'Session not found or expired' });

        if (session.paired && session.session) {
            return res.json({ paired: true, session: session.session });
        }
        return res.json({ paired: false });
    } catch (e) {
        console.error('[pair] /status error:', e.message);
        return res.status(500).json({ error: 'Status check failed' });
    }
});

module.exports = router;
