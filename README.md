# Cash Flow BD — Telegram Mini App + Bot + Admin Panel

## ফাইল তালিকা
| ফাইল | কাজ |
|---|---|
| `public/index.html` | ইউজারের মিনি-অ্যাপ (Home · Earn · Refer · Withdraw · Leaderboard · Profile) — Monetag zone 11845830 বসানো আছে |
| `public/admin.html` | **অ্যাডমিন প্যানেল** (`https://আপনার-ডোমেইন/admin`) |
| `server.js` | বট + API + অ্যাডমিন API + ওয়েবসাইট হোস্টিং (কোনো প্যাকেজ ইনস্টল লাগে না, Node 18+) |
| `tasks.default.json` | ডিফল্ট টাস্ক (প্রথমবার চালুর সময় `data/tasks.json`-এ কপি হয়; পরে অ্যাডমিন প্যানেল থেকে বদলানো যায়) |
| `data/` | ডাটাবেস (`db.json`) এখানে জমা হয় — এটাই ব্যাকআপ রাখার ফোল্ডার |
| `.gitignore` | GitHub-এ `.env` ও ডাটা আপলোড ঠেকায় |
| `.env.example` | সব সেটিংস — কপি করে `.env` নাম দিন |
| `public/logo-botfather-640.png` | বটের প্রোফাইল ছবি (`/setuserpic`) |
| `public/bot-description-picture-640x360.png` | বটের স্বাগতম ছবি (`/setdescriptionpic`) — ভিডিওর "What can this bot do?" কার্ডের মতো |

## কোথায় ও কীভাবে রান করবেন

**মনে রাখুন:** এটা একটা Node.js সার্ভার (বট + ওয়েবসাইট + অ্যাডমিন একসাথে)। টেলিগ্রাম মিনি-অ্যাপ শুধু **HTTPS** ঠিকানায় চলে, তাই এমন জায়গায় চালাতে হবে যেখানে ২৪ ঘণ্টা সার্ভার চালু থাকে এবং HTTPS ঠিকানা পাওয়া যায়। নিজের ফোন/কম্পিউটারে চালালে শুধু টেস্ট হবে, সবার জন্য চলবে না।

### পথ A — সহজ (Railway অথবা Render, ফোন থেকেও সম্ভব)
1. github.com-এ অ্যাকাউন্ট খুলে একটি **Private** repository বানান, তারপর "Upload files" দিয়ে zip খুলে সব ফাইল আপলোড করুন (`.env` ফাইল কখনো আপলোড করবেন না)।
2. railway.app (বা render.com) → New Project → **Deploy from GitHub repo** → আপনার repo বেছে নিন। Start command: `node server.js`।
3. **Variables / Environment** এ এগুলো বসান:
   `BOT_TOKEN` (নতুন টোকেন) · `ADMIN_PASSWORD` · `ADMIN_IDS` · `CHANNEL=@CashFlowBD_Official9` · `CHANNEL_URL=https://t.me/CashFlowBD_Official9` · `SUPPORT_URL=https://t.me/CashFlowBD_Official8` · `DATA_DIR=/data`
4. **Volume / Disk যোগ করুন** এবং mount path দিন `/data` — এটা না করলে প্রতিবার রিস্টার্টে ইউজারের সব ডাটা মুছে যাবে। (Render-এ Disk-এর জন্য পেইড প্ল্যান লাগে; ফ্রি প্ল্যানে ডিস্ক টেকে না ও সার্ভার ঘুমিয়ে পড়ে — বট চালু রাখতে ফ্রি প্ল্যান উপযুক্ত নয়।)
5. Networking/Settings থেকে **Generate Domain** চাপুন → `https://xxxx.up.railway.app` জাতীয় ঠিকানা পাবেন। সেটা `WEBAPP_URL` ভ্যারিয়েবলে বসিয়ে **Redeploy** করুন।
6. লগে দেখবেন: `🤖 Bot @CashFlowBD24_Bot is running`। এবার টেলিগ্রামে বটে `/start` দিন।

### GitHub-এ কোড রাখা (ফোন থেকে)
GitHub শুধু কোড জমা রাখে — সার্ভার চালায় না। চালানোর জন্য ওখান থেকে Railway/Render-এ যেতে হবে।
1. github.com → Sign up → উপরে **+** → **New repository** → নাম `cashflowbd` → **Private** → Create।
2. খালি repository-তে **uploading an existing file** (বা Add file → Upload files) চাপুন।
3. এই ৮টি ফাইল একসাথে বেছে দিন (ফোল্ডার লাগবে না — সব একই সারিতে আপলোড করলেই চলবে):
   `server.js` · `package.json` · `tasks.default.json` · `index.html` · `admin.html` · `logo.svg` · `favicon.svg` · `icon-192.png`
4. **Commit changes** চাপুন।
5. ❌ `.env` ফাইল বা বটের টোকেন কখনো GitHub-এ দেবেন না — টোকেন শুধু Railway/Render-এর Variables-এ বসবে।
(কম্পিউটার থেকে করলে zip খুলে পুরো ফোল্ডারটা টেনে এনে আপলোড করলেও একই কাজ হবে।)

### পথ B — নিজের VPS (দীর্ঘমেয়াদে সবচেয়ে নির্ভরযোগ্য)
Ubuntu সার্ভার (Hetzner/DigitalOcean/Contabo ইত্যাদি) + একটি ডোমেইন (DNS A-record সার্ভারের IP-তে)।
```bash
apt update && apt install -y unzip curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2
unzip CashFlowBD.zip && cd CashFlowBD
cp .env.example .env && nano .env        # BOT_TOKEN, WEBAPP_URL, ADMIN_PASSWORD, ADMIN_IDS ... বসান
pm2 start server.js --name cashflowbd && pm2 save && pm2 startup
# HTTPS (Caddy নিজে সার্টিফিকেট আনে):
apt install -y caddy
echo 'yourdomain.com { reverse_proxy localhost:3000 }' > /etc/caddy/Caddyfile
systemctl reload caddy
```
`WEBAPP_URL=https://yourdomain.com` দিন। ব্যাকআপ: `data/` ফোল্ডার নিয়মিত কপি করে রাখুন।

### চালু হওয়ার পর যা করবেন
- `https://আপনার-ঠিকানা/admin` → `ADMIN_PASSWORD` দিয়ে লগইন।
- বটে `/myid` লিখে আইডি নিন → `ADMIN_IDS`-এ বসান → আপনার অ্যাকাউন্ট থেকে বটে `/start` চাপুন (তবেই উইথড্রের মেসেজ পাবেন)।
- বটকে চ্যানেল `@CashFlowBD_Official9` ও গ্রুপ `@CashFlowBD_Community`-র **অ্যাডমিন** বানান।
- BotFather: `/setuserpic`, `/setdescriptionpic`, `/setdescription`।
- ⚠️ একই টোকেন দিয়ে একসাথে **একটাই** সার্ভার চালাবেন (দুই জায়গায় চালালে বট কনফ্লিক্ট করবে)। প্রোডাকশনে কখনো `DEV=1` দেবেন না।

## চালু করার ধাপ
1. **টোকেন রিভোক করুন:** @BotFather → `/revoke` → `@CashFlowBD24_Bot` → নতুন টোকেন। (আগের টোকেন চ্যাটে শেয়ার হয়েছে, তাই পুরোনোটা বাতিল করুন।)
2. `.env.example` কপি করে `.env` বানান এবং ভরুন:
   - `BOT_TOKEN` — নতুন টোকেন
   - `WEBAPP_URL` — যেখানে হোস্ট করবেন সেই HTTPS ঠিকানা
   - `ADMIN_PASSWORD` — অ্যাডমিন প্যানেলের পাসওয়ার্ড (লম্বা ও কঠিন দিন)
   - `ADMIN_IDS` — আপনার টেলিগ্রাম আইডি (নিচে দেখুন)
3. বটকে **অ্যাডমিন** বানান: চ্যানেল `@CashFlowBD_Official9` এবং গ্রুপ `@CashFlowBD_Community`।
4. সার্ভারে `node server.js` চালান (HTTPS লাগবে: VPS / Railway / Render)।
   ⚠️ ডাটা `data/db.json` ফাইলে থাকে। যে হোস্টে ডিস্ক মুছে যায় সেখানে **Persistent Disk** নিন, নইলে ইউজারের ব্যালেন্স হারাবে। নিয়মিত `data/` ফোল্ডারের ব্যাকআপ রাখুন।
5. BotFather: `/setuserpic` (লোগো) · `/setdescriptionpic` (ব্যানার) · `/setdescription` (বিবরণ)।

## উইথড্র হলে বট আপনাকে মেসেজ করবে
- বটকে আপনার আইডি জানতে `/myid` লিখুন → সেই সংখ্যাটা `.env`-এর `ADMIN_IDS`-এ বসান।
- **আপনার অ্যাকাউন্ট থেকে বটে একবার `/start` চাপতে হবে**, নইলে টেলিগ্রাম মেসেজ পাঠাতে দেয় না।
- এরপর যখনই কেউ উইথড্র করবে, বট আপনাকে টেলিগ্রামে ইউজারের নাম, bKash/Nagad নম্বর, পরিমাণ, রেফারেল ও জয়েনের তারিখসহ মেসেজ দেবে — সাথে **✅ Paid / ❌ Reject** বাটন।
- এটা টেলিগ্রাম মেসেজ, মোবাইল SMS নয়। (আসল SMS চাইলে আলাদা SMS গেটওয়ে/API লাগবে।)
- বট চালু হলেও আপনাকে "বট চালু হয়েছে" মেসেজ যায় — এতে বুঝবেন নোটিফিকেশন ঠিক আছে।

## অ্যাডমিন প্যানেল (`/admin`)
- **ড্যাশবোর্ড:** মোট ইউজার, ভেরিফাইড/আনভেরিফাইড, আজ নতুন, আজ একটিভ, ৭ দিনে একটিভ, ব্যান; বিজ্ঞাপন — শুরু / **সম্পন্ন (দেখা)** / **বাতিল**, সফলতার হার; উইথড্র — পেন্ডিং / পরিশোধিত / বাতিল ও টাকার অঙ্ক; ইউজারদের কাছে মোট ব্যালেন্স; গত ১৪ দিনের চার্ট।
- **ইউজার:** নাম, ID, **জয়েনের তারিখ**, শেষ একটিভ, স্ট্যাটাস, বিজ্ঞাপন (সম্পন্ন/শুরু/বাতিল), রেফারেল, ব্যালেন্স। সার্চ, ফিল্টার, সর্টিং, CSV এক্সপোর্ট। ইউজারে ক্লিক করলে বিস্তারিত + **ব্যান/আনব্যান** + ব্যালেন্স পরিবর্তন।
- **উইথড্র:** সব রিকোয়েস্ট; bKash/Nagad-এ টাকা পাঠিয়ে **Paid** চাপুন (ইউজার বটে নোটিফিকেশন পাবে), অথবা **Reject** (টাকা ব্যালেন্সে ফেরত)।
- **টাস্ক:** নতুন টাস্ক যোগ / চালু-বন্ধ / মুছুন।
- **স্পন্সর লিংক:** ড্যাশবোর্ডে মোট ক্লিক, আজকের ক্লিক ও কতজন ক্লিক করেছে দেখা যায়।
- **সেটিংস:** বিজ্ঞাপনের রেট, দৈনিক লিমিট, বোনাস, রেফারেল রেট, সর্বনিম্ন উইথড্র, টিউটোরিয়াল ভিডিও লিংক (দিলে অ্যাপ খুললে ভিডিওর মতো পপআপ আসে), সাপোর্ট লিংক — সঙ্গে সঙ্গে কার্যকর।
- "বাতিল বিজ্ঞাপন" = বিজ্ঞাপন শুরু হয়েছিল কিন্তু ইউজার সম্পূর্ণ দেখেনি। সব তারিখ বাংলাদেশ সময়।
- লগইন ৮ বার ভুল হলে ১০ মিনিটের জন্য ব্লক হয়। সেশন ১২ ঘণ্টার।

## স্পন্সর্ড কার্ড (Adsterra Direct Link)
- অ্যাপের Home পেজের নিচে "বিজ্ঞাপন / SPONSORED" লেবেলসহ একটি কার্ড আছে; চাপলে আপনার Adsterra লিংক খোলে।
- লিংক বদলাতে বা কার্ড লুকাতে: অ্যাডমিন প্যানেল → সেটিংস → "স্পন্সর কার্ডের লিংক" (ফাঁকা রাখলে কার্ড লুকায়) অথবা `.env`-এ `SPONSOR_URL`।
- এই কার্ডে ক্লিক করলে ইউজারকে কোনো টাকা দেওয়া হয় না — ইচ্ছাকৃত। Adsterra সাধারণত ইনসেনটিভাইজড (টাকার বিনিময়ে ক্লিক করানো) ট্রাফিক নিষিদ্ধ করে; নিয়ম ভাঙলে অ্যাকাউন্ট ব্যান হতে পারে। টাকা দেওয়া রিওয়ার্ড শুধু Monetag-এর রিওয়ার্ডেড বিজ্ঞাপনে আছে। নিজের অ্যাকাউন্টের শর্ত একবার দেখে নিন।

## লোকাল টেস্ট
`DEV=1 ADMIN_PASSWORD=test node server.js` → অ্যাপ: `http://localhost:3000/?dev=123` · অ্যাডমিন: `http://localhost:3000/admin`
(`DEV=1` শুধু টেস্টের জন্য — প্রোডাকশনে কখনো নয়।)

## নিরাপত্তা ও ন্যায্যতা
- ইউজার Telegram-এর সাইনড `initData` দিয়ে যাচাই হয়; ব্যালেন্স শুধু সার্ভারে থাকে।
- বিজ্ঞাপন: সার্ভার টাইমার + একবার-ব্যবহারযোগ্য nonce + দৈনিক লিমিট। আরও কঠোর করতে Monetag **Postback** চালু করুন:
  `https://YOUR_DOMAIN/api/monetag/postback?ymid={ymid}&reward_event_type={reward_event_type}&secret=YOUR_SECRET`
  এবং `.env`-এ `MONETAG_POSTBACK_SECRET` + `REQUIRE_POSTBACK=1` (macro নাম Monetag ডকুমেন্টেশন থেকে মিলিয়ে নিন)।
- YouTube/WhatsApp/TikTok টাস্ক ১৫ সেকেন্ড টাইমারে যাচাই হয় (বট দিয়ে আসল সাবস্ক্রিপশন যাচাই সম্ভব নয়)। Telegram টাস্ক `getChatMember` দিয়ে সত্যিকারভাবে যাচাই হয়।
- **রেট নিজের সামর্থ্য অনুযায়ী দিন।** ভিডিওর ডিফল্ট (৳20/বিজ্ঞাপন, ৳25/রেফার) রাখা আছে, কিন্তু বিজ্ঞাপন নেটওয়ার্ক প্রতি ভিউয়ে সাধারণত খুবই সামান্য দেয়। যে রেট সত্যিই পরিশোধ করতে পারবেন সেটা অ্যাডমিন প্যানেলের সেটিংসে বসান এবং সব উইথড্র সময়মতো পরিশোধ করুন।
