/** Shared validation: never send a local object URL or a preview page as media. */
export function validateVideoUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        !host.includes('.') || host.includes(':') || host.endsWith('.local') ||
        host.endsWith('.localhost') || host.endsWith('.internal') ||
        /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return 'Eine öffentliche HTTPS-Adresse ohne Login ist erforderlich (kein blob:, localhost oder privates Netz).';
    }
    if (['drive.google.com', 'www.dropbox.com', 'youtube.com', 'www.youtube.com', 'youtu.be', 'tiktok.com', 'www.tiktok.com'].includes(host)) {
      return 'Bitte einen direkten Video-Link verwenden, keine Freigabe- oder Social-Media-Seite.';
    }
    if ([...url.searchParams.keys()].some(k => /^(x-amz-|x-goog-|expires$|signature$|token$)/i.test(k))) {
      return 'Bitte einen dauerhaften Link ohne ablaufende Signatur verwenden.';
    }
    return '';
  } catch {
    return 'Bitte die öffentliche HTTPS-Adresse des fertigen Videos eintragen.';
  }
}

export const DEFAULT_DESCRIPTION = `You won't believe how this story ends...

Stay until the end because the plot twist is INSANE.

Would you have done the same?

#reddit #redditstories #storytime

#stories #fyp`;

export function buildPostInput(post) {
  const error = validateVideoUrl(post.videoUrl);
  if (error) throw new Error(error);
  if (!['tiktok', 'instagram', 'youtube'].includes(post.platform)) throw new Error('Ungültige Plattform.');
  if (typeof post.channelId !== 'string' || !post.channelId.trim()) throw new Error('Buffer-Kanal-ID fehlt.');
  if (!['queue', 'now', 'auto', 'custom'].includes(post.mode)) throw new Error('Ungültiger Versandmodus.');
  if (typeof post.description !== 'string' || post.description.length > 10000) throw new Error('Ungültige Beschreibung.');
  const scheduled = ['auto', 'custom'].includes(post.mode);
  if (scheduled && (!Number.isFinite(Date.parse(post.scheduledAt)) || Date.parse(post.scheduledAt) <= Date.now())) {
    throw new Error('Der geplante Zeitpunkt muss in der Zukunft liegen.');
  }
  const metadata = post.platform === 'instagram'
    ? { instagram: { type: 'reel', shouldShareToFeed: true } }
    : post.platform === 'youtube'
      ? { youtube: { title: String(post.title || 'Storytime').slice(0, 100), categoryId: '24', privacy: 'public', madeForKids: false } }
      : undefined;
  return {
    channelId: post.channelId.trim(),
    text: post.description,
    schedulingType: 'automatic',
    mode: post.mode === 'now' ? 'shareNow' : scheduled ? 'customScheduled' : 'addToQueue',
    needsApproval: false,
    ...(scheduled ? { dueAt: post.scheduledAt } : {}),
    assets: [{ video: { url: post.videoUrl.trim() } }],
    ...(metadata ? { metadata } : {}),
  };
}
