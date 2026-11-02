'use strict';

const { fetchWithTimeout } = require('./util');

const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '国内可直连，中文长文表现稳定。'
  },
  moonshot: {
    label: 'Moonshot 月之暗面',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '中文语感细腻，长上下文。'
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '需要可访问 OpenAI 的网络环境。'
  },
  ollama: {
    label: 'Ollama（本地）',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    keyUrl: '',
    note: '本地模型，先运行 `ollama serve`。API Key 填任意非空值即可。'
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseURL: '',
    model: '',
    keyUrl: '',
    note: '任何兼容 /chat/completions 的服务。'
  }
};

function normalizeBaseURL(raw) {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  base = base.replace(/\/chat\/completions$/i, '');
  return base;
}

function friendlyError(err, status, body) {
  const text = String(body || '').slice(0, 400);
  if (status === 401 || status === 403) {
    return `API Key 无效或没有权限（HTTP ${status}）。请到「设定」里重新填写。`;
  }
  if (status === 404) {
    return `接口地址或模型名不对（HTTP 404）。检查 Base URL 是否带 /v1，模型名是否存在。`;
  }
  if (status === 429) {
    return `请求太频繁或额度用完了（HTTP 429）。稍等一会儿，或换一个服务商。`;
  }
  if (status >= 500) {
    return `服务端出错了（HTTP ${status}）。多半是临时的，过一会儿再试。`;
  }
  if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
    return '请求超时了。长文生成可能需要更久，可以调低字数或换更快的模型。';
  }
  if (err && /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(String(err.message))) {
    return '连不上服务。检查网络、Base URL，以及本地模型是否已经启动。';
  }
  return `调用失败：${(err && err.message) || '未知错误'}${text ? `\n${text}` : ''}`;
}

/**
 * Chat completion. Supports streaming via onDelta.
 * @returns {Promise<string>} full text
 */
async function chat({
  apiKey,
  baseURL,
  model,
  messages,
  temperature = 0.9,
  maxTokens = 2000,
  stream = true,
  onDelta,
  timeoutMs = 120000
}) {
  const base = normalizeBaseURL(baseURL);
  if (!base) throw new Error('还没有填写接口地址（Base URL）。');
  if (!model) throw new Error('还没有填写模型名。');
  if (!apiKey) throw new Error('还没有填写 API Key。');

  const url = `${base}/chat/completions`;
  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: !!stream
  };

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }, timeoutMs);
  } catch (err) {
    throw new Error(friendlyError(err));
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (e) { /* ignore */ }
    throw new Error(friendlyError(null, res.status, body));
  }

  if (!stream) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('模型返回了空内容。');
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  let done = false;

  while (!done) {
    const { value, done: rdone } = await reader.read();
    if (rdone) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() || '';
    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') { done = true; break; }
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
          if (delta) {
            full += delta;
            if (onDelta) onDelta(delta);
          }
        } catch (e) {
          // Some providers send keep-alives; ignore malformed lines.
        }
      }
      if (done) break;
    }
  }

  if (!full.trim()) throw new Error('模型没有返回内容，可能是模型名不对，或该服务不支持 stream。');
  return full;
}

async function testConnection(cfg) {
  const started = Date.now();
  const text = await chat({
    ...cfg,
    messages: [
      { role: 'system', content: '你是一个测试助手。' },
      { role: 'user', content: '只回复两个字：在的' }
    ],
    temperature: 0,
    maxTokens: 16,
    stream: false,
    timeoutMs: 30000
  });
  return { ok: true, ms: Date.now() - started, sample: text.trim() };
}

module.exports = { PROVIDERS, chat, testConnection, normalizeBaseURL };
