# Deployment Guide

## 🖥️ Local (Recommended)

1. Download or clone the repository
2. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari)
3. That's it — the app is fully functional offline

```bash
git clone https://github.com/YOUR_USERNAME/mini-pos-market.git
open mini-pos-market/index.html
```

---

## 🌐 Static Hosting (Optional)

Since this is a single HTML file, it can be deployed to any static host:

### GitHub Pages
1. Push repo to GitHub
2. Go to **Settings → Pages**
3. Set source to `main` branch, root folder
4. Access at `https://YOUR_USERNAME.github.io/mini-pos-market`

### Netlify
1. Drag & drop the project folder at [netlify.com/drop](https://app.netlify.com/drop)
2. Done — live URL generated instantly

### Vercel
```bash
npm i -g vercel
vercel --prod
```

### Self-hosted (Nginx)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/mini-pos-market;
    index index.html;
}
```

---

## 💾 Data & Backup

All data is stored in **browser localStorage**.

- Data is **per browser, per device** — it does not sync automatically
- To back up: use **📥 Exportă CSV** from the Stock tab
- To restore: use **📤 Importă CSV**
- To migrate to another device: export CSV → open app on new device → import CSV

> ⚠️ Clearing browser data/cache will delete all POS data. Export regularly!

---

## 🖨️ Kiosk / Dedicated Device Setup

For a dedicated shop terminal:

1. Open `index.html` in Chrome
2. Go to **Chrome Menu → More Tools → Create Shortcut** → check "Open as window"
3. Optionally enable Chrome Kiosk mode:

```bash
chrome --kiosk --app=file:///path/to/index.html
```
