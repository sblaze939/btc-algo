/**
 * Kirasha BTC Algo — WhatsApp Bridge
 * Phase 1: Monitor signal channel → parse + verify → forward to Telegram alert channel.
 *
 * Handles both WhatsApp Groups (@g.us) and WhatsApp Channels (@newsletter).
 * First start: lists all followed channels so you can identify the right JID.
 * Once WA_SOURCE_JID is set in .env: only processes messages from that source.
 *
 * Signal confidence logic:
 *   High confidence text → forward parsed signal directly
 *   Low confidence text + image → cross-verify via Gemini Vision → tag accordingly
 *   Image only → Gemini extracts signal
 *   Info/non-signal text → forward as-is
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadMediaMessage,
    DisconnectReason,
} = require('@whiskeysockets/baileys')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const pino   = require('pino')
const qrcode = require('qrcode-terminal')
const https  = require('https')
const path   = require('path')
const fs     = require('fs')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const SOURCE_JID         = (process.env.WA_SOURCE_JID || process.env.WA_GROUP_JID || '').trim()
const BOT_TOKEN          = process.env.TELEGRAM_BOT_TOKEN  || ''
const ALERT_CHAT         = process.env.TELEGRAM_ALERT_CHAT_ID || ''
const GEMINI_KEY         = process.env.GEMINI_API_KEY || ''
const SESSION            = path.join(__dirname, 'wa_session')
const HEARTBEAT_ID_FILE  = path.join(__dirname, 'logs', 'wa_heartbeat_msg_id')
const HEARTBEAT_INTERVAL = 15 * 60 * 1000

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

async function tgText(text, html = true) {
    if (!BOT_TOKEN || !ALERT_CHAT) return null
    const body = { chat_id: ALERT_CHAT, text }
    if (html) body.parse_mode = 'HTML'
    const res = await tgPost('sendMessage', body)
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
    const newId = await tgText(
        `🟢 <b>Kirasha Signal Watcher — Active</b>\n\n` +
        `🕐 ${nowIST()} IST\n` +
        `🔍 Analysing the markets\n` +
        `⚡ Awaiting signals`
    )
    saveHeartbeatId(newId)
    log('Heartbeat sent')
}

// ── Signal parsing ────────────────────────────────────────────────────────────

const INFO_KEYWORDS = [
    'fyi', 'reminder', 'heads up', 'watch out', 'today is expiry',
    'expiry day', 'just info', 'incoming', 'expected', 'be careful',
    'good morning', 'good evening', 'good night', 'happy',
]

function parseSignalText(text) {
    const t = text.toLowerCase().trim()

    if (INFO_KEYWORDS.some(k => t.includes(k))) return { confidence: 'none', raw: text }

    let action = null
    if (/\b(sell|short|add)\b/.test(t))              action = 'sell'
    else if (/\b(buy|long|close|exit|book)\b/.test(t)) action = 'buy'

    const lotsMatch = t.match(/(\d+)\s*(?:more\s+)?lots?/)
    const lots = lotsMatch ? parseInt(lotsMatch[1]) : null

    const strikeMatch = t.match(/(\d+(?:\.\d+)?)\s*k\b/i) || t.match(/\b(\d{4,6})\b/)
    let strike = null
    if (strikeMatch) {
        const val = parseFloat(strikeMatch[1])
        strike = val < 1000 ? Math.round(val * 1000) : Math.round(val)
    }

    let optionType = null
    if (/\bpe\b|put/i.test(t))       optionType = 'PE'
    else if (/\bce\b|call/i.test(t)) optionType = 'CE'

    const fieldsFound = [action, lots, strike, optionType].filter(Boolean).length
    const confidence  = fieldsFound === 4 ? 'high' : fieldsFound >= 2 ? 'low' : 'none'

    return { action, lots, strike, optionType, confidence, raw: text }
}

function formatSignal(p) {
    const action = p.action ? (p.action[0].toUpperCase() + p.action.slice(1)) : '?'
    const lots   = p.lots   || '?'
    const strike = p.strike ? (p.strike / 1000 + 'K') : '?'
    const type   = p.optionType || '?'
    return `${action} ${lots} × ${strike} ${type}`
}

// ── Gemini Vision ─────────────────────────────────────────────────────────────

let _gemini = null
function geminiModel() {
    if (!_gemini) _gemini = new GoogleGenerativeAI(GEMINI_KEY)
    return _gemini.getGenerativeModel({ model: 'gemini-2.0-flash' })
}

function imgPart(buffer) {
    return { inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } }
}

function stripFences(s) {
    return s.replace(/```(?:json)?\n?|\n?```/g, '').trim()
}

async function verifyWithGemini(imageBuffer, parsed) {
    const strikeLabel = parsed.strike ? (parsed.strike / 1000 + 'K') : '?'
    const typeLabel   = parsed.optionType === 'PE' ? 'Put' : parsed.optionType === 'CE' ? 'Call' : '?'
    const prompt =
        `BTC options positions screenshot.\n` +
        `Signal to verify: SELL ${strikeLabel} ${typeLabel}\n\n` +
        `Check if a Sell position matching strike ${parsed.strike || '?'} ${typeLabel} exists.\n` +
        `Reply ONLY in raw JSON (no markdown):\n` +
        `{"match_found":true/false,"matched_instrument":"exact name or null","image_strike":"strike seen or null","image_type":"Put/Call or null"}`
    const result = await geminiModel().generateContent([prompt, imgPart(imageBuffer)])
    return JSON.parse(stripFences(result.response.text()))
}

async function extractFromImage(imageBuffer) {
    const prompt =
        `BTC options positions screenshot.\n` +
        `Identify the most prominent trade signal visible.\n` +
        `Reply ONLY in raw JSON (no markdown):\n` +
        `{"found":true/false,"action":"sell/buy/null","strike":number_or_null,"option_type":"PE/CE/null","lots":number_or_null}`
    const result = await geminiModel().generateContent([prompt, imgPart(imageBuffer)])
    const data = JSON.parse(stripFences(result.response.text()))
    if (!data.found) return null
    return { action: data.action, lots: data.lots, strike: data.strike, optionType: data.option_type }
}

// ── Signal handler ────────────────────────────────────────────────────────────

async function handleSignal(text, imageBuffer) {
    if (!text && !imageBuffer) return

    // Image only — extract via Gemini
    if (!text && imageBuffer) {
        log('Image only — Gemini extraction')
        try {
            const extracted = await extractFromImage(imageBuffer)
            const caption = extracted
                ? `🔍 ${formatSignal(extracted)}\nSource: Image analysis`
                : ''
            await tgPhoto(imageBuffer, caption)
        } catch (e) {
            log('Gemini extraction error:', e.message)
            await tgPhoto(imageBuffer, '')
        }
        return
    }

    const parsed = parseSignalText(text)
    log(`Parsed: confidence=${parsed.confidence} signal=${formatSignal(parsed)}`)

    // Not a signal — forward raw text
    if (parsed.confidence === 'none') {
        await tgText(text, false)
        return
    }

    const signal = formatSignal(parsed)

    // High confidence
    if (parsed.confidence === 'high') {
        const caption = `✅ ${signal}\nConfidence: High`
        if (imageBuffer) await tgPhoto(imageBuffer, caption)
        else             await tgText(caption, false)
        return
    }

    // Low confidence, no image
    if (!imageBuffer) {
        await tgText(`⚠️ ${signal}\nConfidence: Low (no image to verify)`, false)
        return
    }

    // Low confidence + image → cross-verify
    log('Low confidence — cross-verifying with Gemini')
    try {
        const verify = await verifyWithGemini(imageBuffer, parsed)
        if (verify.match_found) {
            await tgPhoto(imageBuffer, `🔍 ${signal}\nConfidence: Low → Image confirmed ✓`)
        } else {
            const imgDetail = [verify.image_strike, verify.image_type].filter(Boolean).join(' ') || 'unclear'
            const textDetail = `${parsed.strike ? parsed.strike / 1000 + 'K' : '?'} ${parsed.optionType || '?'}`
            await tgPhoto(imageBuffer,
                `⚠️ Signal conflict\nText: ${textDetail} · Image: ${imgDetail}\nManual review needed`)
        }
    } catch (e) {
        log('Gemini verify error:', e.message)
        await tgPhoto(imageBuffer, `🔍 ${signal}\nConfidence: Low (image verify failed)`)
    }
}

// ── WhatsApp connection ───────────────────────────────────────────────────────

let _lastDisconnectAlert = 0
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

            if (!isChannel && !isGroup) continue
            if (SOURCE_JID && jid !== SOURCE_JID) continue
            if (!SOURCE_JID && isChannel) log(`Channel message JID: ${jid}`)

            const m    = msg.message
            const text = (
                m.conversation
                || m.extendedTextMessage?.text
                || m.imageMessage?.caption
                || m.videoMessage?.caption
                || ''
            ).trim()

            try {
                if (m.imageMessage) {
                    log(`Image received${text ? ' + caption' : ''}`)
                    const buf = await downloadMediaMessage(
                        msg, 'buffer', {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                    )
                    await handleSignal(text, buf)
                } else if (text) {
                    log(`Text: ${text.slice(0, 80)}`)
                    await handleSignal(text, null)
                }
            } catch (e) {
                log('Handle error:', e.message)
            }
        }
    })
}

connect()
