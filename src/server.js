import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import stremioRouter from './routes/stremio.js';
import apiRouter from './routes/api.js';
import { handleHlsProxy, handleTsProxy } from './services/hlsProxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy headers (crucial for Docker, Tailscale, Caddy, Nginx and HTTPS)
app.set('trust proxy', true);

// Enable CORS and Private Network Access (for Stremio Web on https://web.stremio.com)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(cors());

// Serve static assets from public/
app.use(express.static(path.join(__dirname, '../public')));

// Transparent HLS Stream Proxy
app.get('/proxy/hls', handleHlsProxy);
app.get('/proxy/ts', handleTsProxy);

// Web API Helper routes
app.use('/api', apiRouter);

// Stremio Addon Protocol Routes
app.use('/', stremioRouter);

// App and Configure UI routes
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configure.html'));
});

app.get(['/', '/app', '/watch'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start listening
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`🚀 NTVio Stremio Addon is running!`);
  console.log(`🌐 Configuration Web UI : http://localhost:${CONFIG.PORT}/configure`);
  console.log(`📦 Stremio Manifest     : http://localhost:${CONFIG.PORT}/manifest.json`);
  console.log(`⚡ Quick Install URL    : stremio://localhost:${CONFIG.PORT}/manifest.json`);
  console.log('====================================================');
});
