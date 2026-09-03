/**
 * Kirasha BTC Algo — WhatsApp Bridge
 * Phase 1: Monitor mentor's WA Channel → forward messages + images to Telegram alert channel.
 *
 * Handles both WhatsApp Groups (@g.us) and WhatsApp Channels (@newsletter).
 * "Option selling by CR" is a Channel — its JID ends in @newsletter.
 *
 * First start: lists all followed channels so you can identify the right JID.
 * Once WA_SOURCE_JID is set in .env: only forwards from that source.
 *
 * Alerts sent to TELEGRAM_ALERT_CHAT_ID on:
 *   - Connected
 *   - Connection dropped (with reconnect)
 *   - Logged out (critical)
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadMediaMessage,
    DisconnectReason,
} = require('@whiskeysockets/baileys')
const pino   = require('pino')
const qrcode = require('qrcode-terminal')
const https  = require('https')
const path   = require('path')
const fs     = require('fs')

require('dotenv').config({ path: path.join(__dirname, '.env') })

// WA_SOURCE_JID: JID of the mentor's WA channel or group to monitor
const SOURCE_JID          = (process.env.WA_SOURCE_JID || process.env.WA_GROUP_JID || '').trim()
const BOT_TOKEN           = process.env.TELEGRAM_BOT_TOKEN  || ''
const ALERT_CHAT          = process.env.TELEGRAM_ALERT_CHAT_ID || ''
const SESSION             = path.join(__dirname, 'wa_session')
const HEARTBEAT_ID_FILE   = path.join(__dirname, 'logs', 'wa_heartbeat_msg_id')
const HEARTBEAT_INTERVAL  = 15 * 60 * 1000  // 15 minutes

const ts  = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const log = (...a) => console.log(`[${ts()}] [WA Bridge]`, ...a)

// ── Telegram helpers ──────────────────────────────────────────────────────────

function tgPost(method, body) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body)
        const req  = https.request({
            hostname: 'api.telegram.org',
            path:     `/bot${BOT_TOKEN}/${method}`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))) })
        req.on('error', e => { log('TG error:', e.message); resolve(null) })
        req.write(data)
        req.end()
    })
}

function tgPostPhoto(imgBuffer, caption) {
    return new Promise((resolve) => {
        const boundary = 'WaBridge' + Date.now()
        const meta = Buffer.from([
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${ALERT_CHAT}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="signal.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ].join(''))
        const body = Buffer.concat([meta, imgBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)])
        const req  = https.request({
            hostname: 'api.telegram.org',
            path:     `/bot${BOT_TOKEN}/sendPhoto`,
            method:   'POST',
            headers:  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
        }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))) })
        req.on('error', e => { log('TG photo error:', e.message); resolve(null) })
        req.write(body)
        req.end()
    })
}

async function tgText(text) {
    if (!BOT_TOKEN || !ALERT_CHAT) return
    const res = await tgPost('sendMessage', { chat_id: ALERT_CHAT, text, parse_mode: 'HTML' })
    return res?.result?.message_id || null
}

async function tgPhoto(buffer, caption) {
    if (!BOT_TOKEN || !ALERT_CHAT) return
    await tgPostPhoto(buffer, caption)
}

async function tgDelete(messageId) {
    if (!BOT_TOKEN || !ALERT_CHAT || !messageId) return
    await tgPost('deleteMessage', { chat_id: ALERT_CHAT, message_id: messageId })
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function loadHeartbeatId() {
    try { return parseInt(fs.readFileSync(HEARTBEAT_ID_FILE, 'utf8').trim()) || null }
    catch (_) { return null }
}

function saveHeartbeatId(id) {
    try { if (id) fs.writeFileSync(HEARTBEAT_ID_FILE, String(id)) }
    catch (_) {}
}

function nowIST() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
    }).toUpperCase()
}

async function sendHeartbeat() {
    const prevId = loadHeartbeatId()
    if (prevId) await tgDelete(prevId)

    const sourceName = SOURCE_JID ? 'Option Selling by CR' : '⚠️ Not configured'
    const newId = await tgText(
        `🟢 <b>Kirasha Signal Watcher — Active</b>\n\n` +
        `🕐 ${nowIST()} IST\n` +
        `📡 Source: ${sourceName}\n` +
        `📨 Signals forwarding to alerts`
    )
    saveHeartbeatId(newId)
    log('Heartbeat sent')
}

// ── WhatsApp connection ───────────────────────────────────────────────────────

let _lastDisconnectAlert = 0  // debounce disconnect alerts (max 1 per 60s)
let _heartbeatTimer      = null

async function connect() {
    fs.mkdirSync(SESSION, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(SESSION)

    const sock = makeWASocket({
        auth:                state,
        logger:              pino({ level: 'silent' }),
        keepAliveIntervalMs: 30_000,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            qrcode.generate(qr, { small: true })
            log('QR shown — scan with WhatsApp → Linked Devices → Link a Device')
        }

        if (connection === 'open') {
            log('Connected to WhatsApp ✓')

            if (!SOURCE_JID) {
                // List followed channels so user can identify the right one
                let channelLines = ''
                try {
                    const newsletters = await sock.fetchAllNewsletters()
                    if (newsletters && newsletters.length) {
                        channelLines = '\n\n📢 <b>Channels you follow:</b>\n' +
                            newsletters.map(n => `• ${n.name || n.id}\n  <code>${n.id}</code>`).join('\n')
                    }
                } catch (_) {}

                log('WA_SOURCE_JID not set — listing channels')
                await tgText(
                    '⚠️ <b>Signal Watcher — Source not configured</b>\n\n' +
                    'Add <code>WA_SOURCE_JID=&lt;jid&gt;</code> to .env and restart.' +
                    channelLines
                )
            } else {
                const type = SOURCE_JID.endsWith('@newsletter') ? 'Channel' : 'Group'
                log(`Monitoring ${type}: ${SOURCE_JID}`)
                // Send first heartbeat immediately, then every 15 min
                await sendHeartbeat()
                if (_heartbeatTimer) clearInterval(_heartbeatTimer)
                _heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)
            }
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode
            log(`Disconnected (code ${code})`)

            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }

            if (code === DisconnectReason.loggedOut) {
                log('Logged out — delete wa_session/ and restart.')
                await tgText(
                    '🔴 <b>Signal Watcher — Logged Out</b>\n\n' +
                    'WhatsApp session was removed.\n' +
                    'SSH into VM, delete <code>wa_session/</code> and restart <code>kirafx-wa</code> to re-scan QR.'
                )
            } else {
                // Debounce: alert at most once every 60s to avoid spam during repeated reconnects
                const now = Date.now()
                if (now - _lastDisconnectAlert > 60_000) {
                    _lastDisconnectAlert = now
                    await tgText(`⚠️ <b>Signal Watcher — Disconnected</b>\nReconnecting automatically...`)
                }
                log('Reconnecting in 5s...')
                setTimeout(connect, 5_000)
            }
        }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
            if (!msg.message) continue
            if (msg.key.fromMe)  continue

            const jid       = msg.key.remoteJid || ''
            const isChannel = jid.endsWith('@newsletter')
            const isGroup   = jid.endsWith('@g.us')

            // Must be a channel or group
            if (!isChannel && !isGroup) continue

            // Filter to target source if set
            if (SOURCE_JID && jid !== SOURCE_JID) continue

            // If SOURCE_JID not set yet, log JID of every channel message to help identify
            if (!SOURCE_JID && isChannel) {
                log(`Channel message JID: ${jid}`)
            }

            const m      = msg.message
            const text   = m.conversation
                        || m.extendedTextMessage?.text
                        || m.imageMessage?.caption
                        || m.videoMessage?.caption
                        || m.newsletterAdminInviteMessage?.caption
                        || ''
            const sender = msg.pushName || (msg.key.participant || '').split('@')[0] || 'Channel'
            const tag    = isChannel
                ? `📢 <b>WA Channel Signal</b>`
                : `📲 <b>WA · ${sender}</b>`

            try {
                if (m.imageMessage) {
                    log(`Image from ${isChannel ? 'channel' : sender}${text ? ' + caption' : ''}`)
                    const buf = await downloadMediaMessage(
                        msg, 'buffer', {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                    )
                    await tgPhoto(buf, text ? `${tag}\n${text}` : tag)
                } else if (text.trim()) {
                    log(`Text: ${text.slice(0, 80)}`)
                    await tgText(`${tag}\n${text}`)
                }
            } catch (e) {
                log('Forward error:', e.message)
            }
        }
    })
}

connect()
