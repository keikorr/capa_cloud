/**
 * Capaxero Cloud — Release publicado do APK do Totem
 *
 * Único lugar que lê public/downloads/app-version.json e calcula o sha256 do APK. Extraído de
 * routes/api.js (GET /api/v1/app/version) para ser reaproveitado também pela rota que dispara
 * a atualização remota via WebSocket (routes/admin.js) — as duas precisam exatamente dos mesmos
 * dados (downloadUrl, sha256, versionCode) e não podem divergir.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DOWNLOAD_DIR = path.join(__dirname, '../public/downloads');
const MANIFEST_PATH = path.join(APP_DOWNLOAD_DIR, 'app-version.json');

// sha256 de um APK de ~50MB trava o event loop se lido inteiro pra memória (Buffer) — streaming
// mantém o servidor respondendo outras requisições enquanto o hash é calculado.
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const cache = { mtimeMs: 0, sha256: null };

/**
 * Lê o manifesto + APK publicados e devolve os dados que tanto GET /api/v1/app/version quanto
 * o disparo de atualização remota precisam. req é usado só para montar a downloadUrl absoluta
 * (host/proto da própria requisição — funciona atrás de túnel/proxy sem configuração extra).
 *
 * Lança Error com .statusCode quando o manifesto ou o arquivo do APK não existem, para o
 * chamador decidir o corpo da resposta HTTP.
 */
async function getPublishedRelease(req) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    const err = new Error('Nenhuma versão do aplicativo publicada no servidor.');
    err.statusCode = 404;
    throw err;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const apkName = manifest.apkFile || 'capaxero-totem.apk';
  const apkPath = path.join(APP_DOWNLOAD_DIR, apkName);

  if (!fs.existsSync(apkPath)) {
    const err = new Error(`Manifesto aponta para "${apkName}", mas o arquivo não está em public/downloads.`);
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(apkPath);

  if (cache.mtimeMs !== stat.mtimeMs || !cache.sha256) {
    cache.sha256 = await sha256OfFile(apkPath);
    cache.mtimeMs = stat.mtimeMs;
  }

  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  return {
    versionCode: Number(manifest.versionCode) || 0,
    versionName: manifest.versionName || '0.0.0',
    notes: manifest.notes || '',
    downloadUrl: `${proto}://${host}/downloads/${encodeURIComponent(apkName)}`,
    sizeBytes: stat.size,
    sha256: cache.sha256,
    publishedAt: stat.mtime.toISOString()
  };
}

/**
 * Reescreve o manifesto após um upload novo pelo painel. Invalida o cache de hash — o próximo
 * getPublishedRelease recalcula, já que o arquivo mudou de nome/conteúdo.
 */
function publishRelease({ versionCode, versionName, notes, apkFile }) {
  const manifest = {
    versionCode: Number(versionCode),
    versionName: String(versionName),
    apkFile,
    notes: notes || ''
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  cache.mtimeMs = 0;
  cache.sha256 = null;
  return manifest;
}

function getCurrentManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { APP_DOWNLOAD_DIR, getPublishedRelease, publishRelease, getCurrentManifest };
