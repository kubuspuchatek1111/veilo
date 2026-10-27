const express = require('express');
const http = require('http');
const crypto = require('crypto');
const Stripe = require('stripe');
const { Pool } = require('pg');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.post('/api/payments/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json({ limit: '10mb' }));

const users = Object.create(null);
const rooms = Object.create(null);
const bannedNicknames = Object.create(null);
const dbPool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.RENDER ? { rejectUnauthorized: false } : undefined
}) : null;
let roomAdminSchemaPromise;

function isValidRoomId(room) {
    return typeof room === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(room);
}

function roomAdminCookieName(room) {
    return 'veilo_room_admin_' + room;
}

function readCookie(req, name) {
    const cookies = (req.headers.cookie || '').split(';');
    const item = cookies.map(value => value.trim()).find(value => value.startsWith(name + '='));
    if (!item) return '';
    try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
}

function hashOwnerToken(token) {
    return crypto.createHash('sha256').update(token).digest();
}

function matchesOwnerToken(token, storedHash) {
    if (!token || !storedHash) return false;
    const supplied = hashOwnerToken(token);
    const expected = Buffer.from(storedHash, 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function setRoomAdminCookie(req, res, room, token) {
    const secure = req.secure ? '; Secure' : '';
    res.append('Set-Cookie', roomAdminCookieName(room) + '=' + encodeURIComponent(token) +
        '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + secure);
}

async function ensureRoomAdminSchema() {
    if (!dbPool) throw new Error('Brak DATABASE_URL');
    if (!roomAdminSchemaPromise) {
        roomAdminSchemaPromise = dbPool.query(`
            CREATE TABLE IF NOT EXISTS room_admin_purchases (
                room TEXT PRIMARY KEY,
                purchase_id TEXT NOT NULL UNIQUE,
                owner_token_hash TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN ('pending', 'paid')),
                stripe_session_id TEXT UNIQUE,
                checkout_url TEXT,
                expires_at BIGINT,
                appearance JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                paid_at TIMESTAMPTZ
            )
        `).then(() => dbPool.query(
            "ALTER TABLE room_admin_purchases ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{}'::jsonb"
        )).catch(error => {
            roomAdminSchemaPromise = null;
            throw error;
        });
    }
    await roomAdminSchemaPromise;
}

function getStripeClient() {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Brak STRIPE_SECRET_KEY');
    return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function requireRoomAdminOwner(req, res, next) {
    const room = req.params.room;
    if (!isValidRoomId(room)) return res.status(400).json({ error: 'Nieprawidłowy pokój' });
    ensureRoomAdminSchema().then(async () => {
        const result = await dbPool.query(
            "SELECT owner_token_hash FROM room_admin_purchases WHERE room = $1 AND state = 'paid'",
            [room]
        );
        const token = readCookie(req, roomAdminCookieName(room));
        if (!result.rows.length || !matchesOwnerToken(token, result.rows[0].owner_token_hash)) {
            res.status(403).json({ error: 'Brak uprawnień administratora tego pokoju' });
            return;
        }
        req.roomAdminRoom = room;
        next();
    }).catch(error => {
        console.error('Błąd autoryzacji administratora pokoju:', error.message);
        res.status(503).json({ error: 'Płatności administratora pokoju nie są skonfigurowane' });
    });
}

function stripeWebhook(req, res) {
    if (!Buffer.isBuffer(req.body) || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
        return res.status(503).send('Płatności nie są skonfigurowane');
    }

    let event;
    try {
        event = getStripeClient().webhooks.constructEvent(
            req.body,
            req.get('stripe-signature'),
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        return res.status(400).send('Nieprawidłowy podpis webhooka');
    }

    const supportedEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
    if (!supportedEvents.includes(event.type)) return res.json({ received: true });

    const session = event.data.object;
    const metadata = session.metadata || {};
    if (metadata.purpose !== 'room_admin') return res.json({ received: true });
    if (!isValidRoomId(metadata.room) || session.mode !== 'payment' ||
        session.currency !== 'pln' || session.amount_total !== 200 || !metadata.purchase_id) {
        return res.status(400).send('Nieprawidłowe dane płatności');
    }
    if (session.payment_status !== 'paid') return res.json({ received: true });

    ensureRoomAdminSchema().then(async () => {
        const update = await dbPool.query(
            "UPDATE room_admin_purchases SET state = 'paid', paid_at = NOW() " +
            "WHERE room = $1 AND purchase_id = $2 AND stripe_session_id = $3 AND state = 'pending'",
            [metadata.room, metadata.purchase_id, session.id]
        );
        if (update.rowCount === 0) {
            const existing = await dbPool.query(
                "SELECT state FROM room_admin_purchases WHERE room = $1 AND purchase_id = $2 AND stripe_session_id = $3",
                [metadata.room, metadata.purchase_id, session.id]
            );
            if (existing.rows[0]?.state !== 'paid') throw new Error('Brak oczekującego zakupu dla sesji Stripe');
        }
        res.json({ received: true });
    }).catch(error => {
        console.error('Błąd zapisu płatności administratora pokoju:', error.message);
        res.status(500).send('Nie udało się zapisać płatności');
    });
}

function normalizeNickname(nickname) {
    return nickname.trim().toLowerCase();
}

function getRoomBans(room) {
    return bannedNicknames[room] || (bannedNicknames[room] = new Map());
}

function getRoomUsers(room) {
    return Object.entries(users)
        .filter(([, user]) => user.room === room)
        .map(([socketId, user]) => ({ socketId, nickname: user.nickname, muted: user.muted }));
}

function sendRoomUserList(room) {
    if (rooms[room]) {
        io.to(room).emit('user list', getRoomUsers(room));
    }
}

function removeUserFromRoom(socketId, { notify = true } = {}) {
    const user = users[socketId];
    if (!user) return null;

    const room = user.room;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.leave(room);
    delete users[socketId];

    if (notify) io.to(room).emit('user left', user.nickname);
    if (rooms[room]) {
        sendRoomUserList(room);
        if (getRoomUsers(room).length === 0) delete rooms[room];
    }
    return user;
}

function requireAdmin(req, res, next) {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
        return res.status(503).json({ error: 'API administratora nie jest skonfigurowane' });
    }

    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer (.+)$/i);
    const provided = match?.[1] || '';
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (providedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return res.status(401).json({ error: 'Nieprawidłowy klucz administratora' });
    }
    next();
}

// === SERWOWANIE VIDEO PAGE ===
app.get('/video.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'video.html'));
});

// === REST API ===
app.post('/api/join', (req, res) => {
    const { nickname, room, password } = req.body || {};
    if (typeof nickname !== 'string' || !nickname.trim() || typeof room !== 'string' || !room ||
        typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Brak wymaganych danych' });
    }
    if (bannedNicknames[room]?.has(normalizeNickname(nickname))) {
        return res.status(403).json({ error: 'Ten nick został zablokowany w tym pokoju' });
    }
    if (!rooms[room]) {
        rooms[room] = { password };
    } else if (rooms[room].password !== password) {
        return res.status(403).json({ error: 'Nieprawidłowe hasło' });
    }
    res.json({ success: true, room, users: getRoomUsers(room).map(user => user.nickname) });
});

app.post('/api/message', (req, res) => {
    const { socketId, room, password, message } = req.body || {};
    const user = users[socketId];
    if (!user || user.room !== room || user.muted || !rooms[room] || rooms[room].password !== password ||
        typeof message !== 'string' || !message.trim() || message.length > 500) {
        return res.status(400).json({ error: 'Błąd walidacji' });
    }
    io.to(room).emit('chat message', { nickname: user.nickname, message: message.trim(), timestamp: Date.now() });
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    res.json({ 
        online: Object.keys(users).length, 
        rooms: Object.keys(rooms).length,
        status: "operational" 
    });
});

// === MODERATION API (requires Authorization: Bearer <ADMIN_API_KEY>) ===
app.get('/api/admin/rooms', requireAdmin, (req, res) => {
    res.json({
        rooms: Object.keys(rooms).filter(room => getRoomUsers(room).length > 0).map(room => ({
            room,
            usersOnline: getRoomUsers(room).length
        }))
    });
});

app.get('/api/admin/rooms/:room/users', requireAdmin, (req, res) => {
    if (!rooms[req.params.room] || getRoomUsers(req.params.room).length === 0) {
        return res.status(404).json({ error: 'Pokój nie istnieje lub nie ma aktywnych użytkowników' });
    }
    res.json({ room: req.params.room, users: getRoomUsers(req.params.room) });
});

app.get('/api/admin/rooms/:room/bans', requireAdmin, (req, res) => {
    const bans = bannedNicknames[req.params.room];
    res.json({ room: req.params.room, bannedNicknames: bans ? Array.from(bans.values()) : [] });
});

app.post('/api/admin/rooms/:room/kick', requireAdmin, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.params.room) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }

    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('system message', { message: 'Moderator usunął Cię z pokoju.', timestamp: Date.now() });
    const removed = removeUserFromRoom(socketId);
    res.json({ success: true, room: req.params.room, nickname: removed.nickname });
});

app.post('/api/admin/rooms/:room/ban', requireAdmin, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.params.room) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }

    getRoomBans(req.params.room).set(normalizeNickname(user.nickname), user.nickname);
    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('system message', { message: 'Moderator zablokował Twój nick w tym pokoju.', timestamp: Date.now() });
    const removed = removeUserFromRoom(socketId);
    res.json({ success: true, room: req.params.room, nickname: removed.nickname });
});

app.post('/api/admin/rooms/:room/unban', requireAdmin, (req, res) => {
    const { nickname } = req.body || {};
    if (typeof nickname !== 'string' || !nickname.trim()) {
        return res.status(400).json({ error: 'Nick jest wymagany' });
    }
    const bans = bannedNicknames[req.params.room];
    const removed = bans?.delete(normalizeNickname(nickname)) || false;
    res.json({ success: true, room: req.params.room, nickname: nickname.trim(), unbanned: removed });
});

app.post('/api/admin/rooms/:room/mute', requireAdmin, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.params.room) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    user.muted = true;
    io.to(socketId).emit('system message', { message: 'Moderator wyciszył Cię w tym pokoju.', timestamp: Date.now() });
    res.json({ success: true, room: req.params.room, socketId, muted: true });
});

app.post('/api/admin/rooms/:room/unmute', requireAdmin, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.params.room) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    user.muted = false;
    io.to(socketId).emit('system message', { message: 'Moderator zdjął wyciszenie w tym pokoju.', timestamp: Date.now() });
    res.json({ success: true, room: req.params.room, socketId, muted: false });
});

app.post('/api/admin/rooms/:room/broadcast', requireAdmin, (req, res) => {
    const { message } = req.body || {};
    if (!rooms[req.params.room] || getRoomUsers(req.params.room).length === 0) {
        return res.status(404).json({ error: 'Pokój nie istnieje lub nie ma aktywnych użytkowników' });
    }
    if (typeof message !== 'string' || !message.trim() || message.length > 500) {
        return res.status(400).json({ error: 'Wiadomość musi mieć od 1 do 500 znaków' });
    }
    io.to(req.params.room).emit('system message', { message: message.trim(), timestamp: Date.now() });
    res.json({ success: true, room: req.params.room });
});

// === ROOM ADMIN (one-time Stripe Checkout purchase) ===
const ROOM_APPEARANCE_OPTIONS = {
    theme: ['night', 'light', 'ocean', 'rose', 'forest'],
    font: ['inter', 'system', 'serif', 'mono'],
    bubbles: ['rounded', 'square', 'pill']
};

function normalizeRoomAppearance(value = {}) {
    return {
        theme: ROOM_APPEARANCE_OPTIONS.theme.includes(value.theme) ? value.theme : 'night',
        font: ROOM_APPEARANCE_OPTIONS.font.includes(value.font) ? value.font : 'inter',
        bubbles: ROOM_APPEARANCE_OPTIONS.bubbles.includes(value.bubbles) ? value.bubbles : 'rounded'
    };
}

app.get('/api/room-admin/appearance', async (req, res) => {
    const room = req.query.room;
    if (!isValidRoomId(room)) return res.status(400).json({ error: 'Nieprawidłowy pokój' });
    if (!dbPool) return res.json({ appearance: normalizeRoomAppearance() });
    try {
        await ensureRoomAdminSchema();
        const result = await dbPool.query(
            "SELECT appearance FROM room_admin_purchases WHERE room = $1 AND state = 'paid'",
            [room]
        );
        res.json({ appearance: normalizeRoomAppearance(result.rows[0]?.appearance || {}) });
    } catch (error) {
        console.error('Błąd pobierania wyglądu pokoju:', error.message);
        res.status(503).json({ error: 'Nie można teraz pobrać wyglądu pokoju' });
    }
});

app.put('/api/room-admin/rooms/:room/appearance', requireRoomAdminOwner, async (req, res) => {
    const appearance = req.body?.appearance;
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) ||
        !ROOM_APPEARANCE_OPTIONS.theme.includes(appearance.theme) ||
        !ROOM_APPEARANCE_OPTIONS.font.includes(appearance.font) ||
        !ROOM_APPEARANCE_OPTIONS.bubbles.includes(appearance.bubbles)) {
        return res.status(400).json({ error: 'Nieprawidłowe ustawienia wyglądu' });
    }

    const normalized = normalizeRoomAppearance(appearance);
    try {
        await dbPool.query(
            "UPDATE room_admin_purchases SET appearance = $1::jsonb WHERE room = $2 AND state = 'paid'",
            [JSON.stringify(normalized), req.roomAdminRoom]
        );
        io.to(req.roomAdminRoom).emit('room appearance updated', normalized);
        res.json({ success: true, appearance: normalized });
    } catch (error) {
        console.error('Błąd zapisywania wyglądu pokoju:', error.message);
        res.status(503).json({ error: 'Nie udało się zapisać wyglądu pokoju' });
    }
});

app.get('/api/room-admin/status', async (req, res) => {
    const room = req.query.room;
    if (!isValidRoomId(room)) return res.status(400).json({ error: 'Nieprawidłowy pokój' });
    if (!dbPool) return res.json({ enabled: false, hasAdmin: false, isOwner: false, pricePln: 2 });

    try {
        await ensureRoomAdminSchema();
        const result = await dbPool.query(
            'SELECT state, owner_token_hash FROM room_admin_purchases WHERE room = $1',
            [room]
        );
        const purchase = result.rows[0];
        const token = readCookie(req, roomAdminCookieName(room));
        const isOwner = purchase?.state === 'paid' &&
            matchesOwnerToken(token, purchase.owner_token_hash);
        res.json({
            enabled: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
            hasAdmin: purchase?.state === 'paid',
            isOwner,
            pending: purchase?.state === 'pending' && matchesOwnerToken(token, purchase.owner_token_hash),
            pricePln: 2
        });
    } catch (error) {
        console.error('Błąd sprawdzania administratora pokoju:', error.message);
        res.status(503).json({ error: 'Nie można teraz sprawdzić uprawnień administratora' });
    }
});

app.post('/api/room-admin/checkout', async (req, res) => {
    const { room } = req.body || {};
    if (!isValidRoomId(room)) return res.status(400).json({ error: 'Nieprawidłowy pokój' });
    if (!rooms[room] || getRoomUsers(room).length === 0) {
        return res.status(404).json({ error: 'Dołącz do pokoju przed zakupem administratora' });
    }
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !dbPool) {
        return res.status(503).json({ error: 'Płatności administratora pokoju nie są jeszcze skonfigurowane' });
    }

    try {
        await ensureRoomAdminSchema();
        const current = await dbPool.query(
            'SELECT purchase_id, owner_token_hash, state, checkout_url, expires_at FROM room_admin_purchases WHERE room = $1',
            [room]
        );
        const existing = current.rows[0];
        const existingToken = readCookie(req, roomAdminCookieName(room));

        if (existing?.state === 'paid') {
            return res.status(409).json({ error: 'Ten pokój ma już administratora' });
        }
        if (existing?.state === 'pending') {
            const ownsPendingCheckout = matchesOwnerToken(existingToken, existing.owner_token_hash);
            const checkoutStillActive = !existing.expires_at ||
                Number(existing.expires_at) > Math.floor(Date.now() / 1000);
            if (ownsPendingCheckout && existing.checkout_url && checkoutStillActive) {
                return res.json({ url: existing.checkout_url });
            }
            if (checkoutStillActive) {
                return res.status(409).json({ error: 'Zakup administratora dla tego pokoju jest już rozpoczęty' });
            }
            await dbPool.query('DELETE FROM room_admin_purchases WHERE room = $1 AND state = $2', [room, 'pending']);
        }

        const purchaseId = crypto.randomUUID();
        const ownerToken = crypto.randomBytes(32).toString('hex');
        await dbPool.query(
            "INSERT INTO room_admin_purchases (room, purchase_id, owner_token_hash, state) VALUES ($1, $2, $3, 'pending')",
            [room, purchaseId, hashOwnerToken(ownerToken).toString('hex')]
        );

        try {
            const baseUrl = (process.env.APP_BASE_URL || 'https://veilo.onrender.com').replace(/\/$/, '');
            const stripe = getStripeClient();
            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                locale: 'pl',
                client_reference_id: purchaseId,
                line_items: [{
                    price_data: {
                        currency: 'pln',
                        unit_amount: 200,
                        product_data: { name: 'Admin pokoju Veilo' }
                    },
                    quantity: 1
                }],
                success_url: baseUrl + '/?room=' + encodeURIComponent(room) + '&admin_payment=success',
                cancel_url: baseUrl + '/?room=' + encodeURIComponent(room) + '&admin_payment=cancel',
                metadata: { purpose: 'room_admin', room, purchase_id: purchaseId }
            }, { idempotencyKey: purchaseId });

            const savedSession = await dbPool.query(
                'UPDATE room_admin_purchases SET stripe_session_id = $1, checkout_url = $2, expires_at = $3 WHERE room = $4 AND purchase_id = $5',
                [session.id, session.url, session.expires_at, room, purchaseId]
            );
            if (savedSession.rowCount !== 1) throw new Error('Nie udało się powiązać sesji płatności z pokojem');
            setRoomAdminCookie(req, res, room, ownerToken);
            res.json({ url: session.url });
        } catch (error) {
            await dbPool.query('DELETE FROM room_admin_purchases WHERE room = $1 AND purchase_id = $2', [room, purchaseId]);
            throw error;
        }
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Zakup administratora dla tego pokoju jest już rozpoczęty' });
        }
        console.error('Błąd tworzenia płatności administratora pokoju:', error.message);
        res.status(503).json({ error: 'Nie udało się rozpocząć płatności. Spróbuj ponownie później.' });
    }
});

app.get('/api/room-admin/rooms/:room/users', requireRoomAdminOwner, (req, res) => {
    res.json({ room: req.roomAdminRoom, users: getRoomUsers(req.roomAdminRoom) });
});

app.get('/api/room-admin/rooms/:room/bans', requireRoomAdminOwner, (req, res) => {
    const bans = bannedNicknames[req.roomAdminRoom];
    res.json({ room: req.roomAdminRoom, bannedNicknames: bans ? Array.from(bans.values()) : [] });
});

app.post('/api/room-admin/rooms/:room/kick', requireRoomAdminOwner, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.roomAdminRoom) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('system message', { message: 'Administrator pokoju usunął Cię z pokoju.', timestamp: Date.now() });
    const removed = removeUserFromRoom(socketId);
    res.json({ success: true, nickname: removed.nickname });
});

app.post('/api/room-admin/rooms/:room/ban', requireRoomAdminOwner, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.roomAdminRoom) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    getRoomBans(req.roomAdminRoom).set(normalizeNickname(user.nickname), user.nickname);
    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('system message', { message: 'Administrator pokoju zablokował Twój nick.', timestamp: Date.now() });
    const removed = removeUserFromRoom(socketId);
    res.json({ success: true, nickname: removed.nickname });
});

app.post('/api/room-admin/rooms/:room/unban', requireRoomAdminOwner, (req, res) => {
    const { nickname } = req.body || {};
    if (typeof nickname !== 'string' || !nickname.trim()) {
        return res.status(400).json({ error: 'Nick jest wymagany' });
    }
    const removed = bannedNicknames[req.roomAdminRoom]?.delete(normalizeNickname(nickname)) || false;
    res.json({ success: true, unbanned: removed, nickname: nickname.trim() });
});

app.post('/api/room-admin/rooms/:room/mute', requireRoomAdminOwner, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.roomAdminRoom) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    user.muted = true;
    io.to(socketId).emit('system message', { message: 'Administrator pokoju Cię wyciszył.', timestamp: Date.now() });
    res.json({ success: true, socketId, muted: true });
});

app.post('/api/room-admin/rooms/:room/unmute', requireRoomAdminOwner, (req, res) => {
    const { socketId } = req.body || {};
    const user = users[socketId];
    if (!socketId || !user || user.room !== req.roomAdminRoom) {
        return res.status(404).json({ error: 'Użytkownik nie jest aktywny w tym pokoju' });
    }
    user.muted = false;
    io.to(socketId).emit('system message', { message: 'Administrator pokoju zdjął wyciszenie.', timestamp: Date.now() });
    res.json({ success: true, socketId, muted: false });
});

app.post('/api/room-admin/rooms/:room/broadcast', requireRoomAdminOwner, (req, res) => {
    const { message } = req.body || {};
    if (!rooms[req.roomAdminRoom] || getRoomUsers(req.roomAdminRoom).length === 0) {
        return res.status(404).json({ error: 'Pokój nie istnieje lub nie ma aktywnych użytkowników' });
    }
    if (typeof message !== 'string' || !message.trim() || message.length > 500) {
        return res.status(400).json({ error: 'Wiadomość musi mieć od 1 do 500 znaków' });
    }
    io.to(req.roomAdminRoom).emit('system message', { message: message.trim(), timestamp: Date.now() });
    res.json({ success: true, room: req.roomAdminRoom });
});

app.post('/api/generate-hash', (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: 'Hasło jest wymagane' });
    }
    const salt = "veilo-salt-2026";
    let hash = 0;
    const str = salt + password.toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    const roomHash = Math.abs(hash).toString(36).substring(0, 8).toUpperCase();
    res.json({ password, roomHash, joinUrl: `${req.headers.origin}/?room=${roomHash}` });
});

// === SOCKET.IO + WEBRTC ===
io.on('connection', (socket) => {
    console.log('🔌 Połączenie:', socket.id);

    socket.on('join', (data = {}) => {
        const { room, password } = data;
        const nickname = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 32) : '';
        if (!nickname || typeof room !== 'string' || !room || typeof password !== 'string' || !password) {
            socket.emit('error', 'Nieprawidłowe dane dołączenia.');
            return;
        }
        if (bannedNicknames[room]?.has(normalizeNickname(nickname))) {
            socket.emit('error', 'Ten nick został zablokowany w tym pokoju.');
            return;
        }
        if (!rooms[room]) {
            rooms[room] = { password };
        } else if (rooms[room].password !== password) {
            socket.emit('error', 'Nieprawidłowe hasło!');
            return;
        }
        if (users[socket.id]) removeUserFromRoom(socket.id);

        socket.join(room);
        users[socket.id] = { nickname, room, password, muted: false };
        
        socket.to(room).emit('user joined', nickname);
        socket.emit('joined', { room, users: getRoomUsers(room).map(user => user.nickname) });
        sendRoomUserList(room);
        console.log(`✅ ${nickname} w ${room}`);
    });

    // === WEBRTC SIGNALLING ===
    socket.on('webrtc-offer', (data) => {
        socket.to(data.target).emit('webrtc-offer-received', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.target).emit('webrtc-answer-received', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.target).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // VIDEO/AUDIO TOGGLES
    socket.on('toggle-video', (data) => {
        socket.to(data.room).emit('user-video-toggle', {
            userId: socket.id,
            videoOn: data.videoOn
        });
    });

    socket.on('toggle-audio', (data) => {
        socket.to(data.room).emit('user-audio-toggle', {
            userId: socket.id,
            audioOn: data.audioOn
        });
    });

    socket.on('chat message', (msg) => {
        const user = users[socket.id];
        if (user && !user.muted && msg && msg.room === user.room && msg.password === rooms[msg.room]?.password &&
            typeof msg.message === 'string' && msg.message.trim() && msg.message.length <= 500) {
            io.to(msg.room).emit('chat message', {
                nickname: user.nickname,
                message: msg.message.trim(),
                timestamp: Date.now()
            });
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            removeUserFromRoom(socket.id);
        }
    });
});

setInterval(() => {
    Object.keys(rooms).forEach(room => {
        if (getRoomUsers(room).length === 0) delete rooms[room];
    });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Veilo Chat + Video na porcie ${PORT}`);
});
