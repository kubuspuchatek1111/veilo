const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; // Przechowalnia: { socketId: { nickname, room } }

io.on('connection', (socket) => {
    console.log('--- Nowy użytkownik podłączony:', socket.id);

    socket.on('join', ({ nickname, room }) => {
        socket.join(room); // DOŁĄCZANIE DO POKOJU
        users[socket.id] = { nickname, room };
        
        console.log(`[JOIN] ${nickname} wszedł do pokoju: ${room}`);

        socket.to(room).emit('user joined', nickname);
        
        // Aktualizacja listy tylko dla osób w tym samym pokoju
        const roomUsers = Object.values(users)
            .filter(u => u.room === room)
            .map(u => u.nickname);
        io.to(room).emit('user list', roomUsers);
    });

    socket.on('chat message', (msg) => {
        console.log(`[MSG] Wiadomość w pokoju ${msg.room} od ${msg.user}`);
        // KLUCZ: Wysyłamy TYLKO do osób w tym samym pokoju (io.to)
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
            
            const roomUsers = Object.values(users)
                .filter(u => u.room === room)
                .map(u => u.nickname);
            io.to(room).emit('user list', roomUsers);
            console.log(`[EXIT] ${nickname} opuścił pokój.`);
        }
    });
});

server.listen(3000, () => console.log('Serwer biega na http://localhost:3000'));
