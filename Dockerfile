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
  CMD node -e "fetch('http://127.0.0.1:7000/manifest.json').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start command
CMD ["node", "src/server.js"]
