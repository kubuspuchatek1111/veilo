const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const users = Object.create(null);
const rooms = Object.create(null);
const bannedNicknames = Object.create(null);

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
        io.to(room).emit('user list', getRoomUsers(room).map(user => user.nickname));
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
