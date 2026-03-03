const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Podstawowe ustawienia
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 

// ==========================================
// SOCKET.IO (Pełna funkcjonalność czatu)
// ==========================================

io.on('connection', (socket) => {
    // Logika dołączania do pokoju
    socket.on('join', ({ nickname, room }) => {
        socket.join(room);
        users[socket.id] = { nickname, room };
        
        // Powiadomienie innych, że ktoś wszedł
        socket.to(room).emit('user joined', nickname);
        
        // Aktualizacja listy osób w pokoju
        updateRoomUsers(room);
    });

    // Przesyłanie wiadomości
    socket.on('chat message', (msg) => {
        io.to(msg.room).emit('chat message', msg);
    });

    // Powiadomienie "użytkownik pisze..."
    socket.on('typing', (nick) => {
        const user = users[socket.id];
        if (user) socket.to(user.room).emit('typing', nick);
    });

    // Zatrzymanie powiadomienia o pisaniu
    socket.on('stop typing', (nick) => {
        const user = users[socket.id];
        if (user) socket.to(user.room).emit('stop typing', nick);
    });

    // Logika rozłączenia
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            socket.to(user.room).emit('user left', user.nickname);
            const r = user.room;
            delete users[socket.id];
            updateRoomUsers(r);
        }
    });

    // Funkcja pomocnicza do listy użytkowników
    function updateRoomUsers(room) {
        const list = Object.values(users)
            .filter(u => u.room === room)
            .map(u => u.nickname);
        io.to(room).emit('user list', list);
    }
});

// Ustawienie portu pod Render.com
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer Veilo gotowy na porcie ${PORT}`));
