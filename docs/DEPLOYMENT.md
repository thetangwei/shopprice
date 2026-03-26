# 🚀 Deployment Guide

## 🖥️ Local (Recommended for most users)

1. Download `index.html`
2. Open it in any modern browser
3. Done — fully functional offline

```bash
git clone https://github.com/YOUR_USERNAME/mini-pos-market.git
open mini-pos-market/index.html
```

---

## 🌐 GitHub Pages (Free hosting)

1. Push repo to GitHub
2. **Settings → Pages → Source:** `main` branch, `/root`
3. Live at: `https://YOUR_USERNAME.github.io/mini-pos-market`

---

## 🌐 Netlify (Drag & Drop)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the project folder onto the page
3. Instant live URL — no config needed

---

## 🌐 Vercel

```bash
npm i -g vercel
vercel --prod
```

---

## 🖥️ Self-hosted (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/mini-pos-market;
    index index.html;
}
```

---

## 🖨️ Kiosk / Dedicated Shop Terminal

For a dedicated register device:

```bash
# Chrome kiosk mode — fullscreen, no browser UI
google-chrome --kiosk --app=file:///absolute/path/to/index.html

# Windows
chrome.exe --kiosk --app=file:///C:/pos/index.html
```

Or: Chrome Menu → More Tools → Create Shortcut → ✅ Open as window

---

## 💾 Data Backup

All data lives in browser `localStorage`.

| Action | How |
|---|---|
| Backup | Stock tab → 📥 Exportă CSV |
| Restore | Stock tab → 📤 Importă CSV |
| Migrate device | Export CSV → open on new device → Import CSV |
| Reset all data | Rapoarte → 🔄 Resetează Date |

> ⚠️ Clearing browser cache deletes all POS data. Export CSV regularly!
