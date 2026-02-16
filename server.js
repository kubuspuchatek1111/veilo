const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serwowanie plików statycznych z folderu 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Obiekt przechowujący dane o połączonych użytkownikach
// Struktura: { socketId: { nickname: '...', room: '...' } }
const users = {};

io.on('connection', (socket) => {
    console.log(`Nowe połączenie: ${socket.id}`);

    // --- DOŁĄCZANIE DO POKOJU ---
    socket.on('join', ({ nickname, room }) => {
        // Dołączamy socket do konkretnego pokoju (hasha hasła)
        socket.join(room);
        
        // Zapisujemy dane o użytkowniku
        users[socket.id] = { nickname, room };

        console.log(`${nickname} dołączył do pokoju: ${room}`);

        // Powiadomienie innych osób w TYM SAMYM pokoju
        socket.to(room).emit('user joined', nickname);

        // Wyślij zaktualizowaną listę użytkowników TYLKO do tego pokoju
        updateUserList(room);
    });

    // --- OBSŁUGA WIADOMOŚCI ---
    socket.on('chat message', (msg) => {
        // msg zawiera: { user, text, room }
        // Wysyłamy wiadomość tylko do osób w pokoju msg.room
        io.to(msg.room).emit('chat message', msg);
    });

    // --- WSKAŹNIK PISANIA ---
    socket.on('typing', (nickname) => {
        const userData = users[socket.id];
        if (userData) {
            // Informujemy innych w pokoju, że ktoś pisze
            socket.to(userData.room).emit('typing', nickname);
        }
    });

    socket.on('stop typing', (nickname) => {
        const userData = users[socket.id];
        if (userData) {
            socket.to(userData.room).emit('stop typing', nickname);
        }
    });

    // --- ROZŁĄCZENIE ---
    socket.on('disconnect', () => {
        const userData = users[socket.id];
        
        if (userData) {
            const { nickname, room } = userData;
            
            // Informujemy pokój, że ktoś wyszedł
            socket.to(room).emit('user left', nickname);
            
            // Usuwamy użytkownika z bazy
            delete users[socket.id];
            
            // Aktualizujemy listę osób w pokoju
            updateUserList(room);
            
            console.log(`${nickname} opuścił pokój: ${room}`);
        }
    });

    // Funkcja pomocnicza do wysyłania listy użytkowników w danym pokoju
    function updateUserList(room) {
        // Filtrujemy globalny obiekt users, aby wyciągnąć tylko osoby z danego pokoju
        const roomUsers = Object.values(users)
            .filter(u => u.room === room)
            .map(u => u.nickname);

        // Wysyłamy listę do wszystkich w tym pokoju
        io.to(room).emit('user list', roomUsers);
    }
});

// Uruchomienie serwera
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n======================================`);
    console.log(`   VEILO SERVER IS RUNNING!`);
    console.log(`   Adres: http://localhost:${PORT}`);
    console.log(`======================================\n`);
});
