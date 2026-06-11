<div align="center">

<img src="https://img.shields.io/badge/Nexus--1MD-Pairing%20Server-00f2fe?style=for-the-badge&logo=whatsapp&logoColor=white"/>

# 🌟 Nexus-1MD Pairing Server

**The official session generator for [Nexus-1MD WhatsApp Bot](https://github.com/devwhitewizard/nexus-v1md)**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-lightgrey?style=flat-square&logo=express)](https://expressjs.com)
[![Baileys](https://img.shields.io/badge/Baileys-7.x-blue?style=flat-square)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-ISC-yellow?style=flat-square)](LICENSE)

</div>

---

## 📖 What is This?

**Nexus-1MD Pairing Server** is a self-hosted web service that generates a `NEXUS~` session string for the [Nexus-1MD WhatsApp Bot](https://github.com/devwhitewizard/nexus-v1md). Instead of manually managing authentication files, this server lets any user connect their WhatsApp account and instantly receive a portable session ID that can be pasted into a bot deployment (e.g., on Render or Railway).

Two pairing methods are supported:

| Method | How it works |
|--------|--------------|
| **Pair Code** | Enter your phone number → receive an 8-digit code in WhatsApp → link device |
| **QR Code** | Open the QR page → scan the code with WhatsApp → linked instantly |

Once linked, the server:
1. Serialises your WhatsApp credentials into a compact `NEXUS~<base64>` session string
2. Sends it to your own WhatsApp chat
3. Also shows it **directly on the web page** so you always get it even if the WhatsApp message is delayed

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- [Git](https://git-scm.com)
- A WhatsApp account (personal or bot number)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/devwhitewizard/nexus-paircode.git
cd nexus-paircode

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

The server starts on **http://localhost:3000** by default.

To use a different port, set the `PORT` environment variable:

```bash
PORT=8080 npm start
```

---

## 🖥️ Usage

### Home Page — `http://localhost:3000/`

The landing page with links to both pairing methods.

### Pair Code — `http://localhost:3000/pair`

1. Enter your WhatsApp number (with country code, no `+`, no spaces — e.g. `254712345678`)
2. Click **Generate Code**
3. Open WhatsApp → **Linked Devices** → **Link a Device** → **Link with phone number instead**
4. Enter the 8-digit code shown on screen
5. Wait a few seconds — your **Session ID** will appear on the page and be sent to your WhatsApp chat

### QR Code — `http://localhost:3000/qr`

1. Open the page — a QR code will appear automatically
2. Open WhatsApp → **Linked Devices** → **Link a Device** → Scan the QR
3. Wait a few seconds — your **Session ID** will appear on the page and be sent to your WhatsApp chat

---

## 🔑 Session ID Format

The generated session follows this format:

```
NEXUS~<base64-encoded-JSON-credentials>
```

This string is directly compatible with **Nexus-1MD**. To use it:

1. Copy the full `NEXUS~...` string
2. In your bot deployment (Render, Railway, etc.), set the `SESSION_ID` environment variable to this value
3. Start your bot — it will authenticate using this session

---

## 🗂️ Project Structure

```
nexus-paircode/
├── index.js              # Express app entry point
├── package.json
├── lib/
│   └── index.js          # Utility functions (ID gen, file cleanup)
├── routes/
│   ├── index.js          # Route exports
│   ├── pair.js           # Pair code pairing logic + /code/status
│   └── qr.js             # QR code pairing logic + /qr/start + /qr/status
├── public/
│   ├── index.html        # Landing page
│   └── pair.html         # Pair code frontend
└── temp/                 # Temporary Baileys auth state (auto-cleaned)
```

---

## 🛠️ API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Landing page |
| `/pair` | GET | Pair code frontend |
| `/qr` | GET | QR code frontend |
| `/code?number=<phone>` | GET | Generate pairing code & begin session |
| `/code/status?id=<id>` | GET | Poll pairing status / retrieve session |
| `/qr/start` | GET | Spin up a new QR session |
| `/qr/status?id=<id>` | GET | Poll QR status / retrieve session |
| `/health` | GET | Server health check |

---

## ⚙️ How It Works Internally

```
User enters number / scans QR
        │
        ▼
Baileys socket created (useMultiFileAuthState)
        │
        ▼
WhatsApp pairing handshake (requestPairingCode or QR scan)
        │
        ▼
connection.update → "open"
        │
        ├─► Session built immediately: NEXUS~<base64 creds>
        │           stored in memory map (pollable by frontend)
        │
        └─► Background task sends 2 WhatsApp messages:
                ① "Connecting..." (instant)
                ② Full session string (after 5s delay)
                    then socket closed gracefully (Nexus.end())
                    then temp files cleaned up after 60s
```

> **Why the delay?** WhatsApp requires the socket to be fully synchronised before messages can be reliably delivered. A 5-second buffer ensures delivery without triggering spam filters.

---

## 🔒 Security & Safety

- **`Nexus.end()`** is used (not `logout()`) — the device is **not unlinked**, the session stays valid
- Temp auth files are deleted after the session is built — credentials are **never persisted**
- Each session has a **2–3 minute auto-expiry** if the user doesn't complete pairing
- All async operations have isolated `try/catch` blocks — one failed request cannot crash the server
- Global `unhandledRejection` and `uncaughtException` handlers keep the process alive

---

## 🌐 Deployment

### Render (Recommended)

1. Fork this repo to your GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Connect your repo → set **Start Command** to `npm start`
4. Set environment variable: `PORT=10000` (Render default)
5. Deploy ✅

### Railway

```bash
railway init
railway up
```

---

## 🤝 Related Projects

| Project | Description |
|---------|-------------|
| [nexus-v1md](https://github.com/devwhitewizard/nexus-v1md) | The main Nexus-1MD WhatsApp bot |
| [nexus-md.vercel.app](https://nexus-md.vercel.app/) | Official Nexus-1MD website |

---

## 👨‍💻 Author

Built with ❤️ by **[DevWhiteWizard](https://github.com/devwhitewizard)**

---

<div align="center">

**⭐ Star this repo if it helped you!**

</div>
