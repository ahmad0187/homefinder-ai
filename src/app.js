import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { chat } from './agent/index.js';
import { detailCard } from './agent/tools.js';
import { getHomeDetails } from './crawl/crawler.js';

const ChatBody = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(30)
    .default([]),
  context: z
    .object({
      shownHomes: z
        .array(
          z.object({
            id: z.string().max(60),
            title: z.string().max(200).optional(),
            development: z.string().max(200).nullish(),
            town: z.string().max(100).nullish(),
            priceText: z.string().max(60).nullish(),
            price: z.number().nullish(),
            plotNo: z.string().max(20).nullish(),
            houseType: z.string().max(100).nullish(),
          }),
        )
        .max(12)
        .optional(),
      filters: z.record(z.string(), z.any()).optional(),
      focusHomeId: z.string().max(60).nullish(),
    })
    .default({}),
  action: z.object({ type: z.literal('details'), homeId: z.string().max(60) }).optional(),
});

/** Keeps alternating user/assistant turns (the API requires the first to be from the user). */
function cleanHistory(history) {
  const out = [];
  for (const m of history.slice(-12)) {
    if (!m.content.trim()) continue;
    if (out.length && out.at(-1).role === m.role) out.at(-1).content += `\n${m.content}`;
    else out.push({ ...m });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out.at(-1).role === 'user') out.pop();
  return out;
}

export function createApp(index) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', config.siteUrl],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  // The widget can be embedded on other websites, so the API answers CORS requests from allowed origins.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      assistant: config.assistantName,
      site: { name: config.siteName, url: config.siteUrl },
      mode: config.anthropicKey ? 'claude' : 'offline',
      index: index.stats(),
      showImages: config.showImages,
    });
  });

  const chatLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.CHAT_RATE_LIMIT || 30), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many messages. Please wait a minute.' } });

  app.post('/api/chat', chatLimiter, async (req, res, next) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues.slice(0, 3).map((i) => i.message) });
    try {
      const { message, history, context, action } = parsed.data;
      const out = await chat({ index, message, history: cleanHistory(history), context, action });
      if (!config.showImages) {
        out.homes?.forEach((h) => (h.image = null));
        if (out.home) out.home.images = [];
      }
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/homes/:id', async (req, res, next) => {
    try {
      const d = await getHomeDetails(index, req.params.id);
      if (!d) return res.status(404).json({ error: 'Home not found' });
      res.json(detailCard(d, index));
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
