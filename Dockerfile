FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3000
# The index is built on first start if missing; mount /app/data to keep it between restarts.
CMD ["sh", "-c", "[ -f data/index.json ] || node src/cli/crawl.js --content; node src/server.js"]
