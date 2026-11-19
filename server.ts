import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoogleGenAI} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req, res) => {
    const serverOpenAIKey =
      process.env.OPENAI_COMPAT_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      '';
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      hasOpenAICompatKey: Boolean(serverOpenAIKey),
      hasCustomBaseUrl: Boolean(process.env.OPENAI_COMPAT_BASE_URL?.trim()),
      defaultOpenAIBaseUrl:
        process.env.OPENAI_COMPAT_BASE_URL?.trim() || 'https://api.openai.com/v1',
      defaultOpenAIModel:
        process.env.OPENAI_COMPAT_MODEL?.trim() || 'gpt-4o-mini',
    });
  });

  // OpenAI-Compatible Chat Completions proxy (injects server-side Secret key and avoids CORS)
  app.post('/api/chat', async (req, res) => {
    try {
      const {
        baseUrl,
        apiKey,
        model,
        messages,
        tools,
        tool_choice,
        temperature,
        useServerDefaults,
      } = req.body ?? {};

      const serverBaseUrl =
        process.env.OPENAI_COMPAT_BASE_URL?.trim() || 'https://api.openai.com/v1';
      const serverModel =
        process.env.OPENAI_COMPAT_MODEL?.trim() || 'gpt-4o-mini';

      const preferServerConfig = useServerDefaults === true;
      const effectiveBaseUrl = preferServerConfig
        ? serverBaseUrl
        : typeof baseUrl === 'string' && baseUrl.trim()
          ? baseUrl.trim()
          : serverBaseUrl;
      const effectiveModel = preferServerConfig
        ? serverModel
        : typeof model === 'string' && model.trim()
          ? model.trim()
          : serverModel;
      const effectiveKey =
        (typeof apiKey === 'string' && apiKey.trim()) ||
        process.env.OPENAI_COMPAT_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim() ||
        '';

      if (!Array.isArray(messages)) {
        return res.status(400).json({error: 'Messages array is required.'});
      }

      const isLocalEndpoint =
        effectiveBaseUrl.includes('localhost') ||
        effectiveBaseUrl.includes('127.0.0.1');
      if (!isLocalEndpoint && !effectiveKey) {
        return res.status(401).json({
          error:
            'OPENAI_COMPAT_API_KEY is not configured in server Secrets. Add OPENAI_COMPAT_API_KEY in Settings > Secrets, or switch Base URL to a local Ollama/LM Studio server.',
          code: 'MISSING_OPENAI_KEY',
        });
      }

      const normalizedBase = effectiveBaseUrl.replace(/\/+$/, '');
      const endpoint = normalizedBase.endsWith('/chat/completions')
        ? normalizedBase
        : `${normalizedBase}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (effectiveKey) {
        headers.Authorization = `Bearer ${effectiveKey}`;
      }

      const payload: Record<string, unknown> = {
        model: effectiveModel,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.8,
      };
      if (Array.isArray(tools) && tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = tool_choice ?? 'auto';
      }

      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const rawText = await upstream.text();
      const contentType = upstream.headers.get('content-type') || '';
      const trimmed = rawText.trimStart();
      const looksLikeHtml =
        /text\/html|application\/xhtml/i.test(contentType) || trimmed.startsWith('<');

      let parsed: unknown = null;
      let parseFailed = false;
      if (!looksLikeHtml && trimmed.length > 0) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parseFailed = true;
        }
      }

      if (looksLikeHtml || parseFailed || parsed === null) {
        return res.status(upstream.ok ? 502 : upstream.status).json({
          error:
            'Upstream OpenAI-compatible endpoint returned HTML or non-JSON instead of a JSON chat response. Check your Base URL (e.g. must point to /v1 or /chat/completions) and API key.',
          code: 'UPSTREAM_NON_JSON',
        });
      }

      if (!upstream.ok) {
        const parsedObj = parsed as {error?: {message?: string} | string};
        const errMessage =
          typeof parsedObj?.error === 'string'
            ? parsedObj.error
            : parsedObj?.error?.message || `Upstream API error (${upstream.status})`;
        return res.status(upstream.status).json({
          error: errMessage,
          details: parsed,
        });
      }

      return res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(502).json({error: `OpenAI-compatible proxy error: ${message}`});
    }
  });

  // High-quality image generation via gemini-3-pro-image-preview (1K / 2K / 4K)
  app.post('/api/generate-image', async (req, res) => {
    try {
      const {prompt, imageSize = '1K', aspectRatio = '1:1'} = req.body ?? {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({error: 'Image prompt is required.'});
      }
      const allowedSizes = new Set(['1K', '2K', '4K']);
      const validatedSize = allowedSizes.has(imageSize) ? imageSize : '1K';
      const allowedRatios = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
      const validatedRatio = allowedRatios.has(aspectRatio) ? aspectRatio : '1:1';

      const ai = createGeminiClient();
      if (!ai) {
        return res.status(401).json({
          error:
            'GEMINI_API_KEY is not configured in Settings > Secrets. Please select a paid Gemini API key to run gemini-3-pro-image-preview.',
          code: 'MISSING_API_KEY',
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: {
          parts: [{text: prompt.trim()}],
        },
        config: {
          imageConfig: {
            aspectRatio: validatedRatio,
            imageSize: validatedSize,
          },
        },
      });

      let imageUrl = '';
      let notes = '';
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          notes += part.text;
        }
      }

      if (!imageUrl) {
        return res.status(502).json({
          error: 'gemini-3-pro-image-preview returned no image part.',
          notes,
        });
      }

      return res.json({
        imageUrl,
        model: 'gemini-3-pro-image-preview',
        imageSize: validatedSize,
        aspectRatio: validatedRatio,
        notes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isBillingOrPerm =
        /PERMISSION_DENIED|403|429|RESOURCE_EXHAUSTED|API_KEY_INVALID|billing/i.test(
          message
        );
      return res.status(isBillingOrPerm ? 403 : 500).json({
        error: isBillingOrPerm
          ? `Gemini image generation requires a valid paid API key in Settings > Secrets (${message})`
          : message,
      });
    }
  });

  // Safe CORS proxy for user-provided external .vrm/.glb URLs
  app.get('/api/proxy-vrm', async (req, res) => {
    try {
      const targetUrlRaw = String(req.query.url ?? '').trim();
      if (!targetUrlRaw) {
        return res.status(400).json({error: 'Missing url query parameter.'});
      }
      let parsed: URL;
      try {
        parsed = new URL(targetUrlRaw);
      } catch {
        return res.status(400).json({error: 'Invalid VRM URL.'});
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({error: 'Only http/https VRM URLs are allowed.'});
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return res.status(403).json({error: 'Private network hosts are blocked by the VRM proxy.'});
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {Accept: 'model/gltf-binary,application/octet-stream,*/*'},
      });
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `Upstream VRM fetch failed (${upstream.status} ${upstream.statusText})`,
        });
      }
      const contentLength = Number(upstream.headers.get('content-length') ?? 0);
      if (contentLength > 60 * 1024 * 1024) {
        return res.status(413).json({error: 'VRM file exceeds 60MB size limit.'});
      }

      const arrayBuf = await upstream.arrayBuffer();
      if (arrayBuf.byteLength > 60 * 1024 * 1024) {
        return res.status(413).json({error: 'VRM file exceeds 60MB size limit.'});
      }

      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(Buffer.from(arrayBuf));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return res.status(502).json({error: `VRM proxy error: ${msg}`});
    }
  });

  if (IS_PROD) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      resolve: {
        dedupe: ['three', '@pixiv/three-vrm'],
      },
      server: {middlewareMode: true, hmr: false},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AIMouto-XR server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
