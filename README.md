# 🛡️ Veilo - Secure E2EE Chat & API

Veilo to lekka aplikacja czatu stawiająca na prywatność, wykorzystująca szyfrowanie **End-to-End (E2EE)** oraz unikalną izolację pokojów opartą na hashowaniu. Dzięki wbudowanemu **REST API**, administratorzy mogą monitorować serwer i wysyłać komunikaty systemowe.
Status api pod: veilo.onrender.com/api/stats lub /api/health




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
## 🔆Nowości w wersji 3.0 (Najnowsza wersja)
- **Design** Dodałem nowoczesny oraz ładny design

## 🔐 Bezpieczeństwo
* **Szyfrowanie AES**: Wszystkie wiadomości są szyfrowane po stronie klienta za pomocą biblioteki `CryptoJS`. Serwer nigdy nie widzi treści wiadomości w formie jawnej.
* **Izolacja SHA-256**: Identyfikator pokoju jest hashem SHA-256 hasła wejściowego. Nawet jeśli ktoś wejdzie na ten sam serwer, nie zobaczy Twojego pokoju bez znajomości identycznego hasła.
* **Brak logowania danych**: Wiadomości nie są zapisywane w bazie danych – istnieją tylko "tu i teraz" w pamięci RAM.

## 🛠️ Instalacja i uruchomienie

1. Sklonuj repozytorium:
   git clone [https://github.com/kubuspuchatek1111/veilo.git](https://github.com/kubuspuchatek1111/veilo.git)

Zainstaluj zależności:
npm install

Uruchom serwer:
node server.js

Aplikacja dostępna pod adresem: http://localhost:3000

📡 Dokumentacja API
1. Status Serwera
Zwraca informacje o obciążeniu serwera.

Endpoint: GET /api/status

Odpowiedź: {"status": "online", "usersOnline": 5, "activeRooms": 2, "uptime": 3600}

2. Broadcast (Komunikat Admina)
Wysyła jawną wiadomość systemową do wybranego pokoju.

Endpoint: POST /api/broadcast

Body (JSON):

{
  "roomHash": "pełny_64_znakowy_hash",
  "message": "Twój komunikat",
  "adminKey": "twoje_tajne_haslo"
}
📂 Struktura plików
server.js - Główny silnik Node.js (Socket.io + Express API).

public/index.html - Interfejs czatu z logiką szyfrowania.

public/admin.html - Panel sterowania dla administratora (API Control).

public/style.css - Warstwa wizualna.

""czat online pod : veilo.onrender.com""

Created with ❤️ by [Kubuś ]
