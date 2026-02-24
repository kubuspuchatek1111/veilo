const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Baza danych w pamięci (ulotna)
const users = {}; // { socketId: { nickname, room } }

// ==========================================
// WARSTWA REST API
// ==========================================

// Statystyki serwera
app.get('/api/status', (req, res) => {
    const totalUsers = Object.keys(users).length;
    const uniqueRooms = new Set(Object.values(users).map(u => u.room)).size;
    res.json({
        status: 'online',
        usersOnline: totalUsers,
        activeRooms: uniqueRooms,
        uptime: Math.floor(process.uptime())
    });
});

// Sprawdzanie czy pokój jest pusty
app.get('/api/room-check/:roomHash', (req, res) => {
    const hash = req.params.roomHash;
    const count = Object.values(users).filter(u => u.room === hash).length;
    res.json({ count });
});

// ==========================================
// WARSTWA SOCKET.IO (Real-time)
// ==========================================

io.on('connection', (socket) => {
    socket.on('join', ({ nickname, room }) => {
        socket.join(room);
        users[socket.id] = { nickname, room };

        // Powiadomienie innych w pokoju
        socket.to(room).emit('user joined', nickname);
        
        // Aktualizacja listy osób w danym pokoju
        updateRoomUsers(room);
    });

    socket.on('chat message', (msg) => {
        // Wysyłka tylko do konkretnego pokoju
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
            const { nickname, room } = user;
            socket.to(room).emit('user left', nickname);
            delete users[socket.id];
            updateRoomUsers(room);
        }
    });

    function updateRoomUsers(room) {
        const roomUsers = Object.values(users)
            .filter(u => u.room === room)
            .map(u => u.nickname);
        io.to(room).emit('user list', roomUsers);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Veilo Server biega na porcie ${PORT}`);
});
