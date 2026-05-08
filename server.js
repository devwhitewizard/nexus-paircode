const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, delay, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, disconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
console.log('Serving static files from:', path.join(__dirname, 'public'));
app.use(express.json());

// Session store for active sockets
const sessions = new Map();

async function startPairing(phoneNumber) {
    const sessionId = uuidv4();
    const authPath = path.join(__dirname, 'temp', sessionId);
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            browser: ["Ubuntu", "Safari", "1.0.0"],
        });

        sessions.set(sessionId, { sock, authPath });

        if (!sock.authState.creds.registered) {
            await delay(3000); 
            const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
            console.log(`[${sessionId}] Pairing code generated for ${phoneNumber}: ${code}`);
            return { sessionId, code, saveCreds };
        }
        return { sessionId, error: 'Already registered' };
    } catch (err) {
        console.error('Error in startPairing:', err);
        await fs.remove(authPath);
        throw err;
    }
}

app.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).json({ error: 'Phone number is required' });

    try {
        const result = await startPairing(number);
        if (result.error) return res.status(400).json(result);
        
        const { sessionId, code, saveCreds } = result;
        const { sock, authPath } = sessions.get(sessionId);

        sock.ev.on('creds.update', saveCreds);

        // Auto-cleanup if not paired within 2 minutes
        const timeout = setTimeout(async () => {
            if (sessions.has(sessionId)) {
                console.log(`[${sessionId}] Pairing timeout for ${number}`);
                try {
                    await sock.logout();
                } catch (e) {}
                await fs.remove(authPath);
                sessions.delete(sessionId);
            }
        }, 120000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                clearTimeout(timeout);
                console.log(`[${sessionId}] Connection opened for ${number}`);
                
                // Get the session ID (Base64 encoded creds)
                const creds = await fs.readFile(path.join(authPath, 'creds.json'), 'utf-8');
                const sessionString = Buffer.from(creds).toString('base64');
                const fullSession = `Nexus-MD;;;${sessionString}`;

                // Send the session to the user
                await sock.sendMessage(sock.user.id, { 
                    text: `🌟 *NEXUS-MD SESSION* 🌟\n\n👋 Hello ${sock.user.name || 'User'}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${fullSession}\`\`\`\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-MD*` 
                });

                // Cleanup
                setTimeout(async () => {
                   try {
                     await sock.logout();
                     await fs.remove(authPath);
                     sessions.delete(sessionId);
                   } catch (e) {}
                }, 5000);
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === 401) {
                    sessions.delete(sessionId);
                    await fs.remove(authPath);
                }
            }
        });

        res.json({ code, sessionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR Code support
async function startQR() {
    const sessionId = uuidv4();
    const authPath = path.join(__dirname, 'temp', sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["Nexus-MD", "Chrome", "1.0.0"],
    });

    sessions.set(sessionId, { sock, authPath, qr: null });
    return sessionId;
}

app.get('/qr-id', async (req, res) => {
    try {
        const sessionId = await startQR();
        const { sock, authPath } = sessions.get(sessionId);

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { qr, connection } = update;
            if (qr) {
                sessions.get(sessionId).qr = qr;
            }
            if (connection === 'open') {
                const creds = await fs.readFile(path.join(authPath, 'creds.json'), 'utf-8');
                const sessionString = Buffer.from(creds).toString('base64');
                const fullSession = `Nexus-MD;;;${sessionString}`;

                await sock.sendMessage(sock.user.id, { 
                    text: `🌟 *NEXUS-MD SESSION* 🌟\n\n👋 Hello ${sock.user.name || 'User'}!\n\nYour session has been generated successfully ✅\n\n\`\`\`${fullSession}\`\`\`\n\n*Visit for more*\n| github.com/devwhitewizard/nexus-md\n\n*Deploy your bot now*\n| render.com\n\n🚀 *Powered by Nexus-MD*` 
                });

                setTimeout(async () => {
                   try {
                     await sock.logout();
                     await fs.remove(authPath);
                     sessions.delete(sessionId);
                   } catch (e) {}
                }, 5000);
            }
        });

        res.json({ sessionId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to start QR session' });
    }
});

app.get('/qr/:id', async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.qr) return res.status(202).json({ message: 'Waiting for QR' });

    try {
        const dataUrl = await qrcode.toDataURL(session.qr);
        res.json({ qr: dataUrl });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR image' });
    }
});

app.listen(PORT, () => {
    console.log(`Nexus-MD Pair Server running on http://localhost:${PORT}`);
});
