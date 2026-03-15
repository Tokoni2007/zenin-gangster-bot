const TelegramBot = require('node-telegram-bot-api');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const P = require('pino');
const express = require('express');
const app = express();

// ==================== CONFIG ====================
const BOT_TOKEN = '8591157732:AAGFyJdDG-mRcokzXXA-08xikiC24y2RK28';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PORT = process.env.PORT || 3000;

// ==================== EXPRESS SERVER (REQUIRED FOR RENDER) ====================
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ 
        status: 'running',
        whatsapp: waReady ? 'connected' : 'disconnected',
        telegram: 'active',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log('🌐 Server running on port', PORT);
});

// ==================== TELEGRAM SETUP ====================
const tgBot = new TelegramBot(BOT_TOKEN);

// Webhook for Render, Polling for local testing
if (WEBHOOK_URL) {
    const webhookPath = '/bot' + BOT_TOKEN;
    tgBot.setWebHook(WEBHOOK_URL + webhookPath);
    app.post(webhookPath, (req, res) => {
        tgBot.processUpdate(req.body);
        res.sendStatus(200);
    });
    console.log('📡 Webhook mode');
} else {
    tgBot.startPolling();
    console.log('📡 Polling mode');
}

tgBot.on('polling_error', (err) => console.error('[TG] Error:', err.message));

// ==================== WHATSAPP SETUP ====================
let waSock = null;
let waReady = false;
let waQrCount = 0;

async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        waSock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: P({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false
        });

        waSock.ev.on('creds.update', saveCreds);

        waSock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                waQrCount++;
                console.log('\n[WA] QR #' + waQrCount + ' - Scan now!\n');
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('[WA] Disconnected. Reconnect:', shouldReconnect);
                waReady = false;
                if (shouldReconnect) setTimeout(startWhatsApp, 5000);
            } else if (connection === 'open') {
                console.log('[WA] ✅ Connected!');
                waReady = true;
                waQrCount = 0;
            }
        });

        waSock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const text = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           '[Media]';
                console.log('[WA] 📩', msg.key.remoteJid.split('@')[0] + ':', text);
            }
        });

    } catch (err) {
        console.error('[WA] Error:', err.message);
        setTimeout(startWhatsApp, 10000);
    }
}

// ==================== TELEGRAM COMMANDS ====================

// Check status
tgBot.onText(/\/start/, (msg) => {
    const status = 
        '🤖 *Bot Status*\n\n' +
        `📱 WhatsApp: ${waReady ? '✅ Connected' : '❌ Disconnected'}\n` +
        '📡 Telegram: ✅ Active\n' +
        `⏱ Uptime: ${Math.floor(process.uptime() / 60)}m`;
    
    tgBot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
});

// Send WhatsApp message from Telegram
tgBot.onText(/\/wsend (.+)/, async (msg, match) => {
    if (!waReady) {
        return tgBot.sendMessage(msg.chat.id, '❌ WhatsApp not connected');
    }
    
    const args = match[1].split(' ');
    const number = args[0].replace(/[^0-9]/g, '');
    const text = args.slice(1).join(' ');
    
    if (!number || !text) {
        return tgBot.sendMessage(msg.chat.id, 'Usage: /wsend 1234567890 Hello world');
    }
    
    try {
        await waSock.sendMessage(number + '@s.whatsapp.net', { text: text });
        tgBot.sendMessage(msg.chat.id, '✅ Message sent to ' + number);
    } catch (err) {
        tgBot.sendMessage(msg.chat.id, '❌ Failed: ' + err.message);
    }
});

// Reconnect WhatsApp
tgBot.onText(/\/reconnect/, (msg) => {
    tgBot.sendMessage(msg.chat.id, '🔄 Restarting WhatsApp...');
    if (waSock) waSock.end();
    setTimeout(startWhatsApp, 2000);
});

// Get WhatsApp groups
tgBot.onText(/\/groups/, async (msg) => {
    if (!waReady) {
        return tgBot.sendMessage(msg.chat.id, '❌ WhatsApp not connected');
    }
    
    try {
        const groups = await waSock.groupFetchAllParticipating();
        const list = Object.values(groups).map(g => `• ${g.subject}`).join('\n');
        tgBot.sendMessage(msg.chat.id, '📋 Groups:\n' + (list || 'No groups found'));
    } catch (err) {
        tgBot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
    }
});

// ==================== START ====================
console.log('🚀 Starting...');
startWhatsApp();
