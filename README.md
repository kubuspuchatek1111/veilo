# 🛡️ Veilo - Czat online i API

Veilo to lekka aplikacja czatu z pokojami, rozmowami audio/wideo i REST API do moderacji.
Status API: [veilo.onrender.com/api/stats](https://veilo.onrender.com/api/stats)




## 🚀 Nowości w wersji 2.1
- **Admin Broadcast API**: Możliwość zdalnego wysyłania komunikatów systemowych do konkretnych pokojów.
- **Easy-Copy Room Hash**: Nowy przycisk w UI pozwalający jednym kliknięciem skopiować pełny hash pokoju do schowka.
- **System Messaging**: Rozróżnianie wiadomości szyfrowanych od jawnych komunikatów administratora.
- **Live Stats**: Automatyczne odświeżanie statystyk serwera (użytkownicy online, aktywne pokoje) na ekranie logowania.

## 🌟 Nowości w wersji 2.2
- **Motyw**: Możliwość zmiany motywu (jasny/ciemny) w ustawieniach (domyślnie ciemny)
- **API**: Spieprzyłem XD

## 🖕 Nowości w wersji 2.3
- **API**: Naprawione 😃

## 🔆Nowości w wersji 3.0
- **Design** Dodałem nowoczesny oraz ładny design

## ❤️Nowości w wersji 3.1 (Najnowsza wersja)
- **Audio&Video** Dodałem rozmowy na żywo (Beta)

## 🔐 Bezpieczeństwo
* **Wiadomości czatu**: aktualna implementacja przesyła treść wiadomości przez Socket.IO bez szyfrowania end-to-end. Nie należy traktować jej jako bezpiecznego komunikatora.
* **Pokoje**: hasła pokoi są przechowywane w pamięci serwera. Identyfikator pokoju jest tworzony prostym, krótkim hashem i nie zastępuje mocnego hasła.
* **Moderacja**: chronione endpointy wymagają klucza `ADMIN_API_KEY`. Ustaw go jako zmienną środowiskową serwera i nie umieszczaj w kodzie przeglądarki.
* **Pamięć**: pokoje i aktywni użytkownicy są przechowywani w RAM. Wiadomości nie są zapisywane przez serwer.

## 🛠️ Instalacja i uruchomienie

Możesz uruchomić aplikację lokalnie na swoim komputerze

### 💻 1. Uruchomienie lokalne

1. **Sklonuj repozytorium:**
   ```bash
   git clone https://github.com/kubuspuchatek1111/veilo.git
   cd veilo
   ```

2. **Zainstaluj zależności:**
   ```bash
   npm install
   ```

3. **Ustaw klucz API administratora i uruchom serwer:**
   ```bash
   ADMIN_API_KEY="wstaw-tu-dlugi-losowy-klucz" node server.js
   ```

   W hostingu Render ustaw `ADMIN_API_KEY` w zmiennych środowiskowych serwisu.

Aplikacja będzie dostępna pod adresem: `http://localhost:3000`

---

## 📡 API moderacji

API administratora jest dostępne tylko wtedy, gdy na serwerze ustawiono zmienną środowiskową `ADMIN_API_KEY`. Każde żądanie do `/api/admin/*` musi zawierać nagłówek:

```http
Authorization: Bearer TWÓJ_KLUCZ_ADMINA
```

Nie wpisuj klucza do plików HTML ani aplikacji dostępnej dla użytkowników. Na Render dodaj go w ustawieniach środowiskowych serwisu.

### Endpointy

| Metoda | Endpoint | Opis |
|---|---|---|
| `GET` | `/api/admin/rooms` | Lista aktywnych pokoi i liczby użytkowników |
| `GET` | `/api/admin/rooms/:room/users` | Użytkownicy pokoju wraz z ich `socketId` i statusem wyciszenia |
| `GET` | `/api/admin/rooms/:room/bans` | Zablokowane nicki w pokoju |
| `POST` | `/api/admin/rooms/:room/kick` | Wyrzuca użytkownika z pokoju; body: `{"socketId":"..."}` |
| `POST` | `/api/admin/rooms/:room/mute` | Wycisza użytkownika; body: `{"socketId":"..."}` |
| `POST` | `/api/admin/rooms/:room/unmute` | Zdejmuje wyciszenie; body: `{"socketId":"..."}` |
| `POST` | `/api/admin/rooms/:room/ban` | Blokuje nick aktywnego użytkownika; body: `{"socketId":"..."}` |
| `POST` | `/api/admin/rooms/:room/unban` | Odblokowuje nick; body: `{"nickname":"..."}` |
| `POST` | `/api/admin/rooms/:room/broadcast` | Wysyła komunikat systemowy; body: `{"message":"..."}` |

Przykład pobrania listy pokoi:

```bash
curl https://twoj-serwer/api/admin/rooms \
  -H "Authorization: Bearer TWÓJ_KLUCZ_ADMINA"
```

`socketId` zmienia się po rozłączeniu i ponownym połączeniu użytkownika. Ban jest przypisany do nicku w danym pokoju, więc można go ominąć, zmieniając nick. Bany są przechowywane w pamięci i znikają po restarcie serwera. Czat nie ma kont użytkowników, więc trwałe bany konkretnych osób wymagają wprowadzenia kont lub stabilnych identyfikatorów.

Publiczne `GET /api/stats` zwraca bieżącą liczbę połączeń i aktywnych pokoi.

## 📂 Struktura plików

- `server.js` — serwer Node.js (Socket.IO + Express API).
- `public/index.html` — interfejs czatu.
- `public/video.html` — strona rozmowy wideo.
- `public/generator.html` — generator klucza.
- `public/style.css` — style interfejsu.

Czat online: [veilo.onrender.com](https://veilo.onrender.com)

Created with ❤️ by [Kubuś ]
