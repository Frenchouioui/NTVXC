FROM node:20-alpine

# Working directory
WORKDIR /app

# Install production dependencies with caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --production

# Copy application code
COPY . .

# Environment
ENV PORT=7000
ENV NODE_ENV=production

# Use non-root node user for security
USER node

# Expose port
EXPOSE 7000

# Healthcheck to verify the server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:7000/manifest.json || exit 1

# Start command
CMD ["node", "src/server.js"]
