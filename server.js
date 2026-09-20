'use strict';
/**
 * Cash Flow BD — Telegram Mini App backend + bot
 * Zero dependencies. Requires Node.js 18+.
 *
 *   1. copy .env.example -> .env and fill it in
 *   2. node server.js
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ───────────────────────── .env loader ───────────────────────── */
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => { const n = Number(env(k, d)); return Number.isFinite(n) ? n : d; };

const CFG = {
  APP_NAME: env('APP_NAME', 'Cash Flow BD'),
  BOT_TOKEN: env('BOT_TOKEN', ''),
  BOT_USERNAME: env('BOT_USERNAME', 'CashFlowBD24_Bot').replace(/^@/, ''),
  MINIAPP_SHORTNAME: env('MINIAPP_SHORTNAME', ''),
  WEBAPP_URL: env('WEBAPP_URL', '').replace(/\/+$/, ''),
  CHANNEL: env('CHANNEL', ''),                       // e.g. @CashFlowBD24
  CHANNEL_URL: env('CHANNEL_URL', ''),               // e.g. https://t.me/CashFlowBD24
  ADMIN_IDS: env('ADMIN_IDS', '').split(',').map(s => s.trim()).filter(Boolean),
  SUPPORT_URL: env('SUPPORT_URL', ''),
  TUTORIAL_URL: env('TUTORIAL_URL', ''),
  PORT: num('PORT', 3000),
  DEV: env('DEV', '0') === '1',

  AD_REWARD: num('AD_REWARD', 20),
  AD_DAILY_LIMIT: num('AD_DAILY_LIMIT', 20),
  MIN_AD_SECONDS: num('MIN_AD_SECONDS', 5),
  DAILY_BONUS: num('DAILY_BONUS', 10),
  REF_REWARD: num('REF_REWARD', 25),
  REF_BONUS: num('REF_BONUS', 5),
  MIN_WITHDRAW: num('MIN_WITHDRAW', 1000),
  MIN_REFERRALS: num('MIN_REFERRALS', 20),
  TASK_REWARD: num('TASK_REWARD', 20),

  MONETAG_POSTBACK_SECRET: env('MONETAG_POSTBACK_SECRET', ''),
  REQUIRE_POSTBACK: env('REQUIRE_POSTBACK', '0') === '1',

  SPONSOR_URL: env('SPONSOR_URL', 'https://www.profitableratecpmnetwork.com/uckha6zwv?key=c944e22dca0a9b5c5ecc07d3e763f67a'),   // Adsterra direct link shown as a labelled "Sponsored" card
  ADMIN_PASSWORD: env('ADMIN_PASSWORD', ''),          // enables the /admin panel
  ADMIN_SECRET: env('ADMIN_SECRET', ''),              // optional: fixed signing key for admin sessions
};

if (!CFG.BOT_TOKEN && !CFG.DEV) {
  console.error('\n✖ BOT_TOKEN is missing. Put it in .env (see .env.example) — or run with DEV=1 for local testing.\n');
  process.exit(1);
}

const LEVELS = [
  { lv: 1, min: 0,   bn: 'নতুন',      en: 'Newbie' },
  { lv: 2, min: 10,  bn: 'উদীয়মান',   en: 'Rising' },
  { lv: 3, min: 30,  bn: 'প্রো',       en: 'Pro' },
  { lv: 4, min: 60,  bn: 'এক্সপার্ট',  en: 'Expert' },
  { lv: 5, min: 100, bn: 'মাস্টার',    en: 'Master' },
  { lv: 6, min: 200, bn: 'লিজেন্ড',    en: 'Legend' },
];

/* ───────────────────────── tiny JSON "database" ───────────────────────── */
const DATA_DIR = env('DATA_DIR', '') ? path.resolve(env('DATA_DIR', '')) : path.join(__dirname, 'data');   // point this at a persistent volume on cloud hosts
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { users: {}, withdrawals: [], pendingRef: {}, nextWid: 1, settings: {}, daily: {}, secret: '' };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (_) { /* first run */ }

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), err => {
      if (err) return console.error('db save error', err.message);
      fs.rename(tmp, DB_FILE, e => e && console.error('db rename error', e.message));
    });
  }, 400);
}
const flushSync = () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (_) {} };
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

/* Settings edited from the admin panel override the .env values */
const SETTING_KEYS = {
  AD_REWARD: 'n', AD_DAILY_LIMIT: 'n', MIN_AD_SECONDS: 'n', DAILY_BONUS: 'n', REF_REWARD: 'n', REF_BONUS: 'n',
  MIN_WITHDRAW: 'n', MIN_REFERRALS: 'n', TASK_REWARD: 'n', TUTORIAL_URL: 's', SUPPORT_URL: 's', SPONSOR_URL: 's',
};
function applySettings() {
  for (const k in SETTING_KEYS) {
    if (db.settings && k in db.settings) CFG[k] = SETTING_KEYS[k] === 'n' ? Number(db.settings[k]) : String(db.settings[k]);
  }
}
applySettings();
if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); save(); }

/* Tasks live in data/tasks.json so you can add/edit them without touching code.
   type: "telegram" (verified with getChatMember) | "youtube" | "whatsapp" | "tiktok" (timer based) */
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
function loadTasks() {
  const defaults = path.join(__dirname, 'tasks.default.json');
  if (!fs.existsSync(TASKS_FILE) && fs.existsSync(defaults)) fs.copyFileSync(defaults, TASKS_FILE);
  if (!fs.existsSync(TASKS_FILE)) {
    const seed = [];
    if (CFG.CHANNEL) {
      seed.push({
        id: 'tg_join_main', type: 'telegram', title: 'Join our Telegram channel',
        desc: 'Join the channel, then press Verify', reward: CFG.TASK_REWARD,
        url: CFG.CHANNEL_URL || `https://t.me/${CFG.CHANNEL.replace(/^@/, '')}`, chat: CFG.CHANNEL, active: true,
      });
    }
    fs.writeFileSync(TASKS_FILE, JSON.stringify(seed, null, 2));
  }
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch (e) { console.error('tasks.json invalid:', e.message); return []; }
}
let TASKS = loadTasks();
fs.watchFile(TASKS_FILE, { interval: 3000 }, () => { TASKS = loadTasks(); });

/* ───────────────────────── helpers ───────────────────────── */
const r2 = n => Math.round(n * 100) / 100;
const dayKey = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);              // Asia/Dhaka day
const yesterdayKey = () => new Date(Date.now() + 6 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const levelFor = refs => { let L = LEVELS[0]; for (const l of LEVELS) if (refs >= l.min) L = l; return L; };
const dayOf = ts => new Date(ts + 6 * 3600e3).toISOString().slice(0, 10);

/* per-day counters for the admin dashboard */
function dayStat(k) {
  k = k || dayKey();
  if (!db.daily[k]) {
    db.daily[k] = { ad_starts: 0, ad_done: 0, wd_req: 0, verifies: 0, active: {} };
    const keys = Object.keys(db.daily).sort();
    while (keys.length > 120) delete db.daily[keys.shift()];
  }
  return db.daily[k];
}
const bump = f => { const d = dayStat(); d[f] = (d[f] || 0) + 1; };
function touch(u) { u.last_active = Date.now(); dayStat().active[u.id] = 1; }

function markVerified(u) {
  if (u.verified) return;
  u.verified = true; u.verified_at = Date.now(); bump('verifies');
  settleReferral(u); save();
}

function tgCall(method, payload) {
  return new Promise(resolve => {
    if (!CFG.BOT_TOKEN) return resolve({ ok: false, description: 'no token' });
    const body = JSON.stringify(payload || {});
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${CFG.BOT_TOKEN}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 45000,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ ok: false, description: 'bad json' }); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ ok: false, description: e.message }));
    req.end(body);
  });
}
const notify = (chat_id, text, extra) => tgCall('sendMessage', Object.assign({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {}));
function notifyAdmins(text, extra) {
  if (!CFG.ADMIN_IDS.length) console.warn('⚠ ADMIN_IDS is empty — nobody will receive withdrawal alerts (check the admin panel instead).');
  for (const a of CFG.ADMIN_IDS) {
    notify(a, text, extra).then(r => { if (!r.ok) console.warn(`⚠ Could not message admin ${a}: ${r.description} — open the bot and press /start with that account first.`); });
  }
}
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function isMember(chat, uid) {
  if (!chat) return true;
  const r = await tgCall('getChatMember', { chat_id: chat, user_id: Number(uid) });
  if (!r.ok) { console.warn('getChatMember failed:', r.description, '— the bot must be an ADMIN of', chat); return false; }
  const s = r.result.status;
  if (s === 'restricted') return r.result.is_member !== false;
  return ['creator', 'administrator', 'member'].includes(s);
}

/* ───────────────────────── Telegram initData auth ───────────────────────── */
function verifyInitData(initData) {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash'); if (!hash) return null;
    p.delete('hash');
    const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(CFG.BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
    const user = JSON.parse(p.get('user') || 'null'); if (!user || !user.id) return null;
    return { user, start_param: p.get('start_param') || '' };
  } catch (_) { return null; }
}

function authenticate(req) {
  if (CFG.DEV && req.headers['x-dev-user']) {
    const id = String(req.headers['x-dev-user']).replace(/\D/g, '') || '1';
    return { user: { id: Number(id), first_name: 'Dev ' + id, username: 'dev' + id }, start_param: String(req.headers['x-dev-start'] || '') };
  }
  return verifyInitData(String(req.headers['x-init-data'] || ''));
}

/* ───────────────────────── domain logic ───────────────────────── */
function getOrCreateUser(tg, startParam) {
  const id = String(tg.id);
  let u = db.users[id];
  const photo = tg.photo_url || '';
  if (!u) {
    u = db.users[id] = {
      id, first_name: tg.first_name || 'User', username: tg.username || '', photo,
      joined: Date.now(), last_active: Date.now(), ad_starts: 0, banned: false, verified_at: 0, balance: 0, earned: 0, ad_earn: 0, ref_earn: 0, task_earn: 0, bonus_earn: 0,
      ads_day: dayKey(), ads_today: 0, ads_total: 0,
      daily_last: '', streak: 0, bonus_claimed: 0,
      verified: !CFG.CHANNEL, referred_by: null, ref_paid: false, refs: [],
      done_tasks: [], task_started: {}, lang: 'bn',
      notif: { email: true, push: true, withdraw: true, promo: true },
    };
    // referral attribution (only once, at account creation)
    let ref = null;
    const m = /^ref_(\d+)$/.exec(startParam || '');
    if (m) ref = m[1];
    else if (db.pendingRef[id]) ref = db.pendingRef[id];
    delete db.pendingRef[id];
    if (ref && ref !== id && db.users[ref]) u.referred_by = ref;
    if (u.verified) { u.verified_at = Date.now(); settleReferral(u); }
    save();
  } else {
    u.first_name = tg.first_name || u.first_name;
    u.username = tg.username || u.username;
    if (photo) u.photo = photo;
  }
  if (u.ads_day !== dayKey()) { u.ads_day = dayKey(); u.ads_today = 0; }
  if (u.ad_starts === undefined) u.ad_starts = u.ads_total || 0;
  touch(u);
  return u;
}

function credit(u, amount, kind) {
  amount = r2(amount);
  u.balance = r2(u.balance + amount);
  u.earned = r2(u.earned + amount);
  if (kind === 'ad') u.ad_earn = r2(u.ad_earn + amount);
  else if (kind === 'ref') u.ref_earn = r2(u.ref_earn + amount);
  else if (kind === 'task') u.task_earn = r2(u.task_earn + amount);
  else u.bonus_earn = r2(u.bonus_earn + amount);
}

/** A referral counts (and pays) only after the invited user has verified. */
function settleReferral(u) {
  if (!u.referred_by || u.ref_paid || !u.verified) return;
  const ref = db.users[u.referred_by];
  if (!ref) return;
  u.ref_paid = true;
  ref.refs.push({ id: u.id, name: u.first_name, ts: Date.now(), reward: CFG.REF_REWARD });
  credit(ref, CFG.REF_REWARD, 'ref');
  if (CFG.REF_BONUS > 0) credit(u, CFG.REF_BONUS, 'bonus');
  if (ref.notif && ref.notif.push) {
    notify(ref.id, `🎉 <b>${esc(u.first_name)}</b> আপনার রেফারেলে যুক্ত হয়েছেন!\n💰 +৳${CFG.REF_REWARD} আপনার ব্যালেন্সে যোগ হয়েছে।`);
  }
}

const taskList = () => TASKS.filter(t => t && t.active !== false);
const pendingWithdrawal = uid => db.withdrawals.find(w => w.uid === uid && w.status === 'pending');

function profile(u) {
  const refs = u.refs.length;
  const L = levelFor(refs);
  const next = LEVELS.find(l => l.min > refs);
  const tasks = taskList().map(t => ({
    id: t.id, type: t.type, title: t.title, desc: t.desc || '', reward: t.reward, url: t.url || '',
    done: u.done_tasks.includes(t.id),
  }));
  const wd = db.withdrawals.filter(w => w.uid === u.id).slice(-30).reverse()
    .map(w => ({ id: w.id, method: w.method, account: w.account, amount: w.amount, status: w.status, ts: w.ts }));
  return {
    id: u.id, name: u.first_name, username: u.username, photo: u.photo, verified: u.verified,
    balance: u.balance, earned: u.earned, ad_earn: u.ad_earn, ref_earn: u.ref_earn, task_earn: u.task_earn,
    ads_today: u.ads_today, ads_left: Math.max(0, CFG.AD_DAILY_LIMIT - u.ads_today),
    daily_claimed: u.daily_last === dayKey(),
    streak: (u.daily_last === dayKey() || u.daily_last === yesterdayKey()) ? u.streak : 0,
    bonus_claimed: u.bonus_claimed,
    refs, level: L.lv, level_name: { bn: L.bn, en: L.en }, next_at: next ? next.min : null, prev_at: L.min,
    ref_list: u.refs.slice(-30).reverse(),
    tasks_done: u.done_tasks.length, tasks, withdrawals: wd, lang: u.lang, notif: u.notif,
  };
}

/* ── ads ── */
const adNonces = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of adNonces) if (now - v.ts > 15 * 60e3) adNonces.delete(k); }, 60e3).unref();

/* ── very small rate limiter ── */
const hits = new Map();
setInterval(() => hits.clear(), 60e3).unref();
function limited(uid) { const n = (hits.get(uid) || 0) + 1; hits.set(uid, n); return n > 90; }

/* ───────────────────────── API routes ───────────────────────── */
const routes = {};

routes['/api/me'] = async (u) => ({ ok: true, user: profile(u), need_verify: !u.verified });

routes['/api/verify'] = async (u) => {
  if (!u.verified) {
    if (await isMember(CFG.CHANNEL, u.id)) markVerified(u);
    else return { ok: false, error: 'not_member' };
  }
  return { ok: true, user: profile(u) };
};

routes['/api/ad/start'] = async (u) => {
  if (!u.verified) return { ok: false, error: 'verify' };
  if (u.ads_today >= CFG.AD_DAILY_LIMIT) return { ok: false, error: 'limit' };
  for (const [k, v] of adNonces) if (v.uid === u.id) adNonces.delete(k);
  const nonce = crypto.randomBytes(12).toString('hex');
  adNonces.set(nonce, { uid: u.id, ts: Date.now(), used: false, verified: false });
  u.ad_starts++; bump('ad_starts');
  return { ok: true, nonce, min_seconds: CFG.MIN_AD_SECONDS };
};

routes['/api/ad/complete'] = async (u, body) => {
  const n = adNonces.get(String(body.nonce || ''));
  if (!n || n.uid !== u.id || n.used) return { ok: false, error: 'invalid' };
  if (u.ads_today >= CFG.AD_DAILY_LIMIT) return { ok: false, error: 'limit' };
  if ((Date.now() - n.ts) / 1000 < CFG.MIN_AD_SECONDS) return { ok: false, error: 'too_fast' };
  if (CFG.REQUIRE_POSTBACK && !n.verified) return { ok: false, pending: true };
  n.used = true;
  u.ads_today++; u.ads_total++; bump('ad_done');
  credit(u, CFG.AD_REWARD, 'ad');
  save();
  return { ok: true, reward: CFG.AD_REWARD, user: profile(u) };
};

routes['/api/sponsor/click'] = async (u) => {
  u.sponsor_clicks = (u.sponsor_clicks || 0) + 1; bump('sponsor_clicks'); save();
  return { ok: true };
};

routes['/api/daily'] = async (u) => {
  if (!u.verified) return { ok: false, error: 'verify' };
  if (u.daily_last === dayKey()) return { ok: false, error: 'claimed' };
  u.streak = u.daily_last === yesterdayKey() ? u.streak + 1 : 1;
  u.daily_last = dayKey();
  u.bonus_claimed++;
  credit(u, CFG.DAILY_BONUS, 'bonus');
  save();
  return { ok: true, reward: CFG.DAILY_BONUS, user: profile(u) };
};

routes['/api/task/start'] = async (u, body) => {
  const t = taskList().find(x => x.id === body.id);
  if (!t) return { ok: false, error: 'invalid' };
  u.task_started[t.id] = Date.now(); save();
  return { ok: true };
};

routes['/api/task/claim'] = async (u, body) => {
  if (!u.verified) return { ok: false, error: 'verify' };
  const t = taskList().find(x => x.id === body.id);
  if (!t) return { ok: false, error: 'invalid' };
  if (u.done_tasks.includes(t.id)) return { ok: false, error: 'done' };
  if (t.type === 'telegram' && t.chat) {
    if (!(await isMember(t.chat, u.id))) return { ok: false, error: 'not_member' };
  } else {
    const st = u.task_started[t.id];
    if (!st || Date.now() - st < 15000) return { ok: false, error: 'too_fast' };
  }
  u.done_tasks.push(t.id);
  credit(u, t.reward, 'task');
  save();
  return { ok: true, reward: t.reward, user: profile(u) };
};

routes['/api/withdraw'] = async (u, body) => {
  if (!u.verified) return { ok: false, error: 'verify' };
  const method = String(body.method || '');
  const account = String(body.account || '').replace(/[\s-]/g, '');
  const amount = r2(Number(body.amount));
  if (!['bkash', 'nagad'].includes(method)) return { ok: false, error: 'method' };
  if (!/^(\+?88)?01[3-9]\d{8}$/.test(account)) return { ok: false, error: 'account' };
  if (!(amount >= CFG.MIN_WITHDRAW)) return { ok: false, error: 'min', min: CFG.MIN_WITHDRAW };
  if (u.refs.length < CFG.MIN_REFERRALS) return { ok: false, error: 'refs', need: CFG.MIN_REFERRALS - u.refs.length };
  if (amount > u.balance) return { ok: false, error: 'balance' };
  if (pendingWithdrawal(u.id)) return { ok: false, error: 'pending' };
  u.balance = r2(u.balance - amount);
  const w = { id: db.nextWid++, uid: u.id, method, account, amount, status: 'pending', ts: Date.now() };
  db.withdrawals.push(w); bump('wd_req');
  save();
  notifyAdmins(
    `💸 <b>নতুন উইথড্র রিকোয়েস্ট #${w.id}</b>\n\n👤 ${esc(u.first_name)}${u.username ? ' (@' + esc(u.username) + ')' : ''}\n🆔 <code>${u.id}</code>\n💳 ${method === 'bkash' ? 'bKash' : 'Nagad'}: <code>${esc(account)}</code>\n💰 পরিমাণ: <b>৳${amount}</b>\n👥 রেফারেল: ${u.refs.length} · 📺 বিজ্ঞাপন: ${u.ads_total}\n📅 জয়েন: ${new Date(u.joined).toISOString().slice(0, 10)}\n💼 বাকি ব্যালেন্স: ৳${u.balance}`,
    { reply_markup: { inline_keyboard: [[{ text: '✅ Paid', callback_data: `wd_paid:${w.id}` }, { text: '❌ Reject', callback_data: `wd_rej:${w.id}` }]] } });
  return { ok: true, user: profile(u) };
};

routes['/api/leaderboard'] = async (u) => {
  const all = Object.values(db.users).filter(x => x.refs.length > 0)
    .sort((a, b) => b.refs.length - a.refs.length || a.joined - b.joined);
  const top = all.slice(0, 50).map((x, i) => ({
    rank: i + 1, name: x.first_name, photo: x.photo, refs: x.refs.length, level: levelFor(x.refs.length).lv, me: x.id === u.id,
  }));
  const idx = all.findIndex(x => x.id === u.id);
  return { ok: true, top, me: { rank: idx >= 0 ? idx + 1 : null, refs: u.refs.length, level: levelFor(u.refs.length).lv } };
};

routes['/api/settings'] = async (u, body) => {
  if (body.lang && ['bn', 'en'].includes(body.lang)) u.lang = body.lang;
  if (body.notif && typeof body.notif === 'object') {
    for (const k of ['email', 'push', 'withdraw', 'promo']) if (k in body.notif) u.notif[k] = !!body.notif[k];
  }
  save();
  return { ok: true, user: profile(u) };
};

function publicConfig() {
  return {
    app_name: CFG.APP_NAME, bot: CFG.BOT_USERNAME, miniapp: CFG.MINIAPP_SHORTNAME,
    ad_reward: CFG.AD_REWARD, ad_limit: CFG.AD_DAILY_LIMIT, daily_bonus: CFG.DAILY_BONUS,
    ref_reward: CFG.REF_REWARD, ref_bonus: CFG.REF_BONUS, min_withdraw: CFG.MIN_WITHDRAW, min_refs: CFG.MIN_REFERRALS,
    min_ad_seconds: CFG.MIN_AD_SECONDS,
    channel_url: CFG.CHANNEL ? (CFG.CHANNEL_URL || `https://t.me/${CFG.CHANNEL.replace(/^@/, '')}`) : '',
    support_url: CFG.SUPPORT_URL, tutorial_url: CFG.TUTORIAL_URL, sponsor_url: CFG.SPONSOR_URL, dev: CFG.DEV,
    levels: LEVELS,
  };
}


/* ───────────────────────── Admin panel API (/admin) ───────────────────────── */
const adminSecret = () => CFG.ADMIN_SECRET || db.secret;
function signToken() {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600e3 })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', adminSecret()).update(p).digest('base64url');
}
function checkToken(tok) {
  try {
    const [p, sig] = String(tok || '').split('.');
    if (!p || !sig) return false;
    const exp = crypto.createHmac('sha256', adminSecret()).update(p).digest('base64url');
    const a = Buffer.from(exp), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now();
  } catch (_) { return false; }
}
const loginFails = new Map();
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const sha = x => crypto.createHash('sha256').update(String(x)).digest();

function userRow(u) {
  return {
    id: u.id, name: u.first_name, username: u.username, joined: u.joined, last_active: u.last_active || 0,
    verified: !!u.verified, banned: !!u.banned, balance: u.balance, earned: u.earned,
    ads_done: u.ads_total || 0, ad_starts: u.ad_starts || 0, ad_cancelled: Math.max(0, (u.ad_starts || 0) - (u.ads_total || 0)),
    ads_today: u.ads_today, refs: u.refs.length, referred_by: u.referred_by, sponsor_clicks: u.sponsor_clicks || 0,
  };
}

function computeStats() {
  const users = Object.values(db.users), today = dayKey(), now = Date.now();
  const wd = st => db.withdrawals.filter(w => w.status === st);
  const sum = a => r2(a.reduce((t, w) => t + w.amount, 0));
  const adStarts = users.reduce((t, u) => t + (u.ad_starts || 0), 0);
  const adDone = users.reduce((t, u) => t + (u.ads_total || 0), 0);
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayOf(now - i * 86400e3), d = db.daily[k] || { ad_starts: 0, ad_done: 0, wd_req: 0, active: {} };
    series.push({ day: k, joins: users.filter(u => dayOf(u.joined) === k).length, ad_starts: d.ad_starts, ad_done: d.ad_done,
      ad_cancelled: Math.max(0, d.ad_starts - d.ad_done), active: Object.keys(d.active).length, wd_req: d.wd_req, sponsor_clicks: d.sponsor_clicks || 0 });
  }
  const t = db.daily[today] || { ad_starts: 0, ad_done: 0, active: {} };
  return {
    users: {
      total: users.length, verified: users.filter(u => u.verified).length, unverified: users.filter(u => !u.verified).length,
      banned: users.filter(u => u.banned).length, new_today: users.filter(u => dayOf(u.joined) === today).length,
      active_today: Object.keys(t.active).length, active_7d: users.filter(u => now - (u.last_active || 0) < 7 * 86400e3).length,
      with_referrals: users.filter(u => u.refs.length > 0).length,
    },
    ads: { started: adStarts, completed: adDone, cancelled: Math.max(0, adStarts - adDone), today_started: t.ad_starts, today_completed: t.ad_done,
      today_cancelled: Math.max(0, t.ad_starts - t.ad_done), completion_rate: adStarts ? Math.round(adDone / adStarts * 100) : 0 },
    money: { user_balances: sum(users.map(u => ({ amount: u.balance }))), total_earned: sum(users.map(u => ({ amount: u.earned }))),
      paid: sum(wd('paid')), pending: sum(wd('pending')), rejected: sum(wd('rejected')) },
    withdrawals: { pending: wd('pending').length, paid: wd('paid').length, rejected: wd('rejected').length, total: db.withdrawals.length },
    referrals_total: users.reduce((t2, u) => t2 + u.refs.length, 0),
    sponsor: { clicks: users.reduce((t2, u) => t2 + (u.sponsor_clicks || 0), 0), today: t.sponsor_clicks || 0, users: users.filter(u => (u.sponsor_clicks || 0) > 0).length },
    series,
  };
}

const wdRow = w => {
  const u = db.users[w.uid] || {};
  return { id: w.id, uid: w.uid, name: u.first_name || '', username: u.username || '', method: w.method, account: w.account, amount: w.amount,
    status: w.status, ts: w.ts, done_ts: w.done_ts || 0, refs: (u.refs || []).length };
};

async function adminApi(req, res, url, pathname) {
  if (!CFG.ADMIN_PASSWORD) return sendJson(res, 503, { ok: false, error: 'admin_disabled' });
  const route = pathname.slice('/admin/api/'.length);

  if (route === 'login' && req.method === 'POST') {
    const ip = clientIp(req), now = Date.now();
    const fails = (loginFails.get(ip) || []).filter(t => now - t < 10 * 60e3);
    if (fails.length >= 8) return sendJson(res, 429, { ok: false, error: 'too_many' });
    const body = await readBody(req);
    if (crypto.timingSafeEqual(sha(body.password || ''), sha(CFG.ADMIN_PASSWORD))) { loginFails.delete(ip); return sendJson(res, 200, { ok: true, token: signToken() }); }
    fails.push(now); loginFails.set(ip, fails);
    return sendJson(res, 200, { ok: false, error: 'bad_password' });
  }

  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!checkToken(auth)) return sendJson(res, 401, { ok: false, error: 'auth' });
  const q = url.searchParams;
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (route === 'stats') return sendJson(res, 200, { ok: true, stats: computeStats(), now: Date.now() });

  if (route === 'users') {
    let list = Object.values(db.users);
    const term = (q.get('q') || '').trim().toLowerCase(), filter = q.get('filter') || 'all', sort = q.get('sort') || 'joined';
    if (term) list = list.filter(u => u.id.includes(term) || (u.first_name || '').toLowerCase().includes(term) || (u.username || '').toLowerCase().includes(term));
    if (filter === 'verified') list = list.filter(u => u.verified);
    else if (filter === 'unverified') list = list.filter(u => !u.verified);
    else if (filter === 'banned') list = list.filter(u => u.banned);
    else if (filter === 'active_today') list = list.filter(u => dayOf(u.last_active || 0) === dayKey());
    else if (filter === 'has_refs') list = list.filter(u => u.refs.length > 0);
    const keyf = { joined: u => u.joined, last_active: u => u.last_active || 0, balance: u => u.balance, ads: u => u.ads_total || 0, refs: u => u.refs.length, earned: u => u.earned }[sort] || (u => u.joined);
    list.sort((a, b) => keyf(b) - keyf(a));
    const size = Math.min(100000, Math.max(1, Number(q.get('size')) || 25)), page = Math.max(1, Number(q.get('page')) || 1);
    return sendJson(res, 200, { ok: true, total: list.length, page, size, users: list.slice((page - 1) * size, page * size).map(userRow) });
  }

  if (route === 'user') {
    const u = db.users[String(q.get('id'))];
    if (!u) return sendJson(res, 404, { ok: false, error: 'not_found' });
    const inviter = u.referred_by && db.users[u.referred_by];
    return sendJson(res, 200, { ok: true, user: Object.assign(userRow(u), {
      ad_earn: u.ad_earn, ref_earn: u.ref_earn, task_earn: u.task_earn, bonus_earn: u.bonus_earn, streak: u.streak, bonus_claimed: u.bonus_claimed,
      tasks_done: u.done_tasks.length, lang: u.lang, verified_at: u.verified_at || 0, inviter: inviter ? { id: inviter.id, name: inviter.first_name } : null,
      ref_list: u.refs.slice(-50).reverse(), withdrawals: db.withdrawals.filter(w => w.uid === u.id).map(wdRow).reverse(),
    }) });
  }

  if (route === 'user/ban' && req.method === 'POST') {
    const u = db.users[String(body.id)]; if (!u) return sendJson(res, 404, { ok: false });
    u.banned = !!body.banned; save();
    return sendJson(res, 200, { ok: true, banned: u.banned });
  }

  if (route === 'user/balance' && req.method === 'POST') {
    const u = db.users[String(body.id)]; const d = r2(Number(body.delta));
    if (!u || !Number.isFinite(d) || d === 0) return sendJson(res, 400, { ok: false, error: 'invalid' });
    if (u.balance + d < 0) return sendJson(res, 400, { ok: false, error: 'negative' });
    if (d > 0) credit(u, d, 'bonus'); else u.balance = r2(u.balance + d);
    save();
    return sendJson(res, 200, { ok: true, balance: u.balance });
  }

  if (route === 'withdrawals') {
    const st = q.get('status') || 'all';
    const list = db.withdrawals.filter(w => st === 'all' || w.status === st).slice().reverse().slice(0, 500).map(wdRow);
    return sendJson(res, 200, { ok: true, withdrawals: list });
  }

  if (route === 'withdrawal' && req.method === 'POST') {
    const ok = await settleWithdrawal(null, Number(body.id), body.action === 'paid');
    return sendJson(res, 200, { ok });
  }

  if (route === 'settings') {
    if (req.method === 'POST') {
      const v = body.values || {};
      for (const k in SETTING_KEYS) {
        if (!(k in v)) continue;
        if (SETTING_KEYS[k] === 'n') { const n = Number(v[k]); if (!Number.isFinite(n) || n < 0) return sendJson(res, 400, { ok: false, error: 'bad_' + k }); db.settings[k] = n; }
        else { const t = String(v[k] || '').trim(); if (t && !/^https?:\/\//i.test(t)) return sendJson(res, 400, { ok: false, error: 'bad_' + k }); db.settings[k] = t; }
      }
      applySettings(); save();
    }
    const out = {}; for (const k in SETTING_KEYS) out[k] = CFG[k];
    return sendJson(res, 200, { ok: true, values: out });
  }

  if (route === 'tasks') {
    if (req.method === 'POST') {
      const list = Array.isArray(body.tasks) ? body.tasks : null;
      if (!list) return sendJson(res, 400, { ok: false });
      const seen = new Set(), clean = [];
      for (const t of list) {
        const id = String(t.id || '').trim();
        if (!/^[a-z0-9_]{2,40}$/i.test(id) || seen.has(id)) return sendJson(res, 400, { ok: false, error: 'bad_id', id });
        if (!['telegram', 'youtube', 'whatsapp', 'tiktok'].includes(t.type)) return sendJson(res, 400, { ok: false, error: 'bad_type' });
        const url2 = String(t.url || '').trim();
        if (!/^https?:\/\//i.test(url2)) return sendJson(res, 400, { ok: false, error: 'bad_url', id });
        seen.add(id);
        clean.push({ id, type: t.type, title: String(t.title || '').slice(0, 80), desc: String(t.desc || '').slice(0, 140), reward: Math.max(0, Number(t.reward) || 0),
          url: url2, chat: t.type === 'telegram' ? String(t.chat || '').trim() : undefined, active: t.active !== false });
      }
      fs.writeFileSync(TASKS_FILE, JSON.stringify(clean, null, 2));
      TASKS = clean;
    }
    return sendJson(res, 200, { ok: true, tasks: TASKS });
  }

  return sendJson(res, 404, { ok: false, error: 'not_found' });
}

/* ───────────────────────── HTTP server ───────────────────────── */
/* Layout: normally files live in ./public. If there is no ./public folder (e.g. everything was uploaded flat to GitHub
   from a phone), fall back to the project root — but ONLY these whitelisted files are ever served (never server.js/.env/data). */
const FLAT = !fs.existsSync(path.join(__dirname, 'public'));
const PUBLIC = FLAT ? __dirname : path.join(__dirname, 'public');
const FLAT_ALLOWED = new Set(['index.html', 'admin.html', 'logo.svg', 'favicon.svg', 'icon-192.png']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };

function readBody(req) {
  return new Promise(resolve => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/admin/api/')) return adminApi(req, res, url, pathname);
    if (pathname === '/admin' || pathname === '/admin/') { return fs.readFile(path.join(PUBLIC, 'admin.html'), (e, b) => { if (e) { res.writeHead(404); return res.end('admin.html missing'); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end(b); }); }
    if (pathname === '/api/config') return sendJson(res, 200, publicConfig());
    if (pathname === '/health') return sendJson(res, 200, { ok: true });

    /* Monetag server-to-server postback (optional hardening) */
    if (pathname === '/api/monetag/postback') {
      const q = url.searchParams;
      if (CFG.MONETAG_POSTBACK_SECRET && q.get('secret') !== CFG.MONETAG_POSTBACK_SECRET) return sendJson(res, 403, { ok: false });
      const n = adNonces.get(q.get('ymid') || '');
      const ev = q.get('reward_event_type');
      if (n && (!ev || ev === 'valued')) n.verified = true;
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/') && req.method === 'POST') {
      const route = routes[pathname];
      if (!route) return sendJson(res, 404, { ok: false, error: 'not_found' });
      const auth = authenticate(req);
      if (!auth) return sendJson(res, 401, { ok: false, error: 'auth' });
      if (limited(String(auth.user.id))) return sendJson(res, 429, { ok: false, error: 'rate' });
      const body = await readBody(req);
      const u = getOrCreateUser(auth.user, auth.start_param);
      if (u.banned) return sendJson(res, 200, { ok: false, error: 'banned' });
      return sendJson(res, 200, await route(u, body));
    }

    /* static files */
    const file = pathname === '/' ? '/index.html' : pathname;
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    if (FLAT && (path.dirname(full) !== __dirname || !FLAT_ALLOWED.has(path.basename(full)))) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    });
  } catch (e) {
    console.error('request error', e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'server' });
  }
});

/* ───────────────────────── Telegram bot (long polling) ───────────────────────── */
const isAdmin = id => CFG.ADMIN_IDS.includes(String(id));
const appUrl = tab => `${CFG.WEBAPP_URL}/${tab ? '?tab=' + tab : ''}`;

function welcomeText() {
  return [
    `👋 <b>${esc(CFG.APP_NAME)}</b>-এ আপনাকে স্বাগতম..! 💚`,
    '',
    '💰 সহজ কাজ সম্পন্ন করে টাকা আয় করুন।',
    '',
    CFG.CHANNEL
      ? '📢 অনুগ্রহ করে প্রথমে (Join Channel) বাটনে ক্লিক করে আমাদের চ্যানেলে জয়েন করুন। তারপর (✅ Verify) বাটনে ক্লিক করুন।'
      : '👇 নিচের বাটনে ক্লিক করে শুরু করুন।',
    '',
    `✨ প্রতি বিজ্ঞাপনে ৳${CFG.AD_REWARD} · প্রতি রেফারেলে ৳${CFG.REF_REWARD} · সর্বনিম্ন উইথড্র ৳${CFG.MIN_WITHDRAW} (${CFG.MIN_REFERRALS}টি সফল রেফারেল প্রয়োজন)।`,
  ].join('\n');
}

const verifiedText = () => [
  '✅ আপনার অ্যাকাউন্ট সফলভাবে ভেরিফাই হয়েছে!', '',
  '👇 নিচের প্রয়োজনীয় বাটনে ক্লিক করুন:', '',
  '🚀 Open Bot – কাজ শুরু করতে ক্লিক করুন।', '',
  '🎬 Tutorial Video – কীভাবে কাজ করবেন, তা জানতে ভিডিও দেখুন।', '',
  '💰 Earn – কাজ করে আয় করতে এখানে ক্লিক করুন।', '',
  '💸 Withdraw – আয় করা টাকা তুলতে এখানে ক্লিক করুন।', '',
  '👥 Refer – বন্ধুদের আমন্ত্রণ জানিয়ে বোনাস পেতে এখানে ক্লিক করুন।', '',
  '❓ Help – কোনো সমস্যা হলে এখানে ক্লিক করুন।',
].join('\n');

function mainKeyboard() {
  const rows = [];
  if (CFG.WEBAPP_URL) {
    const wa = tab => ({ web_app: { url: appUrl(tab) } });
    rows.push([{ text: '🚀 Open Bot', ...wa('') }]);
    if (CFG.TUTORIAL_URL) rows.push([{ text: '🎬 Tutorial Video', url: CFG.TUTORIAL_URL }]);
    rows.push([{ text: '💰 Earn', ...wa('earn') }, { text: '💸 Withdraw', ...wa('withdraw') }]);
    const last = [{ text: '👥 Refer', ...wa('refer') }];
    if (CFG.SUPPORT_URL) last.push({ text: '❓ Help', url: CFG.SUPPORT_URL });
    rows.push(last);
  }
  return { inline_keyboard: rows };
}

async function sendWelcome(chatId, tg) {
  const u = getOrCreateUser(tg, '');
  if (u.verified) return notify(chatId, verifiedText(), { reply_markup: mainKeyboard() });
  const chUrl = CFG.CHANNEL_URL || `https://t.me/${CFG.CHANNEL.replace(/^@/, '')}`;
  return notify(chatId, welcomeText(), {
    reply_markup: { inline_keyboard: [[{ text: '📢 Join Channel', url: chUrl }], [{ text: '✅ Verify', callback_data: 'verify' }]] },
  });
}

async function settleWithdrawal(adminChat, id, paid) {
  const say = m => (adminChat ? notify(adminChat, m) : null);
  const w = db.withdrawals.find(x => x.id === id);
  if (!w || w.status !== 'pending') { await say(`#${id} পাওয়া যায়নি বা আগেই প্রসেস হয়েছে।`); return false; }
  const u = db.users[w.uid];
  w.status = paid ? 'paid' : 'rejected'; w.done_ts = Date.now();
  if (!paid && u) u.balance = r2(u.balance + w.amount);     // refund
  save();
  await say(`${paid ? '✅ Paid' : '❌ Rejected'} #${id}`);
  if (u && (!u.notif || u.notif.withdraw)) {
    notify(u.id, paid
      ? `✅ আপনার ৳${w.amount} উইথড্র (${w.method}) সম্পন্ন হয়েছে।`
      : `❌ আপনার ৳${w.amount} উইথড্র রিকোয়েস্টটি বাতিল হয়েছে। টাকা ব্যালেন্সে ফেরত দেওয়া হয়েছে।`);
  }
  return true;
}

async function handleUpdate(up) {
  if (up.message && up.message.text) {
    const m = up.message, text = m.text.trim(), from = m.from;
    if (m.chat.type !== 'private') return;
    if (text === '/myid') return notify(m.chat.id, `🆔 আপনার Telegram ID: <code>${from.id}</code>`);
    if (db.users[String(from.id)] && db.users[String(from.id)].banned) return notify(m.chat.id, '🚫 আপনার অ্যাকাউন্টটি ব্লক করা হয়েছে।');
    if (text.startsWith('/start')) {
      const payload = text.split(/\s+/)[1] || '';
      const mm = /^ref_(\d+)$/.exec(payload);
      if (mm && !db.users[String(from.id)] && mm[1] !== String(from.id)) { db.pendingRef[String(from.id)] = mm[1]; save(); }
      return sendWelcome(m.chat.id, from);
    }
    if (text === '/help') return notify(m.chat.id, 'সাহায্যের জন্য /start লিখুন।' + (CFG.SUPPORT_URL ? '\nসাপোর্ট: ' + CFG.SUPPORT_URL : ''));
    if (isAdmin(from.id)) {
      const [cmd, arg] = text.split(/\s+/);
      if (cmd === '/stats') {
        const users = Object.values(db.users);
        const pend = db.withdrawals.filter(w => w.status === 'pending');
        return notify(m.chat.id, `📊 <b>Stats</b>\n👤 Users: ${users.length}\n✅ Verified: ${users.filter(x => x.verified).length}\n💰 Total user balances: ৳${r2(users.reduce((s, x) => s + x.balance, 0))}\n🕓 Pending withdrawals: ${pend.length} (৳${r2(pend.reduce((s, w) => s + w.amount, 0))})`);
      }
      if (cmd === '/pending') {
        const pend = db.withdrawals.filter(w => w.status === 'pending');
        if (!pend.length) return notify(m.chat.id, 'কোনো পেন্ডিং উইথড্র নেই ✅');
        return notify(m.chat.id, pend.map(w => `#${w.id} · ${w.method} ${w.account} · ৳${w.amount} · uid ${w.uid}`).join('\n') + '\n\n/paid ID  অথবা  /reject ID');
      }
      if (cmd === '/paid' || cmd === '/reject') return settleWithdrawal(m.chat.id, Number(arg), cmd === '/paid');
    }
    return;
  }
  if (up.callback_query) {
    const cq = up.callback_query, from = cq.from, data = cq.data || '';
    if (data === 'verify') {
      const u = getOrCreateUser(from, '');
      if (!u.verified) {
        if (await isMember(CFG.CHANNEL, from.id)) markVerified(u);
        else return tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '❌ আপনি এখনো চ্যানেলে জয়েন করেননি। আগে Join Channel এ ক্লিক করুন।', show_alert: true });
      }
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Verified!' });
      return notify(cq.message.chat.id, verifiedText(), { reply_markup: mainKeyboard() });
    }
    if ((data.startsWith('wd_paid:') || data.startsWith('wd_rej:')) && isAdmin(from.id)) {
      const ok = await settleWithdrawal(cq.message.chat.id, Number(data.split(':')[1]), data.startsWith('wd_paid:'));
      return tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: ok ? 'Done' : 'Already processed' });
    }
    return tgCall('answerCallbackQuery', { callback_query_id: cq.id });
  }
}

async function poll() {
  await tgCall('deleteWebhook', { drop_pending_updates: false });
  const me = await tgCall('getMe');
  if (!me.ok) { console.error('✖ Telegram getMe failed:', me.description, '— check BOT_TOKEN'); return; }
  console.log(`🤖 Bot @${me.result.username} is running`);
  if (CFG.WEBAPP_URL) {
    await tgCall('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open App', web_app: { url: CFG.WEBAPP_URL + '/' } } });
  } else {
    console.warn('⚠ WEBAPP_URL is empty — the bot buttons that open the app will be hidden until you set it.');
  }
  await tgCall('setMyCommands', { commands: [{ command: 'start', description: 'Start' }, { command: 'help', description: 'Help' }, { command: 'myid', description: 'Your Telegram ID' }] });
  if (CFG.ADMIN_IDS.length) notifyAdmins('✅ <b>Cash Flow BD</b> বট চালু হয়েছে। উইথড্র রিকোয়েস্ট এলে এখানে মেসেজ আসবে।');
  let offset = 0;
  for (;;) {
    const r = await tgCall('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) { console.warn('getUpdates:', r.description); await new Promise(s => setTimeout(s, 3000)); continue; }
    for (const up of r.result) {
      offset = up.update_id + 1;
      handleUpdate(up).catch(e => console.error('update error', e));
    }
  }
}

server.listen(CFG.PORT, () => {
  console.log(`🌐 ${CFG.APP_NAME} running on http://localhost:${CFG.PORT}${CFG.DEV ? '   (DEV mode ON — never use in production)' : ''}`);
  if (CFG.BOT_TOKEN) poll().catch(e => console.error('poll crashed', e));
});
