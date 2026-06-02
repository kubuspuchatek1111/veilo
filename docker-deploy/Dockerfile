# Używamy lekkiego obrazu bazowego Node.js 20 na Alpine Linux
FROM node:20-alpine

# Ustawiamy katalog roboczy wewnątrz kontenera
WORKDIR /app

# Kopiujemy plik package.json, aby zainstalować zależności
COPY package.json ./

# Instalujemy tylko zależności produkcyjne (bez devDependencies)
RUN npm install --omit=dev

# Kopiujemy resztę kodu aplikacji oraz pliki statyczne
COPY server.js ./
COPY public/ ./public/

# Aplikacja działa domyślnie na porcie 3000
EXPOSE 3000

# Definiujemy zmienną środowiskową portu
ENV PORT=3000

# Komenda startowa uruchamiająca serwer
CMD ["node", "server.js"]
