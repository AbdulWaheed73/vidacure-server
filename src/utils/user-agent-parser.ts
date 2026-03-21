/**
 * Lightweight user-agent parser — produces short summaries like "iPhone/Safari 17"
 * instead of storing the full 300+ char UA string in audit logs.
 */
export function parseUserAgent(ua: string | undefined): string {
  if (!ua || ua === 'unknown') return 'unknown';

  // 1. Our own app
  if (/Vidacure-App|Expo/i.test(ua)) return 'VidacureApp/Expo';

  // Helper: extract first version number segment (e.g. "17" from "17.4.1")
  const ver = (match: RegExpMatchArray | null): string =>
    match ? match[1].split('.')[0] : '';

  // 2. iOS devices
  if (/iPhone|iPad|iPod/i.test(ua)) {
    if (/CriOS/.test(ua)) return `iPhone/Chrome ${ver(ua.match(/CriOS\/(\S+)/))}`.trim();
    if (/FxiOS/.test(ua)) return `iPhone/Firefox ${ver(ua.match(/FxiOS\/(\S+)/))}`.trim();
    if (/Safari/.test(ua)) return `iPhone/Safari ${ver(ua.match(/Version\/(\S+)/))}`.trim();
    return 'iPhone/Other';
  }

  // 3. Android
  if (/Android/i.test(ua)) {
    if (/Chrome/.test(ua)) return `Android/Chrome ${ver(ua.match(/Chrome\/(\S+)/))}`.trim();
    if (/Firefox/.test(ua)) return `Android/Firefox ${ver(ua.match(/Firefox\/(\S+)/))}`.trim();
    return 'Android/Other';
  }

  // 4. Desktop browsers (order matters — Edge before Chrome)
  const os = /Windows/i.test(ua) ? 'Win' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Desktop';

  if (/Edg\//.test(ua)) return `${os}/Edge ${ver(ua.match(/Edg\/(\S+)/))}`.trim();
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return `${os}/Chrome ${ver(ua.match(/Chrome\/(\S+)/))}`.trim();
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return `${os}/Safari ${ver(ua.match(/Version\/(\S+)/))}`.trim();
  if (/Firefox\//.test(ua)) return `${os}/Firefox ${ver(ua.match(/Firefox\/(\S+)/))}`.trim();

  // 5. Bots / crawlers
  if (/bot|crawl|spider/i.test(ua)) return 'Bot';

  // 6. Fallback — first 50 chars
  return ua.slice(0, 50);
}
