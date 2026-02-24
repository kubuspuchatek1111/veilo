const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 

// ==========================================
// ROZBUDOWANE API (Statystyki + Sterowanie)
// ==========================================

// Pobieranie statystyk
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

// ZDALNE STEROWANIE: Wysyłanie wiadomości pod specjalny link
// Użycie: POST na /api/broadcast
app.post('/api/broadcast', (req, res) => {
    const { roomHash, message, adminKey } = req.body;

    // ZMIEŃ TO NA SWOJE HASŁO:
    const SECRET_ADMIN_KEY = "veilo123";

    if (adminKey !== SECRET_ADMIN_KEY) {
        return res.status(403).json({ error: "Błędny klucz admina" });
    }

    if (!roomHash || !message) {
        return res.status(400).json({ error: "Brak pokoju lub wiadomości" });
    }

    // Wysyłamy wiadomość do konkretnego pokoju jako "SYSTEM"
    io.to(roomHash).emit('chat message', {
        user: "SYSTEM",
        text: message,
        room: roomHash,
        isSystem: true // Flaga, żeby frontend nie próbował tego odszyfrować
    });

    console.log(`[API] Wysłano komunikat do pokoju ${roomHash}`);
    res.json({ success: true });
});

// ==========================================
// SOCKET.IO (Czat na żywo)
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
            socket.to(user.room).emit('user left', user.nickname);
            const r = user.room;
            delete users[socket.id];
            updateRoomUsers(r);
        }
    });

    function updateRoomUsers(room) {
        const list = Object.values(users).filter(u => u.room === room).map(u => u.nickname);
        io.to(room).emit('user list', list);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer Veilo gotowy na porcie ${PORT}`));
