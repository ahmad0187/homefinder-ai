import { config } from '../config.js';
import { chatWithClaude } from './claude.js';
import { chatOffline } from './fallback.js';

function suggestionsFor(out) {
  if (out.home) return ['Room sizes', 'What offers are on this home?', "What's the area like?", 'How do I book a viewing?'];
  if (out.homes?.length) return ['Show cheaper ones', 'Only with Part Exchange', 'Ready to move into', 'Tell me about the first one'];
  if (out.homes && !out.homes.length) return ['Where do you have homes?', 'Any price', 'Start a new search'];
  return ['3 bed homes under £350k', 'Homes ready to move into', 'Where do you have homes?', 'What is Part Exchange?'];
}

/** One chat turn. Uses Claude when a key is configured, otherwise (or if Claude fails) the built-in assistant. */
export async function chat({ index, message, history = [], context = {}, action }) {
  if (index.isEmpty) {
    return {
      reply: "I'm reading the website for the first time, so I don't have any homes to show yet. Please try again in a few minutes. (If this keeps happening, run `npm run crawl` on the server.)",
      mode: 'empty',
      suggestions: [],
    };
  }

  let out;
  let mode = 'offline';
  if (config.anthropicKey) {
    try {
      const msg = action?.type === 'details' && action.homeId ? `${message}\n\n(home id: ${action.homeId})` : message;
      out = await chatWithClaude({ index, history, message: msg, context: { ...context, focusHomeId: action?.homeId || context.focusHomeId } });
      mode = 'claude';
      if (out.home) out.focusHomeId = out.home.id;
    } catch (err) {
      console.error('Claude unavailable, using the built-in assistant:', err.status || '', err.message);
    }
  }
  if (!out) out = await chatOffline({ index, message, context, action });

  return {
    reply: out.reply,
    homes: out.homes ?? null,
    home: out.home ?? null,
    total: out.total ?? null,
    filters: out.filters ?? null,
    focusHomeId: out.focusHomeId || out.home?.id || context.focusHomeId || null,
    sources: out.sources ?? null,
    suggestions: suggestionsFor(out),
    mode,
  };
}
