require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Unified Chat Streaming Endpoint ────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages, apiKey, temperature, maxTokens, systemPrompt, thinkingLevel } = req.body;

  if (!provider || !model || !messages) {
    return res.status(400).json({ error: 'Missing required fields: provider, model, messages' });
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
    if (provider === 'google') {
      await streamGemini(res, resolvedKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel);
    } else if (provider === 'groq') {
      await streamGroq(res, resolvedKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel);
    } else if (provider === 'siliconflow') {
      await streamSiliconFlow(res, resolvedKey, model, messages, temperature, maxTokens, systemPrompt, thinkingLevel);
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
