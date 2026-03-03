const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Ważne dla uniknięcia problemów z CORS
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
// Upewnij się, że pliki index.html i generator.html są w folderze /public
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 

// API Stats
app.get('/api/stats', (req, res) => {
    const allUsers = Object.values(users);
    const rooms = [...new Set(allUsers.map(u => u.room))];
    res.json({ 
        online: allUsers.length, 
        rooms: rooms.length,
        status: "operational" 
    });
});

// Socket.io Logic
io.on('connection', (socket) => {
    socket.on('join', ({ nickname, room }) => {
        if (!nickname || !room) return;
        socket.join(room);
        users[socket.id] = { nickname, room };
        socket.to(room).emit('user joined', nickname);
        updateRoomUsers(room);
    });

    socket.on('chat message', (msg) => {
        if (msg.room) {
            io.to(msg.room).emit('chat message', msg);
        }
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
server.listen(PORT, () => console.log(`Server Veilo działa na http://localhost:${PORT}`));
