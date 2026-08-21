# Docker Local & Private Registry Monitor

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Engine-blue.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](#)

Aplikasi web monitoring modern dan intuitif untuk memantau lingkungan Docker lokal serta repositori pada private Docker Registry V2 secara real-time.

---

## 🚀 Fitur Utama

- **Monitoring Local Docker Images & System Disk Usage**: Menampilkan daftar image lokal dan ringkasan penggunaan disk sistem melalui perintah `docker system df`.
- **Explorer Docker Registry V2**: Penjelajah katalog repositori (Catalog Repository) dan pemeriksa tag (Tag Inspector).
- **Perhitungan Total Ukuran Disk Registry**: Perhitungan total penggunaan disk registry dengan metode deduplikasi layer/blob secara akurat.
- **Informasi Detail per Tag**: Menampilkan tanggal push, ukuran image manifest/OCI index, dan digest lengkap.
- **Generator Perintah CLI Interaktif**: Otomatisasi pembentukan perintah CLI (`docker build`, `docker tag`, `docker push`, `docker pull`) dilengkapi tombol salin (*Copy to Clipboard*).
- **Manajemen Konfigurasi Terpusat**: Pengaturan fleksibel via file lingkungan `.env`.

---

## 📋 Prasyarat Sistem

Sebelum menjalankan aplikasi, pastikan sistem Anda memenuhi persyaratan berikut:

- **Node.js**: Versi v18.0.0 atau yang lebih baru.
- **Docker Engine / Docker CLI**: Opsional, dibutuhkan untuk monitoring gambar lokal.
- **Akses Docker Registry V2**: Akses jaringan ke Docker Registry V2 target (Default: `http://localhost:5000`).

---

## 🛠️ Cara Instalasi & Menjalankan Aplikasi

Ikuti langkah-langkah berikut untuk menginstal dan menjalankan aplikasi:

1. **Instalasi Dependensi**
   ```bash
   npm install
   ```

2. **Konfigurasi Environment File**
   Salin file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   # Atau di Windows PowerShell:
   # Copy-Item .env.example .env
   ```

3. **Jalankan Aplikasi**
   ```bash
   npm start
   ```

4. **Akses Dashboard**
   Buka peramban (browser) Anda dan akses alamat berikut:
   ```text
   http://localhost:3000
   ```

---

## ⚙️ Konfigurasi Environment Variables (`.env`)

Aplikasi ini menggunakan file `.env` untuk menyimpan variabel konfigurasi server dan target registry:

| Variabel | Deskripsi | Default |
| :--- | :--- | :--- |
| `PORT` | Port tempat aplikasi web Express berjalan | `3000` |
| `DEFAULT_REGISTRY_URL` | URL target private Docker Registry V2 | `http://localhost:5000` |
| `HTTP_TIMEOUT` | Batas waktu (timeout) permintaan HTTP ke registry dalam milidetik | `10000` |
| `EXEC_MAX_BUFFER` | Ukuran buffer maksimum untuk eksekusi perintah CLI (`child_process`) dalam bytes | `10485760` (10MB) |
| `TARGET_ARCH` | Target arsitektur spesifik saat inspect manifest (contoh: `amd64`, `arm64`) | `amd64` |

---

## 📡 Struktur API Backend

Aplikasi ini menyediakan REST API internal untuk kebutuhan pemantauan dan interaksi dengan Docker lokal maupun registry:

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/config` | Mendapatkan konfigurasi aplikasi (termasuk default URL registry). |
| `GET` | `/api/images` | Mengambil daftar Docker image yang tersimpan di lingkungan lokal. |
| `DELETE` | `/api/images/:id` | Menghapus Docker image lokal berdasarkan ID atau nama tag. |
| `GET` | `/api/system/info` | Mendapatkan informasi pemakaian disk sistem lokal (`docker system df`). |
| `GET` | `/api/registry/catalog` | Mengambil daftar repositori dari Docker Registry V2 (`/_catalog`). |
| `GET` | `/api/registry/tags` | Mengambil daftar tag dan metadata detail dari repositori tertentu. |
| `GET` | `/api/registry/size` | Menghitung total ukuran penggunaan disk registry dengan deduplikasi layer/blob. |

---

## 🚀 Panduan Deployment Production

Berikut adalah berbagai opsi deployment untuk menjalankan aplikasi di lingkungan production:

### 1. Deployment Menggunakan PM2 (Process Manager)

PM2 adalah process manager untuk aplikasi Node.js yang memungkinkan aplikasi terus berjalan di background, melakukan restart otomatis saat terjadi crash, serta mengkonfigurasi auto-start saat OS/server reboot.

#### a. Instalasi PM2
Instal PM2 secara global menggunakan npm:
```bash
npm install -g pm2
```

#### b. Menjalankan Aplikasi dengan PM2
Jalankan aplikasi `server.js` dengan memberikan nama proses:
```bash
pm2 start server.js --name "docker-monitor"
```

#### c. Manajemen Service PM2
Berikut adalah perintah-perintah utama untuk mengelola service PM2:
- **Melihat status aplikasi**: `pm2 status`
- **Melihat log aplikasi**: `pm2 logs docker-monitor`
- **Merestart aplikasi**: `pm2 restart docker-monitor`
- **Menghentikan aplikasi**: `pm2 stop docker-monitor`

#### d. Konfigurasi Auto Startup saat Server Reboot
Untuk memastikan PM2 dan aplikasi otomatis berjalan kembali setelah server/OS reboot:
```bash
pm2 startup
pm2 save
```
> *Jalankan perintah yang disarankan oleh output `pm2 startup` di terminal Anda.*

---

### 2. Contoh Konfigurasi PM2 Ecosystem File (`ecosystem.config.js`)

Untuk pengelolaan konfigurasi production yang lebih rapi dan terstruktur, buat file `ecosystem.config.js` di direktori utama proyek:

```javascript
module.exports = {
  apps: [
    {
      name: "docker-monitor",
      script: "./server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DEFAULT_REGISTRY_URL: "http://localhost:5000",
        HTTP_TIMEOUT: 10000,
        EXEC_MAX_BUFFER: 10485760,
        TARGET_ARCH: "amd64"
      }
    }
  ]
};
```

Untuk menjalankan aplikasi menggunakan ecosystem file:
```bash
pm2 start ecosystem.config.js
```

---

### 3. Konfigurasi Reverse Proxy Nginx (Opsional)

Menggunakan Nginx sebagai Reverse Proxy direkomendasikan di lingkungan production untuk mengarahkan lalu lintas dari port HTTP (80) atau HTTPS (443) ke port internal aplikasi (`http://127.0.0.1:3000`).

Contoh konfigurasi Server Block Nginx (`/etc/nginx/sites-available/docker-monitor`):

```nginx
server {
    listen 80;
    server_name docker-monitor.local; # Ganti dengan domain atau IP public server Anda

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan konfigurasi dan muat ulang Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/docker-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 4. Deployment Menggunakan Docker / Docker Compose (Opsional)

Aplikasi juga dapat dijalankan dalam kontainer Docker.

#### Contoh `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

ENV PORT=3000     DEFAULT_REGISTRY_URL=http://localhost:5000

CMD ["npm", "start"]
```

#### Menjalankan Kontainer dengan `docker run`:
```bash
# Build image
docker build -t docker-monitor:latest .

# Jalankan container
docker run -d   --name docker-monitor   -p 3000:3000   -v /var/run/docker.sock:/var/run/docker.sock   docker-monitor:latest
```
> *Catatan: Binding socket `/var/run/docker.sock` diperlukan agar aplikasi dapat memantau Docker engine lokal host.*
