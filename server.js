const express = require('express');
const http = require('http');
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

const users = {}; 
const rooms = {}; 

// === SERWOWANIE STRON VIDEO ===
app.get('/video', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'video.html'));
});

// === REST API (bez zmian) ===
app.post('/api/join', (req, res) => {
    const { nickname, room, password } = req.body;
    if (!nickname || !room || !password) {
        return res.status(400).json({ error: 'Brak wymaganych danych' });
    }
    if (!rooms[room]) {
        rooms[room] = { password, users: [] };
    } else if (rooms[room].password !== password) {
        return res.status(403).json({ error: 'Nieprawidłowe hasło' });
    }
    res.json({ success: true, room, users: rooms[room].users });
});

app.post('/api/message', (req, res) => {
    const { nickname, room, password, message } = req.body;
    if (!rooms[room] || rooms[room].password !== password || message.length > 500) {
        return res.status(400).json({ error: 'Błąd walidacji' });
    }
    io.to(room).emit('chat message', { nickname, message: message.trim(), timestamp: Date.now() });
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    res.json({ 
        online: Object.keys(users).length, 
        rooms: Object.keys(rooms).length,
        status: "operational" 
    });
});

app.post('/api/generate-hash', (req, res) => {
    const { password } = req.body;
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

// === SOCKET.IO Z VIDEO ===
io.on('connection', (socket) => {
    console.log('🔌 Połączenie:', socket.id);

    // TEXT CHAT (bez zmian)
    socket.on('join', ({ nickname, room, password }) => {
        if (!rooms[room]) {
            rooms[room] = { password, users: [] };
        } else if (rooms[room].password !== password) {
            socket.emit('error', 'Nieprawidłowe hasło!');
            return;
        }

        socket.join(room);
        users[socket.id] = { nickname, room, password };
        rooms[room].users.push(nickname);
        
        socket.to(room).emit('user joined', nickname);
        socket.emit('joined', { room, users: rooms[room].users });
        updateRoomUsers(room);
    });

    // === WEBRTC VIDEO SIGNALLING ===
    socket.on('webrtc-offer', (data) => {
        socket.to(data.room).emit('webrtc-answer', {
            from: socket.id,
            offer: data.offer
        });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.target).emit('webrtc-offer-received', {
            from: socket.id,
            answer: data.answer
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.target).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

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

    // TEXT CHAT
    socket.on('chat message', (msg) => {
        const user = users[socket.id];
        if (user && msg.room === user.room && msg.password === rooms[msg.room]?.password) {
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
            const room = user.room;
            socket.to(room).emit('user left', user.nickname);
            rooms[room].users = rooms[room].users.filter(n => n !== user.nickname);
            if (rooms[room].users.length === 0) delete rooms[room];
            delete users[socket.id];
        }
    });
});

function updateRoomUsers(room) {
    const roomData = rooms[room];
    if (roomData) {
        io.to(room).emit('user list', roomData.users);
    }
}

setInterval(() => {
    Object.keys(rooms).forEach(room => {
        if (rooms[room].users.length === 0) delete rooms[room];
    });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Veilo Chat + Video działa na porcie ${PORT}`);
});
