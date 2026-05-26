const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || 'monportfolio2024';
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const DB_PATH = path.join(dataDir, 'portfolio.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { assets: [], realEstate: [], settings: {}, nextId: 1 }; }
}
function writeDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function nid(db) { const id = db.nextId || 1; db.nextId = id + 1; return id; }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const code = req.headers['x-access-code'] || req.query.code;
  if (code !== ACCESS_CODE) return res.status(401).json({ error: "Code incorrect" });
  next();
}

// Assets (supports)
app.get('/api/assets', auth, (req, res) => res.json(readDB().assets || []));

app.post('/api/assets', auth, (req, res) => {
  const db = readDB();
  const asset = { id: nid(db), ...req.body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  db.assets.push(asset);
  writeDB(db);
  res.json({ id: asset.id });
});

app.put('/api/assets/:id', auth, (req, res) => {
  const db = readDB();
  const i = db.assets.findIndex(a => a.id === +req.params.id);
  if (i >= 0) db.assets[i] = { ...db.assets[i], ...req.body, updated_at: new Date().toISOString() };
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/assets/:id', auth, (req, res) => {
  const db = readDB();
  db.assets = db.assets.filter(a => a.id !== +req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Prix automatiques
app.post('/api/refresh-prices', auth, async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const db = readDB();
    const updated = [];

    // Yahoo Finance (ETF/actions)
    const yahooAssets = db.assets.filter(a => a.auto_price && a.ticker && a.asset_type !== 'crypto');
    for (const asset of yahooAssets) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.ticker)}?interval=1d&range=1d`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await r.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (price) {
          const i = db.assets.findIndex(a => a.id === asset.id);
          if (i >= 0) {
            db.assets[i].unit_price = price;
            if (asset.units > 0) db.assets[i].current_value = Math.round(price * asset.units * 100) / 100;
            db.assets[i].last_price_update = new Date().toISOString();
            db.assets[i].updated_at = new Date().toISOString();
          }
          updated.push({ id: asset.id, name: asset.name, price });
        }
      } catch(e) { console.error('Yahoo err', asset.ticker); }
    }

    // CoinGecko (crypto)
    const cryptoAssets = db.assets.filter(a => a.auto_price && a.ticker && a.asset_type === 'crypto');
    if (cryptoAssets.length) {
      try {
        const ids = [...new Set(cryptoAssets.map(a => a.ticker.toLowerCase()))].join(',');
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`);
        const prices = await r.json();
        for (const asset of cryptoAssets) {
          const price = prices[asset.ticker.toLowerCase()]?.eur;
          if (price) {
            const i = db.assets.findIndex(a => a.id === asset.id);
            if (i >= 0) {
              db.assets[i].unit_price = price;
              if (asset.units > 0) db.assets[i].current_value = Math.round(price * asset.units * 100) / 100;
              db.assets[i].last_price_update = new Date().toISOString();
            }
            updated.push({ id: asset.id, name: asset.name, price });
          }
        }
      } catch(e) { console.error('CoinGecko err'); }
    }

    writeDB(db);
    res.json({ updated, count: updated.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Settings
app.get('/api/settings', auth, (req, res) => res.json(readDB().settings || {}));
app.post('/api/settings', auth, (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = {};
  db.settings[req.body.key] = req.body.value;
  writeDB(db);
  res.json({ ok: true });
});

// Real Estate
app.get('/api/real-estate', auth, (req, res) => res.json(readDB().realEstate || []));
app.post('/api/real-estate', auth, (req, res) => {
  const db = readDB();
  const re = { id: nid(db), ...req.body, created_at: new Date().toISOString() };
  db.realEstate.push(re); writeDB(db); res.json({ id: re.id });
});
app.put('/api/real-estate/:id', auth, (req, res) => {
  const db = readDB();
  const i = db.realEstate.findIndex(r => r.id === +req.params.id);
  if (i >= 0) db.realEstate[i] = { ...db.realEstate[i], ...req.body };
  writeDB(db); res.json({ ok: true });
});
app.delete('/api/real-estate/:id', auth, (req, res) => {
  const db = readDB();
  db.realEstate = db.realEstate.filter(r => r.id !== +req.params.id);
  writeDB(db); res.json({ ok: true });
});

// Export
app.get('/api/export', auth, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="portfolio-export.json"');
  res.json({ exported_at: new Date().toISOString(), ...readDB() });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Portfolio V3 sur http://localhost:${PORT}`));
