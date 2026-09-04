/**
 * Kirasha BTC Algo — WhatsApp Bridge (Phase 2)
 * Monitors WA signal channel → parses → KirashaAI card → Telegram signal channel.
 *
 * Handles both WhatsApp Groups (@g.us) and WhatsApp Channels (@newsletter).
 * First start: lists all followed channels so you can identify the right JID.
 * Once WA_SOURCE_JID is set in .env: only processes messages from that source.
 *
 * Signal confidence:
 *   action + contract + qty (+ expiry) → 🟢 HIGH   — executes with explicit expiry
 *   action + contract + qty (no expiry) → 🟡 MEDIUM — executes with current expiry
 *   missing action | contract | qty     → 🔴 LOW    — no execution
 *   no signal fields                    → ℹ️  info card
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
// Signal channel: TELEGRAM_CHANNEL_ID is the bare Telethon ID — bot API needs -100 prefix.
const _rawSigId          = (process.env.TELEGRAM_SIGNAL_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID || '').trim()
const SIGNAL_CHAT        = _rawSigId
    ? (_rawSigId.startsWith('-') ? _rawSigId : `-100${_rawSigId}`)
    : ''
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

function tgPostPhoto(imgBuffer, caption, chatId = ALERT_CHAT) {
    return new Promise((resolve) => {
        const boundary = 'WaBridge' + Date.now()
        const meta = Buffer.from([
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`,
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

async function tgText(text, html = true, chatId = ALERT_CHAT) {
    if (!BOT_TOKEN || !chatId) return null
    const body = { chat_id: chatId, text }
    if (html) body.parse_mode = 'HTML'
    const res = await tgPost('sendMessage', body)
    return res?.result?.message_id || null
}

async function tgPhoto(buffer, caption, chatId = ALERT_CHAT) {
    if (!BOT_TOKEN || !chatId) return
    await tgPostPhoto(buffer, caption, chatId)
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
    if (/\b(sell|short|add)\b/.test(t))               action = 'sell'
    else if (/\b(buy|long|close|exit|book)\b/.test(t)) action = 'buy'

    const lotsMatch = t.match(/(\d+)\s*(?:more\s+)?(?:lots?|x\b)/)
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

// ── Expiry extraction ─────────────────────────────────────────────────────────

const MONTH_MAP = {
    jan: 'Jan', january: 'Jan', feb: 'Feb', february: 'Feb',
    mar: 'Mar', march: 'Mar', apr: 'Apr', april: 'Apr', may: 'May',
    jun: 'Jun', june: 'Jun', jul: 'Jul', july: 'Jul',
    aug: 'Aug', august: 'Aug', sep: 'Sep', sept: 'Sep', september: 'Sep',
    oct: 'Oct', october: 'Oct', nov: 'Nov', november: 'Nov',
    dec: 'Dec', december: 'Dec',
}

function extractExpiry(text) {
    const t = text.toLowerCase()
    for (const [key, val] of Object.entries(MONTH_MAP)) {
        // "11 sep", "11th sep", "11 sep 2026" — \b prevents "sep" matching inside "september"
        let m = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${key}\\b(?:\\s+(\\d{4}))?`))
        if (m) return m[2] ? `${m[1]} ${val} ${m[2]}` : `${m[1]} ${val}`
        // "sep 11", "sep 11 2026"
        m = t.match(new RegExp(`\\b${key}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?`))
        if (m) return m[2] ? `${m[1]} ${val} ${m[2]}` : `${m[1]} ${val}`
    }
    return null
}

// ── Card formatting ───────────────────────────────────────────────────────────

const SEP = '━━━━━━━━━━━━━━━━━━━━━'

function buildCard(action, strike, optionType, lots, expiry) {
    const hasAction   = !!action
    const hasContract = !!(strike && optionType)
    const hasQty      = !!lots

    const actionStr   = hasAction   ? action.toUpperCase()      : '—'
    const contractStr = hasContract ? `${strike} ${optionType}` : '—'
    const qtyStr      = hasQty      ? `${lots} lots`            : '—'
    const expiryStr   = expiry      ? expiry                    : '— (using current)'

    let header, footer
    if (hasAction && hasContract && hasQty) {
        header = '🤖 KirashaAI · Market Intelligence'
        footer = expiry ? '🟢 HIGH CONFIDENCE' : '🟡 MEDIUM CONFIDENCE'
    } else {
        header = '🤖 KirashaAI · Market Intelligence'
        footer = '🔴 LOW · No execution'
    }

    return [header, SEP,
        `Action    : ${actionStr}`,
        `Contract  : ${contractStr}`,
        `Quantity  : ${qtyStr}`,
        `Expiry    : ${expiryStr}`,
    SEP, footer].join('\n')
}

function buildInfoCard(text) {
    return ['ℹ️ KirashaAI · Market Update', SEP, text, SEP, '📢 No action required'].join('\n')
}

function processText(text) {
    const parsed = parseSignalText(text)
    const expiry = extractExpiry(text)
    if (parsed.confidence === 'none') {
        log('Non-signal → info card')
        return buildInfoCard(text)
    }
    log(`Signal → card: action=${parsed.action} strike=${parsed.strike} type=${parsed.optionType} lots=${parsed.lots} expiry=${expiry} confidence=${parsed.confidence}`)
    return buildCard(parsed.action, parsed.strike, parsed.optionType, parsed.lots, expiry)
}

// ── Legacy (Phase 1) — kept, not called ──────────────────────────────────────

function formatSignal(p) {
    const action = p.action ? (p.action[0].toUpperCase() + p.action.slice(1)) : '?'
    const lots   = p.lots   || '?'
    const strike = p.strike ? (p.strike / 1000 + 'K') : '?'
    const type   = p.optionType || '?'
    return `${action} ${lots} × ${strike} ${type}`
}

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

async function handleSignal(text, imageBuffer) {
    // Phase 1 handler — superseded by processText() + buildCard()
    void text; void imageBuffer
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
        markOnlineOnConnect: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            qrcode.generate(qr, { small: true })
            log('QR shown — scan with WhatsApp → Linked Devices → Link a Device')
        }

        if (connection === 'open') {
            log('Connected to WhatsApp ✓')
            log(`Signal channel: ${SIGNAL_CHAT || '(not configured)'}`)

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

            if (!SIGNAL_CHAT) {
                log('WARNING: SIGNAL_CHAT not configured — message dropped. Set TELEGRAM_CHANNEL_ID in .env')
                continue
            }

            try {
                if (m.imageMessage) {
                    log(`Image received${text ? ' + caption' : ''}`)
                    // WA Channel posts don't carry media key — download always fails for newsletters.
                    try {
                        await downloadMediaMessage(msg, 'buffer', {},
                            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
                    } catch (_) {
                        log('Media download failed (channel restriction)')
                    }
                    // Process caption as signal regardless of image availability
                    if (text) {
                        const card = processText(text)
                        await tgText(card, false, SIGNAL_CHAT)
                    } else {
                        await tgText(buildInfoCard('[Image received — no caption]'), false, SIGNAL_CHAT)
                    }
                } else if (text) {
                    log(`Text — processing: ${text.slice(0, 80)}`)
                    const card = processText(text)
                    await tgText(card, false, SIGNAL_CHAT)
                }
            } catch (e) {
                log('Handle error:', e.message)
            }
        }
    })
}

connect()
