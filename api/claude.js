const Anthropic = require('@anthropic-ai/sdk');

// Simple in-memory rate limiting (resets on cold start)
const rateLimits = new Map();
const RATE_LIMIT  = 30;   // requests per window
const RATE_WINDOW = 3600000; // 1 hour in ms

function checkRateLimit(ip) {
  const now  = Date.now();
  const hits = (rateLimits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_LIMIT) return false;
  rateLimits.set(ip, [...hits, now]);
  return true;
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Твърде много заявки. Моля изчакай малко.' });
  }

  const { type, subject, ageGroup, stepCount, image, stepTitle, stepIndex, totalSteps } = req.body || {};

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // ── GENERATE LESSON STEPS ──────────────────────────────────────────────
    if (type === 'generate_steps') {
      const n = parseInt(stepCount) || 6;
      const ageDesc = {
        '4-6':  'деца на 4-6 години (много прости инструкции, весели, max 1-2 изречения)',
        '7-10': 'деца на 7-10 години (средна сложност, ясни стъпки)',
        '11-15':'тийнейджъри 11-15 години (включи техники: щриховане, перспектива)',
        '16+':  'напреднали 16+ (професионален език, детайлни художествени техники)',
      }[ageGroup] || 'деца';

      const prompt = `Ти си детски учител по рисуване. Генерирай точно ${n} стъпки за рисуване на "${subject}" за ${ageDesc}.

Отговори САМО с валиден JSON масив (без markdown, без обяснения):
[{"step":1,"title":"Кратко заглавие","instruction":"Конкретна инструкция.","emoji":"⭕"},...]

Правила:
- Всяка стъпка надгражда предишната прогресивно
- Последната стъпка е ВИНАГИ за оцветяване
- Emojis подходящи за темата
- Всичко на БЪЛГАРСКИ`;

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.content[0].text.trim().replace(/```json\n?|```\n?/g, '');
      const steps = JSON.parse(raw);
      if (!Array.isArray(steps) || !steps.length) throw new Error('Invalid steps format');
      return res.status(200).json(steps);
    }

    // ── ANALYZE DRAWING ────────────────────────────────────────────────────
    if (type === 'analyze_drawing') {
      const ageCtx = {
        '4-6':  'малко дете на 4-6 години',
        '7-10': 'дете на 7-10 години',
        '11-15':'тийнейджър на 11-15 години',
        '16+':  'млад художник',
      }[ageGroup] || 'дете';

      if (!image) return res.status(400).json({ error: 'No image provided' });

      const b64    = image.replace(/^data:image\/\w+;base64,/, '');
      const mime   = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const stepInfo = stepTitle
        ? `Детето е на стъпка ${(stepIndex || 0) + 1} от ${totalSteps || '?'}: "${stepTitle}".`
        : '';

      const prompt = `Ти си насърчаващ учител по рисуване. ${stepInfo}
Детето (${ageCtx}) се опитва да нарисува "${subject || 'нещо'}".

Дай КРАТКА обратна връзка на БЪЛГАРСКИ (2-3 изречения):
1. Похвали нещо конкретно и видимо в рисунката
2. Един практичен съвет за подобрение
3. Насърчение да продължи

Говори директно към детето ("Браво!", "Опитай...", "Продължавай!").`;

      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 350,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text',  text: prompt },
          ],
        }],
      });

      return res.status(200).json({ feedback: response.content[0].text.trim() });
    }

    return res.status(400).json({ error: 'Unknown request type' });

  } catch (err) {
    console.error('Claude proxy error:', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Неуспешно генериране. Опитай пак.' });
    }
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
