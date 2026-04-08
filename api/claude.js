const Anthropic = require('@anthropic-ai/sdk');

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

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

// Try models in order until one works
async function tryModels(client, params, models) {
  let lastErr;
  for (const model of models) {
    try {
      return await client.messages.create({ ...params, model });
    } catch (err) {
      if (err.status === 404) { lastErr = err; continue; } // model not found, try next
      throw err; // other error — rethrow
    }
  }
  throw lastErr;
}

const TEXT_MODELS  = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'];
const VISION_MODELS= ['claude-sonnet-4-5-20251001', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Твърде много заявки. Почакай малко.' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API ключът не е конфигуриран в Vercel.' });
  }

  const { type, subject, ageGroup, stepCount, image, stepTitle, stepIndex, totalSteps } = req.body || {};
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    if (type === 'generate_steps') {
      const n = parseInt(stepCount) || 6;
      const ageDesc = {
        '4-6':  'деца на 4-6 години (много прости, 1-2 изречения)',
        '7-10': 'деца на 7-10 години (средна сложност)',
        '11-15':'тийнейджъри 11-15 год (щриховане, перспектива)',
        '16+':  'напреднали 16+ (професионален език)',
      }[ageGroup] || 'деца';

      const response = await tryModels(client, {
        max_tokens: 1500,
        messages: [{ role: 'user', content:
          `Ти си детски учител по рисуване. Генерирай точно ${n} стъпки за рисуване на "${subject}" за ${ageDesc}.
Отговори САМО с валиден JSON масив без никакъв друг текст:
[{"step":1,"title":"Заглавие","instruction":"Инструкция.","emoji":"⭕"},...]
Правила: прогресивни стъпки, последната е оцветяване, всичко на БЪЛГАРСКИ.`
        }],
      }, TEXT_MODELS);

      const raw = response.content[0].text.trim().replace(/```json\n?|```\n?/g, '');
      const steps = JSON.parse(raw);
      if (!Array.isArray(steps) || !steps.length) throw new Error('Invalid format');
      return res.status(200).json(steps);
    }

    if (type === 'analyze_drawing') {
      if (!image) return res.status(400).json({ error: 'Няма изображение.' });
      const b64  = image.replace(/^data:image\/\w+;base64,/, '');
      const mime = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const ageCtx = { '4-6':'малко дете 4-6 год','7-10':'дете 7-10 год','11-15':'тийнейджър 11-15 год','16+':'млад художник' }[ageGroup] || 'дете';
      const stepInfo = stepTitle ? `Стъпка ${(stepIndex||0)+1}/${totalSteps||'?'}: "${stepTitle}".` : '';

      const response = await tryModels(client, {
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text:
              `Ти си насърчаващ учител по рисуване. ${stepInfo}
${ageCtx} рисува "${subject||'нещо'}". Дай кратка обратна връзка на БЪЛГАРСКИ (2-3 изречения): похвала, съвет, насърчение.`
            },
          ],
        }],
      }, VISION_MODELS);

      return res.status(200).json({ feedback: response.content[0].text.trim() });
    }

    return res.status(400).json({ error: 'Непознат тип заявка.' });

  } catch (err) {
    console.error('API error:', err.status, err.message);
    const msg = err.status === 401 ? 'Невалиден API ключ.'
              : err.status === 429 ? 'Claude API лимит — почакай минута.'
              : err.status === 404 ? `Модел не намерен: ${err.message}`
              : err.message || 'Server error';
    return res.status(500).json({ error: msg });
  }
};
