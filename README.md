# SketchKids 🎨

AI-powered drawing app for children. Built with React PWA + Claude API.

---

## ⚡ Deploy to Vercel (5 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "SketchKids v2"
git remote add origin https://github.com/YOUR_USERNAME/sketchkids.git
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to **vercel.com** → New Project
2. Import your GitHub repo
3. Click **Deploy**

### 3. Add API Key (required!)
In Vercel Dashboard → Your Project → **Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (your Claude API key) |
| `ALLOWED_ORIGIN` | `https://your-app.vercel.app` |

Then **Redeploy** (Deployments → ⋯ → Redeploy).

### 4. Open on iPhone/iPad
- Go to your Vercel URL in **Safari**
- Tap **Share** → **Add to Home Screen**
- App works like native! 🎉

---

## 🔑 Get Claude API Key
1. Go to **console.anthropic.com**
2. API Keys → Create Key
3. Copy it to Vercel env var

---

## 📁 Project Structure
```
sketchkids/
├── public/
│   ├── index.html      ← React PWA (entire app)
│   └── manifest.json   ← PWA config
├── api/
│   └── claude.js       ← Serverless proxy (API key stays here!)
├── package.json
├── vercel.json
└── README.md
```

## 🔒 Security
- API key is **never** in client code
- All Claude calls go through `/api/claude` serverless function
- Rate limiting: 30 requests/hour per IP
- ALLOWED_ORIGIN restricts CORS to your domain

## 💰 Cost
- Vercel hosting: **FREE**
- Claude API: ~$0.003/lesson, ~$0.002/drawing analysis
- Total for active daily use: ~$2-5/month
