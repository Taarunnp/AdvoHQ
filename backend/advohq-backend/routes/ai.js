// routes/ai.js — Proxy to Anthropic API (keeps your key server-side)
const router      = require('express').Router();
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// POST /api/ai/ask
router.post('/ask', async (req, res) => {
  const { prompt, system } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system:     system || 'You are AdvoAI, a helpful legal assistant inside AdvoHQ. Be concise and professional.',
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

module.exports = router;
