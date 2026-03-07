FROM node:20-alpine

WORKDIR /app

# Copy manifests and prisma schema first for better layer caching
COPY package*.json ./
COPY prisma ./prisma/

# Install all deps (prisma CLI needed for generate + migrate deploy)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

COPY . .

EXPOSE 3001

# On startup: apply migrations, seed demo data, then start server
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node src/index.js"]
