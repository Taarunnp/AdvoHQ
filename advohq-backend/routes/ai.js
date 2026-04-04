'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { aiLimiter }   = require('../middleware/rateLimit');

router.use(requireAuth);
router.use(aiLimiter);

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS   = 1500;

// ── Internal Claude caller ────────────────────────────────────────────────────

async function callClaude(messages, system) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const body = { model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

// ── POST /api/ai/summarise ────────────────────────────────────────────────────
// Used by: login.html dashboard → Edit/Summarise modal AI button
router.post('/summarise', async (req, res, next) => {
  try {
    const { points, prompt } = req.body;
    if (!points?.trim() && !prompt?.trim()) {
      return res.status(400).json({ error: 'points or prompt is required' });
    }

    const content = prompt?.trim()
      ? `The user has the following case points:\n\n${(points || '').slice(0, 8000)}\n\nUser instruction: ${prompt.slice(0, 500)}\n\nRespond with the updated or summarised points only, as clean bullet points.`
      : `Summarise and expand these case points into well-structured, detailed in-depth legal points:\n\n${points.slice(0, 8000)}\n\nReturn as clean bullet points starting with •`;

    const system = [
      'You are an expert legal assistant helping Indian advocates prepare case briefs.',
      'Be precise, professional, and comprehensive.',
      'Return only the formatted bullet points — no preamble, no explanation.',
    ].join(' ');

    const text = await callClaude([{ role: 'user', content }], system);
    res.json({ text });
  } catch (err) {
    console.error('[AI/summarise]', err.message);
    res.status(502).json({ error: 'AI request failed. Please try again.' });
  }
});

// ── POST /api/ai/ask ──────────────────────────────────────────────────────────
// Used by: advohq-file.html → AI chat panel in the document viewer
router.post('/ask', async (req, res, next) => {
  try {
    const { question, context, history } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    // Build message list from conversation history (max 20 turns)
    const messages = [];
    if (Array.isArray(history)) {
      const recent = history.slice(-20);
      for (const h of recent) {
        if ((h.role === 'user' || h.role === 'assistant') && h.content) {
          messages.push({ role: h.role, content: String(h.content).slice(0, 4000) });
        }
      }
    }
    messages.push({ role: 'user', content: question.trim().slice(0, 2000) });

    const system = context?.trim()
      ? `You are an expert legal AI assistant for AdvoHQ.\n\nDocument context:\n${context.slice(0, 4000)}\n\nAnswer the user's questions about this document professionally and accurately.`
      : 'You are an expert legal AI assistant for AdvoHQ. Help advocates with their legal questions professionally and accurately.';

    const text = await callClaude(messages, system);
    res.json({ text });
  } catch (err) {
    console.error('[AI/ask]', err.message);
    res.status(502).json({ error: 'AI request failed. Please try again.' });
  }
});

module.exports = router;
