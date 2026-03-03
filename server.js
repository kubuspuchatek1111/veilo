const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 

// ==========================================
// VEILO REST API
// ==========================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'online', uptime: Math.floor(process.uptime()) + 's' });
});

app.get('/api/stats', (req, res) => {
    const allUsers = Object.values(users);
    const rooms = [...new Set(allUsers.map(u => u.room))];
    res.json({ online: allUsers.length, active_rooms: rooms.length });
});

// ==========================================
// SOCKET.IO LOGIC
// ==========================================

io.on('connection', (socket) => {
    socket.on('join', ({ nickname, room }) => {
        socket.join(room);
        users[socket.id] = { nickname, room };
        
        socket.to(room).emit('user joined', nickname);
        updateRoomUsers(room);
    });

    socket.on('chat message', (msg) => {
        // msg zawiera zaszyfrowany 'text' - serwer go nie dotyka
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
            socket.to(user.room).emit('user left', user.nickname);
            const r = user.room;
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
server.listen(PORT, () => console.log(`Veilo API & Chat running on port ${PORT}`));
