const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 

// ==========================================
// VEILO API
// ==========================================

// Status i statystyki
app.get('/api/stats', (req, res) => {
    const allUsers = Object.values(users);
    const rooms = [...new Set(allUsers.map(u => u.room))];
    res.json({ 
        online: allUsers.length, 
        rooms: rooms.length,
        status: "operational" 
    });
});

// Server-side Key Gen (opcjonalne, dla botów)
app.post('/api/keygen', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "No password" });
    const salt = new Date().toISOString().split('T')[0];
    crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, key) => {
        res.json({ key: key.toString('hex') });
    });
});

// ==========================================
// SOCKET.IO
// ==========================================

io.on('connection', (socket) => {
    socket.on('join', ({ nickname, room }) => {
        socket.join(room);
        users[socket.id] = { nickname, room };
        socket.to(room).emit('user joined', nickname);
        updateRoomUsers(room);
    });

    socket.on('chat message', (msg) => {
        io.to(msg.room).emit('chat message', msg);
    });

    socket.on('typing', (nick) => {
        const user = users[socket.id];
        if (user) socket.to(user.room).emit('typing', nick);
    });

    socket.on('stop typing', (nick) => {
        const user = users[socket.id];
        if (user) socket.to(user.room).emit('stop typing', nick);
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const r = user.room;
            socket.to(r).emit('user left', user.nickname);
            delete users[socket.id];
            updateRoomUsers(r);
        }
    });

    function updateRoomUsers(room) {
        const list = Object.values(users)
            .filter(u => u.room === room)
            .map(u => u.nickname);
        io.to(room).emit('user list', list);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Veilo Core on port ${PORT}`));
