# chatgpt-auto-image

Automation pribadi untuk semi-otomatis generate gambar lewat ChatGPT Plus web UI, dikontrol dari n8n melalui webhook Express.

Proyek ini sengaja dibuat konservatif:

- Tidak memakai endpoint internal/private ChatGPT.
- Tidak mengambil cookie/token untuk request manual.
- Tidak bypass limit, captcha, login, atau verifikasi.
- Tidak multi-account.
- Tidak paralel.
- Hanya satu browser session persistent, visible browser, `headless: false`.
- Worker pause otomatis dan mengirim notifikasi jika mendeteksi limit, captcha, login ulang, verifikasi, network error, submit disabled terlalu lama, atau generation timeout.

## Struktur Folder

```text
.
├── src/
│   ├── chatgptAutomation.ts
│   ├── config.ts
│   ├── errors.ts
│   ├── index.ts
│   ├── logger.ts
│   ├── login.ts
│   ├── notifier.ts
│   ├── server.ts
│   ├── store.ts
│   ├── types.ts
│   └── worker.ts
├── data/
│   ├── events.log
│   └── jobs.json
├── browser-profile/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── tsconfig.json
```

`data/` dan `browser-profile/` dibuat/mount sebagai folder lokal. Jangan commit folder itu karena berisi status queue, log, dan session browser.

## Install Lokal

Syarat:

- Node.js 20+
- Browser dependencies untuk Playwright

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Server berjalan di:

```text
http://localhost:3000
```

## Login Pertama Kali ke ChatGPT

Login dilakukan manual di browser visible. Session disimpan di `./browser-profile`.

```bash
cp .env.example .env
npm run login
```

Browser akan membuka `https://chatgpt.com/`. Login seperti biasa. Jika ada verifikasi/captcha, selesaikan sendiri secara manual. Setelah halaman ChatGPT siap dipakai, kembali ke terminal dan tekan `Ctrl+C`.

Setelah itu jalankan server:

```bash
npm run dev
```

Jika session expired di kemudian hari, worker akan pause dengan reason `login_required`. Jalankan lagi `npm run login`, cek manual di browser, lalu panggil:

```bash
curl -X POST http://localhost:3000/resume
```

## API Endpoints

### POST /enqueue

Menambahkan job baru ke queue.

```bash
curl -X POST http://localhost:3000/enqueue \
  -H "content-type: application/json" \
  -d '{
    "jobId": "image-001",
    "prompt": "Create a square watercolor illustration of a quiet desk with warm morning light."
  }'
```

Response sukses: HTTP `202`.

### GET /status

Melihat status queue dan worker.

```bash
curl http://localhost:3000/status
```

### POST /pause

Pause manual. Job queued tetap tersimpan.

```bash
curl -X POST http://localhost:3000/pause
```

### POST /resume

Melanjutkan worker setelah Anda cek manual.

```bash
curl -X POST http://localhost:3000/resume
```

### GET /jobs

Melihat semua job dan statusnya.

```bash
curl http://localhost:3000/jobs
```

### POST /clear-completed

Menghapus job dengan status `completed` dan `manual_review_needed`.

```bash
curl -X POST http://localhost:3000/clear-completed
```

## Connect dari n8n

Gunakan node **HTTP Request**:

- Method: `POST`
- URL: `http://host.docker.internal:3000/enqueue` jika n8n berjalan di Docker Desktop
- URL: `http://localhost:3000/enqueue` jika n8n berjalan di host yang sama
- Send Body: `JSON`
- Headers: `content-type: application/json`

Contoh body:

```json
{
  "jobId": "{{$json.id}}",
  "prompt": "{{$json.prompt}}"
}
```

Jika n8n mengirim literal `{{$json.id}}` sebagai `jobId`, berarti field body belum berada di expression mode. Gunakan salah satu cara ini:

Body sebagai expression penuh:

```js
={{
  {
    jobId: $json.id,
    prompt: $json.prompt
  }
}}
```

Atau jika memakai Body Parameters, set value masing-masing field sebagai expression:

```text
jobId  ={{$json.id}}
prompt ={{$json.prompt}}
```

Pastikan `jobId` unik. Jika `jobId` sudah ada, server mengembalikan HTTP `409`.

## Konfigurasi Env

Salin `.env.example` ke `.env`.

```env
PORT=3000
DATA_DIR=./data
BROWSER_PROFILE_DIR=./browser-profile
CHATGPT_URL=https://chatgpt.com/
MIN_DELAY_SECONDS=60
MAX_DELAY_SECONDS=300
GENERATION_TIMEOUT_MS=900000
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
```

Delay antar job random di antara `MIN_DELAY_SECONDS` dan `MAX_DELAY_SECONDS`. Defaultnya 60 sampai 300 detik.

`JOB_DONE_STATUS` default ke `manual_review_needed`, karena automation ini tidak mengunduh atau memvalidasi file output. Jika Anda ingin status akhirnya `completed`, set:

```env
JOB_DONE_STATUS=completed
```

## Telegram Notification

1. Buat bot lewat Telegram `@BotFather`.
2. Ambil token bot.
3. Kirim pesan ke bot dari akun Anda.
4. Ambil chat ID, misalnya dengan membuka:

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

5. Isi `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_CHAT_ID=123456789
```

Jika token dan chat ID tersedia, `notify(message)` akan mengirim pesan ke Telegram.

## Discord Notification

1. Buka Discord channel.
2. Channel Settings > Integrations > Webhooks.
3. Buat webhook dan copy URL.
4. Isi `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Jika webhook tersedia, `notify(message)` akan mengirim pesan ke Discord.

Jika Telegram dan Discord tidak dikonfigurasi, notification fallback ke `console.log`.

## Docker

Build dan jalankan:

```bash
cp .env.example .env
docker compose up --build
```

Compose expose port `3000` dan mount:

- `./data:/app/data`
- `./browser-profile:/app/browser-profile`

Catatan penting: browser berjalan `headless: false`, jadi container butuh akses display GUI. Di Linux X11, compose sudah mount `/tmp/.X11-unix` dan meneruskan `DISPLAY`. Anda mungkin perlu mengizinkan akses lokal:

```bash
echo "$DISPLAY"
xhost +SI:localuser:root
docker compose down
docker compose up --build
```

Jika `echo "$DISPLAY"` kosong, jalankan command dari terminal di desktop session, bukan dari SSH/headless shell. Untuk beberapa distro lama, `xhost +local:docker` atau `xhost +local:` mungkin diperlukan.

Untuk macOS/Windows, gunakan XQuartz/VcXsrv atau jalankan mode lokal Node.js agar browser visible lebih sederhana.

### Troubleshooting: Missing X Server

Error seperti ini berarti browser visible tidak bisa membuka jendela dari dalam container:

```text
Looks like you launched a headed browser without having a XServer running.
Authorization required, but no authorization protocol specified
Missing X server or $DISPLAY
```

Perbaikan cepat di Linux desktop:

```bash
cd /path/to/chatgpt-auto-image
echo "$DISPLAY"
xhost +SI:localuser:root
docker compose down
docker compose up --build
```

Setelah container jalan lagi, queue masih `paused` karena error sebelumnya. Cek status lalu resume:

```bash
curl http://localhost:3000/status
curl -X POST http://localhost:3000/resume
```

Job yang sudah `stopped` tidak otomatis diulang. Kirim job baru dari n8n dengan `jobId` baru setelah browser sudah bisa tampil.

### Troubleshooting: Permission denied di data/events.log

Error seperti ini biasanya muncul setelah sebelumnya menjalankan Docker, lalu menjalankan lokal dengan `npm run dev`:

```text
Error: EACCES: permission denied, open './data/events.log'
```

Penyebabnya: folder `data/` atau `browser-profile/` dibuat/ditulis oleh container sebagai user `root`, sehingga user Linux biasa tidak bisa menulis.

Perbaikan:

```bash
cd /path/to/chatgpt-auto-image
sudo chown -R "$USER:$USER" data browser-profile
chmod -R u+rwX data browser-profile
npm run dev
```

Jika ingin cek ownership:

```bash
ls -ld data browser-profile
ls -l data
```

Output idealnya menunjukkan user kamu sendiri, bukan `root root`.

## Cara Kerja Worker

1. n8n kirim `POST /enqueue`.
2. Job disimpan ke `./data/jobs.json`.
3. Worker memproses hanya satu job.
4. Playwright membuka ChatGPT web UI dengan persistent browser profile.
5. Prompt dipaste ke input ChatGPT dan disubmit lewat UI.
6. Worker menunggu konservatif sampai UI terlihat settle.
7. Status job menjadi `manual_review_needed` atau `completed`, sesuai `JOB_DONE_STATUS`.
8. Sebelum job berikutnya, worker menunggu random delay 60-300 detik secara default.

Semua event ditulis sebagai JSON lines ke:

```text
./data/events.log
```

## Kondisi Stop Otomatis

Worker pause, job diberi status `stopped`/`failed`, dan notification dikirim jika mendeteksi:

- limit, rate limit, usage cap, message cap
- captcha
- "verify you are human" atau human verification
- login required
- network error
- submit button disabled terlalu lama
- generation timeout
- automation error lain

Worker tidak retry otomatis. Setelah Anda cek manual, panggil `POST /resume`.

## Safety Notes

- Jangan gunakan untuk bypass limit.
- Jangan jalankan paralel.
- Jangan pakai multi-account.
- Jangan menjalankan 24/7.
- Stop saat captcha, limit, login ulang, atau verifikasi muncul.
- Jangan ubah script untuk mengambil token/cookie atau memanggil endpoint internal ChatGPT.
- Gunakan hanya untuk project pribadi.
- Hormati aturan dan batas penggunaan layanan yang Anda pakai.

## Development

```bash
npm run typecheck
npm run build
npm run dev
```

Automation web UI bisa rusak jika UI ChatGPT berubah. Kalau itu terjadi, worker akan pause dengan error daripada mencoba bypass.
