FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
