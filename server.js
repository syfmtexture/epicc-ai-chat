require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy (restrict camera, microphone, geolocation)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HSTS (enforce HTTPS for 1 year)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com https://api.siliconflow.cn https://www.googleapis.com https://accounts.google.com",
    "frame-src https://accounts.google.com"
  ].join('; '));
  next();
});

// ─── Rate Limiting (in-memory, no external dependencies) ─────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;              // 30 requests per minute per IP

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }

  const entry = rateLimitMap.get(ip);
  if (now - entry.startTime > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    entry.count = 1;
    entry.startTime = now;
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }
  next();
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.startTime > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

app.use(cors());
app.use(express.json({ limit: '1mb' })); // Reduced from 5mb for safety
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to API routes
app.use('/api/', rateLimit);

// ─── Unified Chat Streaming Endpoint ────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages, apiKey, temperature, maxTokens, systemPrompt, thinkingLevel } = req.body;

  // ── Input Validation ──────────────────────────────────────────────────
  if (!provider || !model || !messages) {
    return res.status(400).json({ error: 'Missing required fields: provider, model, messages' });
  }

  // Whitelist providers
  const ALLOWED_PROVIDERS = ['google', 'groq', 'siliconflow'];
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider.' });
  }

  // Validate model name (alphanumeric, slashes, dashes, dots, underscores only)
  if (typeof model !== 'string' || !/^[a-zA-Z0-9\/\-._]+$/.test(model)) {
    return res.status(400).json({ error: 'Invalid model name.' });
  }

  // Validate messages is an array with reasonable limits
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages must be a non-empty array.' });
  }
  if (messages.length > 200) {
    return res.status(400).json({ error: 'Too many messages in conversation (max 200).' });
  }

  // Validate each message
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Each message must have a role and content string.' });
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message role.' });
    }
    if (msg.content.length > 100000) {
      return res.status(400).json({ error: 'Message content too long (max 100,000 characters).' });
    }
  }

  // Validate optional parameters
  if (temperature !== undefined && temperature !== null) {
    const temp = Number(temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return res.status(400).json({ error: 'Temperature must be between 0 and 2.' });
    }
  }
  if (maxTokens !== undefined && maxTokens !== null) {
    const mt = Number(maxTokens);
    if (isNaN(mt) || mt < 1 || mt > 131072) {
      return res.status(400).json({ error: 'maxTokens must be between 1 and 131072.' });
    }
  }
  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.length > 10000) {
    return res.status(400).json({ error: 'System prompt too long (max 10,000 characters).' });
  }

  // Resolve API key: client-provided key takes priority over server .env
  const resolvedKey = apiKey ||
    (provider === 'google' ? process.env.GEMINI_API_KEY : null) ||
    (provider === 'groq' ? process.env.GROQ_API_KEY : null) ||
    (provider === 'siliconflow' ? process.env.SILICONFLOW_API_KEY : null);

  if (!resolvedKey) {
    return res.status(401).json({ error: `No API key provided for ${provider}. Set it in the app settings or the server .env file.` });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Inject the current date/time to prevent models from getting the date wrong
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const enhancedSystemPrompt = `Current Date: ${dateStr}\n\n` + (systemPrompt || '');

    if (provider === 'google') {
      await streamGemini(res, resolvedKey, model, messages, temperature, maxTokens, enhancedSystemPrompt, thinkingLevel);
    } else if (provider === 'groq') {
      await streamGroq(res, resolvedKey, model, messages, temperature, maxTokens, enhancedSystemPrompt, thinkingLevel);
    } else if (provider === 'siliconflow') {
      await streamSiliconFlow(res, resolvedKey, model, messages, temperature, maxTokens, enhancedSystemPrompt, thinkingLevel);
    } else {
      res.write(`data: ${JSON.stringify({ error: `Unknown provider: ${provider}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    console.error(`[${provider}] Stream error:`, err.message);
    try {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (_) { /* response already closed */ }
  }
});

// ─── Google Gemini Streaming ────────────────────────────────────────────────
async function streamGemini(res, apiKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel) {
  // Build Gemini-format contents
  const contents = [];

  for (const msg of messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }

  const body = {
    contents,
    generationConfig: {}
  };

  // Enable Google Search grounding for all Google API models (Gemini and Gemma)
  body.tools = [
    {
      googleSearch: {}
    }
  ];

  // Enable thinking config for Gemini models supporting it
  if (model.includes('gemini-3.')) {
    body.generationConfig.thinkingConfig = {
      includeThoughts: thinkingLevel !== 'low',
      thinkingLevel: thinkingLevel === 'low' ? 'MINIMAL' : 'HIGH'
    };
  } else if (model.includes('gemini-2.')) {
    body.generationConfig.thinkingConfig = {
      includeThoughts: thinkingLevel !== 'low',
      thinkingBudget: thinkingLevel === 'low' ? 0 : 2048
    };
  }

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  if (temperature !== undefined && temperature !== null) {
    body.generationConfig.temperature = temperature;
  }
  if (maxTokens) {
    body.generationConfig.maxOutputTokens = maxTokens;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const parts = parsed?.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.thought) {
                res.write(`data: ${JSON.stringify({ thought: part.text })}\n\n`);
              } else if (part.text) {
                res.write(`data: ${JSON.stringify({ content: part.text })}\n\n`);
              }
            }
          }
        } catch (_) { /* skip malformed JSON */ }
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ─── Groq Streaming (OpenAI-compatible) ─────────────────────────────────────
async function streamGroq(res, apiKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel) {
  const apiMessages = [];

  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }

  const body = {
    model,
    messages: apiMessages,
    stream: true
  };

  if (temperature !== undefined && temperature !== null) {
    body.temperature = temperature;
  }
  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const reasoning = parsed?.choices?.[0]?.delta?.reasoning_content;
          const text = parsed?.choices?.[0]?.delta?.content;
          if (reasoning) {
            res.write(`data: ${JSON.stringify({ thought: reasoning })}\n\n`);
          }
          if (text) {
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        } catch (_) { /* skip malformed JSON */ }
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ─── SiliconFlow Streaming (OpenAI-compatible) ──────────────────────────────
async function streamSiliconFlow(res, apiKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel) {
  const apiMessages = [];

  if (systemPrompt) {
    apiMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }

  const body = {
    model,
    messages: apiMessages,
    stream: true
  };

  if (temperature !== undefined && temperature !== null) {
    body.temperature = temperature;
  }
  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SiliconFlow API error (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const reasoning = parsed?.choices?.[0]?.delta?.reasoning_content;
          const text = parsed?.choices?.[0]?.delta?.content;
          if (reasoning) {
            res.write(`data: ${JSON.stringify({ thought: reasoning })}\n\n`);
          }
          if (text) {
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        } catch (_) { /* skip malformed JSON */ }
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ─── Start Server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🚀 EPICC AI Chat Server running at http://localhost:${PORT}\n`);
});
