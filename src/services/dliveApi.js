import { CONFIG } from '../config.js';
import { generateChannelPoster, generateMatchPoster } from './ntvApi.js';
import { getActiveMirror } from './mirrorManager.js';

let dliveChannelsCache = {
  data: [],
  lastFetched: 0
};

let dliveScheduleCache = {
  data: [],
  lastFetched: 0
};

const DLIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and parse 24/7 channels from dlive
 */
export async function getDliveChannels() {
  const now = Date.now();
  if (dliveChannelsCache.data.length && (now - dliveChannelsCache.lastFetched) < DLIVE_CACHE_TTL) {
    return dliveChannelsCache.data;
  }

  const dliveBase = getActiveMirror('dlive');

  try {
    const res = await fetch(`${dliveBase}/24-7-channels.php`, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': `${dliveBase}/`
      }
    });

    if (!res.ok) {
      return dliveChannelsCache.data;
    }

    const html = await res.text();
    const channels = [];
    const cardRegex = /<a[^>]+href=["']\/(?:watch\.php\?id=|stream\/stream-)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = cardRegex.exec(html)) !== null) {
      const id = m[1];
      const rawText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const cleanName = decodeHtmlEntities(rawText.replace(/ID:\s*\d+/gi, '').trim());

      if (!id || !cleanName) continue;

      const detectedCountry = detectCountryFromName(cleanName);

      channels.push({
        id: `ntv-dlive-${id}`,
        rawId: id,
        server: 'dlive',
        name: cleanName,
        country: detectedCountry,
        url: `https://dlive.sx/stream/stream-${id}.php`,
        poster: generateChannelPoster(cleanName, detectedCountry),
        type: 'tv'
      });
    }

    dliveChannelsCache.data = channels;
    dliveChannelsCache.lastFetched = now;
    console.log(`[dliveApi] Fetched ${channels.length} 24/7 channels from dlive.sx.`);
    return channels;
  } catch (e) {
    console.error('[dliveApi] Error fetching 24/7 channels from dlive.sx:', e.message);
    return dliveChannelsCache.data;
  }
}

/**
 * Fetch and parse the live schedule from https://dlive.sx/
 */
export async function getDliveSchedule() {
  const now = Date.now();
  if (dliveScheduleCache.data.length && (now - dliveScheduleCache.lastFetched) < DLIVE_CACHE_TTL) {
    return dliveScheduleCache.data;
  }

  const dliveBase = getActiveMirror('dlive');

  try {
    const res = await fetch(`${dliveBase}/`, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': `${dliveBase}/`
      }
    });

    if (!res.ok) {
      return dliveScheduleCache.data;
    }

    const html = await res.text();
    const events = [];
    const eventBlocks = html.split('<div class="schedule__event">').slice(1);

    for (let i = 0; i < eventBlocks.length; i++) {
      const block = eventBlocks[i];

      // Extract time
      const timeMatch = block.match(/class=["']schedule__time["'][^>]*data-time=["']([^"']+)["']/i) ||
                        block.match(/class=["']schedule__time["'][^>]*>([^<]+)<\/span>/i);
      const time = timeMatch ? timeMatch[1].trim() : '';

      // Extract title
      const titleMatch = block.match(/class=["']schedule__eventTitle["'][^>]*>([\s\S]*?)<\/span>/i);
      let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!title) continue;

      // Clean title
      title = decodeHtmlEntities(title);

      // Extract all channel sources
      const sources = [];
      const chRegex = /<a[^>]+href=["']\/(?:watch\.php\?id=|stream\/stream-)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
      let cm;
      while ((cm = chRegex.exec(block)) !== null) {
        sources.push({
          source: 'dlive',
          id: `dlive-${cm[1]}`,
          channelId: cm[1],
          channelName: decodeHtmlEntities(cm[2].replace(/<[^>]+>/g, '').trim()),
          server: 'dlive',
          url: `${dliveBase}/stream/stream-${cm[1]}.php`
        });
      }

      if (!sources.length) continue;

      const eventId = `ntv-dlive-match-${i}-${sources[0].channelId}`;
      const isLive = block.includes('live-pulse') || block.includes('EN DIRECT') || time.includes(':');

      events.push({
        id: eventId,
        rawId: String(i),
        server: 'dlive',
        title,
        category: 'Sports & Live',
        time,
        date: Date.now(),
        live: true, // events currently on schedule are active/live today
        poster: generateMatchPoster(title, 'DLive Sports'),
        sources,
        type: 'tv'
      });
    }

    dliveScheduleCache.data = events;
    dliveScheduleCache.lastFetched = now;
    console.log(`[dliveApi] Fetched ${events.length} schedule events from dlive.sx.`);
    return events;
  } catch (e) {
    console.error('[dliveApi] Error fetching schedule from dlive.sx:', e.message);
    return dliveScheduleCache.data;
  }
}

/**
 * Intelligent country detection from channel name
 */
export function detectCountryFromName(name) {
  const n = (name || '').toUpperCase();

  if (/\b(FR|FRANCE|CANAL|TF1|M6|W9|TMC|RMC|BEIN.*FR|TELEFOOT|EUROSPORT.*FR|EQUIPE|NOUVELLE|FRANCE\s*\d|AUTOMOTO)\b/.test(n)) return 'FR';
  if (/\b(US|USA|NBC|CBS|ABC|ESPN|FOX|HBO|SHOWTIME|TNT|TBS|USA NETWORK|CW|DISCOVERY|PARAMOUNT|MSNBC|CNN|HALLMARK|BRAVO|STARZ|CINEMAX|AMERICA|ACC|SEC|BIG TEN)\b/.test(n)) return 'US';
  if (/\b(UK|GB|BRITISH|BBC|ITV|SKY.*SPORTS|TNT.*SPORTS|CHANNEL 4|CHANNEL 5|PREMIER SPORTS|STV)\b/.test(n)) return 'UK';
  if (/\b(ES|SPAIN|MOVISTAR|LALIGA|DAZN.*ES|TELECINCO|ANTENA 3|GOL PLAY|CUATRO|LA SEXTA|TVE|TELEDEPORTE)\b/.test(n)) return 'ES';
  if (/\b(PT|PORTUGAL|SPORT TV|SIC|TVI|RTP|ELEVEN.*PT|BENFICA|PORTO|CANAL 11)\b/.test(n)) return 'PT';
  if (/\b(IT|ITALY|ITALIA|RAI|MEDIASET|SKY.*SPORT.*IT|DAZN.*IT|SUPER TENNIS|SPORTITALIA|CANALE 5|ITALIA 1)\b/.test(n)) return 'IT';
  if (/\b(DE|GERMANY|ARD|ZDF|PROSIEBEN|SKY.*SPORT.*DE|DAZN.*DE|SPORT1|RTL|SAT\.1|VOX|KABEL)\b/.test(n)) return 'DE';
  if (/\b(AR|ARABIC|MBC|AL JAZEERA|ROTANA|DUBAI|ABU DHABI|BEIN.*AR|SSC|AL KASS|ONTIME)\b/.test(n)) return 'AR';
  if (/\b(NL|NETHERLANDS|ZIGGO|NOS|RTL.*NL|ESPN.*NL|VIAPLAY.*NL|NPO)\b/.test(n)) return 'NL';
  if (/\b(BE|BELGIUM|RTBF|TIPIK|LA UNE|RTL-TVI|CLUB RTL|PLUG RTL|VOOSPORT|ELEVEN.*BE)\b/.test(n)) return 'BE';
  if (/\b(CH|SWITZERLAND|RTS|SRF|RSI|BLUE SPORT)\b/.test(n)) return 'CH';
  if (/\b(BR|BRAZIL|GLOBO|SPORTV|PREMIERE|BANDSPORTS|ESPN.*BR|RECORD|SBT)\b/.test(n)) return 'BR';
  if (/\b(CA|CANADA|TSN|SPORTSNET|CBC|CTV|TVA|RDS)\b/.test(n)) return 'CA';
  if (/\b(TR|TURKEY|TRT|BEIN.*TR|EXXEN|S SPORT|A SPOR|ATV|TIVIBU)\b/.test(n)) return 'TR';
  if (/\b(PL|POLAND|POLSAT|CANAL\+.*SPORT.*POLAND|TVP|ELEVEN.*PL)\b/.test(n)) return 'PL';
  if (/\b(RO|ROMANIA|DIGI SPORT|PRIMA SPORT|PRO TV|PRO ARENA|ANTENA 1)\b/.test(n)) return 'RO';
  if (/\b(HR|CROATIA|ARENA.*CROATIA|HRT)\b/.test(n)) return 'HR';
  if (/\b(RS|SERBIA|ARENA.*SERBIA|RTS.*SERBIA)\b/.test(n)) return 'RS';
  if (/\b(GR|GREECE|COSMOTE|NOVA SPORTS|MAGENTA.*GREECE|ERT)\b/.test(n)) return 'GR';
  if (/\b(AT|AUSTRIA|ORF|SERVUS|SKY.*SPORT.*AUSTRIA)\b/.test(n)) return 'AT';
  if (/\b(MX|MEXICO|TUDN|AZTECA|LAS ESTRELLAS|FOX SPORTS MX)\b/.test(n)) return 'MX';
  if (/\b(ARGENTINA|TYC SPORTS|ESPN.*ARGENTINA|TELEFE)\b/.test(n)) return 'AR-LATAM';

  return '';
}

export function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
