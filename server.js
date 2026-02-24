// --- ADMIN API: Wysyłanie wiadomości do konkretnego pokoju przez link ---
// Przykład użycia: POST pod /api/broadcast
app.post('/api/broadcast', (req, res) => {
    const { roomHash, message, adminKey } = req.body;

    // Proste zabezpieczenie, żeby byle kto nie spamował
    if (adminKey !== "TWOJE_TAJNE_HASLO_ADMINA") {
        return res.status(403).json({ error: "Brak dostępu" });
    }

    if (!roomHash || !message) {
        return res.status(400).json({ error: "Brak pokoju lub treści" });
    }

    // Wysyłamy wiadomość systemową do wybranego pokoju
    io.to(roomHash).emit('chat message', {
        user: "SYSTEM",
        text: message, // Uwaga: ta wiadomość nie będzie szyfrowana, chyba że wyślesz już zaszyfrowany tekst
        room: roomHash
    });

    console.log(`[API BROADCAST] Wiadomość wysłana do ${roomHash}`);
    res.json({ success: true, target: roomHash });
});
