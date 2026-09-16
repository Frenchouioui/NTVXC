export const CONFIG = {
  PORT: process.env.PORT || 7000,
  NTV_BASE_URL: process.env.NTV_BASE_URL || 'https://ntv.cx',
  CHANNELS_CACHE_TTL_MS: 30 * 60 * 1000, // 30 minutes
  MATCHES_CACHE_TTL_MS: 2 * 60 * 1000,   // 2 minutes
  MATCH_SERVERS: ['titan', 'falcon', 'phoenix', 'kobra', 'raptor', 'dlive'],
  ADDON_NAME: 'NTVio',
  ADDON_ID: 'community.ntvio.live',
  ADDON_VERSION: '1.0.0',
  ADDON_DESCRIPTION: 'Plus de 10 000 chaînes 24/7 et matchs de sport en direct (NTV.cx & DLive.sx)',
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  POPULAR_COUNTRIES: [
    { code: 'fr', name: 'France', flag: '🇫🇷' },
    { code: 'us', name: 'United States', flag: '🇺🇸' },
    { code: 'uk', name: 'United Kingdom', flag: '🇬🇧' },
    { code: 'es', name: 'Spain', flag: '🇪🇸' },
    { code: 'pt', name: 'Portugal', flag: '🇵🇹' },
    { code: 'it', name: 'Italy', flag: '🇮🇹' },
    { code: 'de', name: 'Germany', flag: '🇩🇪' },
    { code: 'ar', name: 'Arabic / MENA', flag: '🇸🇦' },
    { code: 'nl', name: 'Netherlands', flag: '🇳🇱' },
    { code: 'be', name: 'Belgium', flag: '🇧🇪' },
    { code: 'ch', name: 'Switzerland', flag: '🇨🇭' },
    { code: 'br', name: 'Brazil', flag: '🇧🇷' },
    { code: 'ca', name: 'Canada', flag: '🇨🇦' },
    { code: 'tr', name: 'Turkey', flag: '🇹🇷' },
    { code: 'pl', name: 'Poland', flag: '🇵🇱' },
    { code: 'ro', name: 'Romania', flag: '🇷🇴' },
    { code: 'hr', name: 'Croatia', flag: '🇭🇷' },
    { code: 'rs', name: 'Serbia', flag: '🇷🇸' },
    { code: 'gr', name: 'Greece', flag: '🇬🇷' },
    { code: 'at', name: 'Austria', flag: '🇦🇹' },
    { code: 'mx', name: 'Mexico', flag: '🇲🇽' }
  ]
};
