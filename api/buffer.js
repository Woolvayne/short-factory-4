/** Buffer GraphQL relay. No file uploads, /tmp database, API keys in the client, or simulated success. */
import { buildPostInput } from '../shared/buffer.js';
import { requirePassword } from '../shared/auth.js';
export const config = { runtime: 'nodejs', maxDuration: 60 };

class ApiError extends Error {
  constructor(message, status = 502, uncertain = false) {
    super(message); this.status = status; this.uncertain = uncertain;
  }
}

export async function graphql(query, variables = {}, mutation = false) {
  let response;
  try {
    response = await fetch('https://api.buffer.com', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiError('Buffer nicht erreichbar. Ergebnis bitte in Buffer prüfen, bevor du erneut sendest.', 502, mutation);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status === 429
      ? 'Buffer-Rate-Limit erreicht. Bitte später fortsetzen.'
      : `Buffer API HTTP ${response.status}`, response.status === 429 ? 429 : 502, mutation && response.status >= 500);
  }
  if (data?.errors?.length) throw new ApiError(data.errors.map(e => e.message).join('; '), 502, mutation);
  if (!data?.data) throw new ApiError('Ungültige Antwort von Buffer.', 502, mutation);
  return data.data;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // This is a private operator app: deploy behind access protection (see README).
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requirePassword(req, res)) return;
  const hasApiKey = Boolean(process.env.BUFFER_API_KEY?.trim());
  if (req.method === 'GET') return res.status(200).json({ hasApiKey });
  if (!hasApiKey) return res.status(503).json({ error: 'BUFFER_API_KEY fehlt auf dem Server. Es wurde nichts gesendet.', uncertain: false });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') throw new ApiError('Ungültige Anfrage.', 400);
    if (body.action === 'channels') {
      const { account } = await graphql('query { account { organizations { id name } } }');
      const channels = [];
      for (const org of account.organizations) {
        const data = await graphql('query($input: ChannelsInput!) { channels(input: $input) { id name displayName service isQueuePaused } }', { input: { organizationId: org.id } });
        channels.push(...data.channels.map(channel => ({ ...channel, organizationName: org.name })));
      }
      return res.status(200).json({ channels });
    }
    if (body.action === 'create') {
      let input;
      try { input = buildPostInput(body.post || {}); }
      catch (e) { throw new ApiError(e.message, 400); }
      const data = await graphql(`mutation($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id text dueAt status channelId } }
          ... on MutationError { message }
        }
      }`, { input }, true);
      const result = data.createPost;
      if (result?.message) throw new ApiError(result.message, 422);
      if (!result?.post?.id) throw new ApiError('Buffer hat keine Post-ID bestätigt. Bitte in Buffer prüfen.', 502, true);
      return res.status(200).json({ post: result.post });
    }
    if (body.action === 'status') {
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => typeof id !== 'string' || !id)) throw new ApiError('Ungültige Post-IDs (max. 40).', 400);
      if (!ids.length) return res.status(200).json({ posts: [] });
      const data = await graphql(`query { ${ids.map((id, i) => `p${i}: post(input: { id: ${JSON.stringify(id)} }) { id dueAt status }`).join('\n')} }`);
      return res.status(200).json({ posts: Object.values(data) });
    }
    if (body.action === 'delete') {
      if (typeof body.id !== 'string' || !body.id) throw new ApiError('Post-ID fehlt.', 400);
      const data = await graphql(`mutation($input: DeletePostInput!) {
        deletePost(input: $input) { __typename ... on VoidMutationError { message } }
      }`, { input: { id: body.id } }, true);
      if (data.deletePost?.__typename !== 'DeletePostSuccess') throw new ApiError(data.deletePost?.message || 'Buffer hat die Löschung nicht bestätigt.', 422);
      return res.status(200).json({ ok: true });
    }
    throw new ApiError('Unbekannte Aktion.', 400);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'Buffer-Anfrage fehlgeschlagen.', uncertain: e.uncertain ?? false });
  }
}
