const express = require('express');
const path = require('path');
const app = express();
const { qrRoute, pairRoute } = require('./routes');

require('events').EventEmitter.defaultMaxListeners = 2000;

// Prevent unhandled rejections from crashing the server
process.on('unhandledRejection', (reason, promise) => {
  console.error('[NEXUS] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[NEXUS] Uncaught Exception:', err);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/qr', qrRoute);
app.use('/code', pairRoute);

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pairing', (req, res) => {
  res.redirect('https://github.com/devwhitewizard/nexus-v1md');
});

app.get('/health', (req, res) => {
  res.json({
    status: 200,
    success: true,
    service: 'Nexus-1MD-Pairing',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Deployment Successful! Nexus-1MD Pairing Server Running on http://localhost:${PORT}`);
});

module.exports = app;
