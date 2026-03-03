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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 
const rooms = {}; // { roomHash: { password: 'haslo', users: [] } }

// API Stats
app.get('/api/stats', (req, res) => {
    const allUsers = Object.values(users);
    const roomCount = Object.keys(rooms).length;
    res.json({ 
        online: allUsers.length, 
        rooms: roomCount,
        status: "operational" 
    });
});

io.on('connection', (socket) => {
    console.log('Użytkownik połączony:', socket.id);

    socket.on('join', ({ nickname, room, password }) => {
        if (!nickname || !room || !password) {
            socket.emit('error', 'Brak wymaganych danych!');
            return;
        }

        // WALIDACJA I UTWORZENIE POKOJU
        if (!rooms[room]) {
            rooms[room] = { password: password, users: [] };
            console.log(`Nowy pokój utworzony: ${room} (hasło: ${password})`);
        } else if (rooms[room].password !== password) {
            socket.emit('error', 'Nieprawidłowe hasło pokoju!');
            return;
        }

        socket.join(room);
        users[socket.id] = { nickname, room, password };
        rooms[room].users.push(nickname);
        
        socket.to(room).emit('user joined', nickname);
        socket.emit('joined', { room, users: rooms[room].users });
        updateRoomUsers(room);
        
        console.log(`${nickname} dołączył do ${room}`);
    });

    socket.on('chat message', (msg) => {
        const user = users[socket.id];
        if (!user || !msg.room || !msg.message || msg.password !== rooms[msg.room]?.password) {
            return;
        }

        // OGRANICZENIE DŁUGOŚCI WIADOMOŚCI
        if (msg.message.length > 500) {
            socket.emit('error', 'Wiadomość za długa! Max 500 znaków.');
            return;
        }

        io.to(msg.room).emit('chat message', {
            nickname: user.nickname,
            message: msg.message.trim(),
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const room = user.room;
            socket.to(room).emit('user left', user.nickname);
            
            // Usuń użytkownika z pokoju
            const roomData = rooms[room];
            if (roomData) {
                roomData.users = roomData.users.filter(nick => nick !== user.nickname);
                if (roomData.users.length === 0) {
                    delete rooms[room]; // Usuń pusty pokój
                    console.log(`Pusty pokój usunięty: ${room}`);
                }
            }
            
            delete users[socket.id];
            updateRoomUsers(room);
            console.log(`${user.nickname} rozłączył się z ${room}`);
        }
    });

    function updateRoomUsers(room) {
        const roomData = rooms[room];
        if (roomData) {
            const list = roomData.users;
            io.to(room).emit('user list', list);
        }
    }
});

// Czyszczenie starych nieaktywnych pokojów (co 5 min)
setInterval(() => {
    const now = Date.now();
    Object.keys(rooms).forEach(room => {
        if (rooms[room].users.length === 0) {
            delete rooms[room];
        }
    });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Veilo Chat działa na porcie ${PORT}`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
});
