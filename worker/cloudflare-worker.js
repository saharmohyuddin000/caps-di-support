// CAPS DI Support — Cloudflare Worker proxy for the Gemini API.
//
// The Gemini key lives ONLY here, as a Cloudflare secret named GEMINI_API_KEY.
// It must never appear in index.html, because that file is public on GitHub.
//
// Optional Worker variable: GEMINI_MODEL (defaults to gemini-3.5-flash-lite).
// Change it in Cloudflare → Settings → Variables if Google retires the model,
// with no code edit needed.

const ALLOWED_ORIGINS = [
  'https://saharmohyuddin000.github.io',
];

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Quick health check: open the Worker URL in a browser to see this.
    if (request.method === 'GET') {
      return json({
        ok: true,
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        keyConfigured: Boolean(env.GEMINI_API_KEY),
      }, 200, origin);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    // Only the CAPS DI Support demo may use this Worker (stops others spending your credit).
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Origin not allowed: ' + origin }, 403, origin);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'GEMINI_API_KEY secret is not set on the Worker.' }, 500, origin);
    }

    let prompt;
    try {
      const body = await request.json();
      prompt = typeof body.prompt === 'string' ? body.prompt : '';
    } catch {
      return json({ error: 'Request body must be JSON with a "prompt" field.' }, 400, origin);
    }
    if (!prompt || prompt.length > 20000) {
      return json({ error: 'Prompt is missing or too long.' }, 400, origin);
    }

    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent';

    let gRes, gData;
    try {
      gRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      });
      gData = await gRes.json();
    } catch (e) {
      return json({ error: 'Could not reach Gemini: ' + e.message }, 502, origin);
    }

    if (!gRes.ok) {
      const msg = gData?.error?.message || ('Gemini returned status ' + gRes.status);
      console.log('Gemini error', gRes.status, msg);
      return json({ error: msg, geminiStatus: gRes.status, model }, 502, origin);
    }

    const candidate = gData?.candidates?.[0];
    const text = (candidate?.content?.parts || [])
      .filter(p => typeof p.text === 'string' && !p.thought)
      .map(p => p.text)
      .join('');

    if (!text) {
      const reason = candidate?.finishReason || gData?.promptFeedback?.blockReason || 'empty response';
      return json({ error: 'Gemini returned no text (' + reason + ').', model }, 502, origin);
    }

    return json({ text, model, finishReason: candidate?.finishReason || null }, 200, origin);
  },
};
