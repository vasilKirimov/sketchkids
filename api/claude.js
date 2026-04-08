const Anthropic = require('@anthropic-ai/sdk');

// Increase body size limit for large images from iPhone
module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

// Simple in-memory rate limiting
const rateLimits = new Map();
const RATE_LIMIT  = 40;
const RATE_WINDOW = 3600000;

function checkRateLimit(ip) {
  const now  = Date.now();
  const hits = (rateLimits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_LIMIT) return false;
  rateLimits.set(ip, [...hits, now]);
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Твърде много заявки. Почакай малко.' });
  }

  const { type, subject, ageGroup, stepCount, image, stepTitle, stepIndex, totalSteps } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API ключът не е конфигуриран в Vercel.' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // ── GENERATE LESSON STEPS ──────────────────────────────────────────────
    if (type === 'generate_steps') {
      const n = parseInt(stepCount) || 6;
      const ageDesc = {
        '4-6':  'деца на 4-6 години (много прости инструкции, 1-2 изречения)',
        '7-10': 'деца на 7-10 години (средна сложност)',
        '11-15':'тийнейджъри 11-15 години (включи техники: щриховане, перспектива)',
        '16+':  'напреднали художници 16+ (професионален език, детайлни техники)',
      }[ageGroup] || 'деца';

      const prompt = `Ти си детски учител по рисуване. Генерирай точно ${n} стъпки за рисуване на "${subject}" за ${ageDesc}.

Отговори САМО с валиден JSON масив без никакъв друг текст:
[{"step":1,"title":"Кратко заглавие","instruction":"Конкретна инструкция.","emoji":"⭕"},...]

Правила:
- Стъпките да са прогресивни (всяка надгражда предишната)
- Последната стъпка е ВИНАГИ оцветяване
- Всичко на БЪЛГАРСКИ език`;

      const response = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw   = response.content[0].text.trim().replace(/```json\n?|```\n?/g, '');
      const steps = JSON.parse(raw);
      if (!Array.isArray(steps) || !steps.length) throw new Error('Invalid format');
      return res.status(200).json(steps);
    }

    // ── ANALYZE DRAWING ────────────────────────────────────────────────────
    if (type === 'analyze_drawing') {
      if (!image) return res.status(400).json({ error: 'Няма изображение.' });

      const b64  = image.replace(/^data:image\/\w+;base64,/, '');
      const mime = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

      const ageCtx = {
        '4-6':  'малко дете на 4-6 години',
        '7-10': 'дете на 7-10 години',
        '11-15':'тийнейджър на 11-15 години',
        '16+':  'млад художник',
      }[ageGroup] || 'дете';

      const stepInfo = stepTitle
        ? `Детето е на стъпка ${(stepIndex || 0) + 1} от ${totalSteps || '?'}: "${stepTitle}".`
        : '';

      const prompt = `Ти си насърчаващ учител по рисуване. ${stepInfo}
${ageCtx.charAt(0).toUpperCase() + ageCtx.slice(1)} се опитва да нарисува "${subject || 'нещо'}".

Дай КРАТКА обратна връзка на БЪЛГАРСКИ (2-3 изречения):
1. Похвали нещо конкретно и видимо
2. Един практичен съвет
3. Насърчение да продължи

Говори директно към детето.`;

      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 400,
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

    return res.status(400).json({ error: 'Непознат тип заявка.' });

  } catch (err) {
    console.error('API error:', err.message, err.status);
    if (err.status === 401) return res.status(500).json({ error: 'Невалиден API ключ. Провери настройките в Vercel.' });
    if (err.status === 429) return res.status(429).json({ error: 'Claude API лимит. Опитай след минута.' });
    if (err instanceof SyntaxError) return res.status(500).json({ error: 'Грешка при парсване. Опитай пак.' });
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
