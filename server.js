require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const AUTH_BASE_PATH = process.env.RENDER ? '/tmp/auth_info' : './auth_info';

if (!fs.existsSync(AUTH_BASE_PATH)) {
    fs.mkdirSync(AUTH_BASE_PATH, { recursive: true });
}

const app = express();
app.get('/', (req, res) => {
    res.json({ status: 'alive', bot: 'Zenin Gangster Bot' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    if (!process.env.QUIET) console.log(`✅ Web server on port ${PORT}`);
});

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (!telegramToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found');
    process.exit(1);
}

const bot = new TelegramBot(telegramToken, { 
    polling: { autoStart: false, interval: 300, params: { timeout: 10 } },
    webHook: false
});

const userSessions = new Map();

// Quiet mode - suppress Baileys logs
const logger = P({ level: 'silent' });

// ==================== COMMANDS ====================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
        `👋 *Welcome!*\n\n` +
        `/link - Link WhatsApp\n` +
        `/reset - Clear auth\n` +
        `/status - Check status\n\n` +
        `⚠️ Use + before number: +2349022698322`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    const authFolder = path.join(AUTH_BASE_PATH, String(chatId));
    
    try {
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        userSessions.delete(chatId);
        bot.sendMessage(chatId, `✅ Cleared! Send /link to reconnect.`);
    } catch (err) {
        bot.sendMessage(chatId, `❌ Error.`);
    }
});

bot.onText(/\/link/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Clear old session
    const authFolder = path.join(AUTH_BASE_PATH, String(chatId));
    try {
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
    } catch(e) {}
    userSessions.delete(chatId);
    
    bot.sendMessage(chatId, 
        `📱 *Link WhatsApp*\n\n` +
        `*Method 1:* Wait 5s for QR code\n` +
        `*Method 2:* Send +number\n` +
        `Example: \`+2349022698322\`\n\n` +
        `⏳ QR coming...`,
        { parse_mode: 'Markdown' }
    );
    
    setTimeout(() => {
        const session = userSessions.get(chatId);
        if (!session?.connected && !session?.usingCode) {
            connectWhatsApp(chatId, null, 'qr');
        }
    }, 5000);
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    bot.sendMessage(chatId, session?.connected ? `✅ Connected` : `❌ Not linked`);
});

// ==================== MESSAGE HANDLER ====================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    // With + sign
    if (text.startsWith('+') && /^\+\d{10,15}$/.test(text.replace(/\s/g, ''))) {
        const cleanNumber = text.replace(/\s/g, '');
        userSessions.set(chatId, { usingCode: true });
        bot.sendMessage(chatId, `⏳ Generating code...`);
        return connectWhatsApp(chatId, cleanNumber, 'code');
    }
    
    // Forgot +
    if (/^\d{10,15}$/.test(text.replace(/\s/g, ''))) {
        return bot.sendMessage(chatId, `❌ Add + sign!\nUse: +${text}`);
    }
    
    bot.sendMessage(chatId, `Echo: ${text}`);
});

// ==================== WHATSAPP ====================

async function connectWhatsApp(chatId, phoneNumber, method) {
    const authFolder = path.join(AUTH_BASE_PATH, String(chatId));
    let sock = null;
    
    try {
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        fs.mkdirSync(authFolder, { recursive: true });
        
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        sock = makeWASocket({
            auth: state,
            logger: logger, // Silent
            browser: ['ZeninBot', 'Chrome', '1.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });
        
        let qrSent = false;
        let codeSent = false;
        let connectionOpen = false;
        let hasError = false;
        
        userSessions.set(chatId, {
            sock: sock,
            saveCreds: saveCreds,
            connected: false,
            usingCode: method === 'code'
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (hasError) return; // Stop processing if error occurred
            
            // QR
            if (qr && !qrSent && !connectionOpen && method === 'qr') {
                qrSent = true;
                try {
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                    await bot.sendPhoto(chatId, qrUrl, {
                        caption: `📱 Scan QR\n1. WhatsApp → Settings → Linked Devices\n2. Link a Device\n\n⏳ 20 seconds!`
                    });
                } catch (err) {
                    bot.sendMessage(chatId, `❌ QR failed. Use +number`);
                }
            }
            
            // Pairing Code
            if (connection === 'connecting' && method === 'code' && !codeSent && phoneNumber) {
                codeSent = true;
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        await bot.sendMessage(chatId,
                            `🔑 *Code:* \`${code}\`\n\n` +
                            `1. WhatsApp → Linked Devices\n` +
                            `2. "Link with phone number"\n` +
                            `3. Enter: *${code}*`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (err) {
                        hasError = true;
                        bot.sendMessage(chatId, `❌ Pairing failed. Try QR method.`);
                    }
                }, 3000);
            }
            
            // Connected
            if (connection === 'open') {
                connectionOpen = true;
                const session = userSessions.get(chatId);
                if (session) session.connected = true;
                bot.sendMessage(chatId, `✅ Connected!`);
            }
            
            // Disconnected - NO AUTO CLEAR (prevents race condition)
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                hasError = true;
                
                userSessions.delete(chatId);
                
                // Don't delete folder immediately - let Baileys finish
                if (statusCode === 405 || statusCode === 401) {
                    bot.sendMessage(chatId, 
                        `❌ Failed (405). Wrong number or expired.\n\n` +
                        `Send /reset to clear, then /link again.`
                    );
                } else if (statusCode === DisconnectReason.loggedOut) {
                    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e){}
                    bot.sendMessage(chatId, `❌ Logged out. Use /link.`);
                } else if (!connectionOpen) {
                    bot.sendMessage(chatId, `❌ Failed. Try /reset then /link.`);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (!message.key.fromMe && message.message) {
                const sender = message.key.remoteJid;
                const text = message.message.conversation || 
                            message.message.extendedTextMessage?.text || '';
                bot.sendMessage(chatId, `📨 +${sender.split('@')[0]}: ${text}`);
            }
        });
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        userSessions.delete(chatId);
    }
}

process.on('SIGTERM', async () => {
    bot.stopPolling();
    server.close(() => process.exit(0));
});

setTimeout(() => {
    bot.startPolling();
    if (!process.env.QUIET) console.log('🤖 Bot started');
}, 5000);
