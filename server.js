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
    // 1. Pobieramy dane z żądania (w tym nasz nowy nickname)
    const { roomHash, message, adminKey, nickname } = req.body;

    // 2. TWOJE HASŁO (Zmień je tutaj na własne!)
    const SECRET_ADMIN_KEY = "veilo123";

    // 3. Sprawdzamy klucz bezpieczeństwa
    if (adminKey !== SECRET_ADMIN_KEY) {
        return res.status(403).json({ error: "Błędny klucz admina" });
    }

    // 4. Sprawdzamy, czy przesłano treść i ID pokoju
    if (!roomHash || !message) {
        return res.status(400).json({ error: "Brak pokoju lub wiadomości" });
    }

    // 5. Ustalamy nazwę nadawcy (jeśli pusta, dajemy SYSTEM)
    const senderName = nickname || "SYSTEM";

    // 6. Wysyłamy wiadomość przez Socket.io do konkretnego pokoju
    io.to(roomHash).emit('chat message', {
        user: senderName,
        text: message,
        isSystem: true // Dzięki tej fladze klient nie będzie próbował odszyfrować tej wiadomości
    });

    // 7. Logujemy akcję w konsoli serwera i wysyłamy odpowiedź do nadawcy API
    console.log(`[API] Komunikat wysłany jako ${senderName} do pokoju ${roomHash}`);
    res.json({ 
        success: true, 
        sentAs: senderName 
    });
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
