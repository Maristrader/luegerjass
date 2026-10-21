# Für Hoster, die Docker-Images ausführen (Fly.io, Koyeb, Railway, eigener Server …)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
