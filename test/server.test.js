const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = 19000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let dataRoot;
let server;

async function request(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-test-'));
  await fs.promises.writeFile(path.join(dataRoot, 'jobs.json'), JSON.stringify({
    scraped_at: '2026-08-30T10:00:00.000Z',
    jobs: [{
      source: 'InfoJobs',
      source_id: 'test-1',
      title: 'Oferta de prueba',
      company: 'Empresa',
      description: 'Descripción',
      url: 'https://www.infojobs.net/test/of-itest-1',
      country: 'España',
      countries: ['España'],
      location: 'Girona',
      budget_eur_min: null,
      budget_eur_max: null,
      published_at: '2026-08-30T09:00:00.000Z',
    }],
  }));
  server = spawn(process.execPath, ['web/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, DATA_DIR: dataRoot, WEB_TRABAJOS_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/jobs`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw lastError || new Error('El servidor de prueba no arrancó');
});

test.after(async () => {
  if (server && !server.killed) server.kill('SIGTERM');
  await fs.promises.rm(dataRoot, { recursive: true, force: true });
});

test('carga y normaliza trabajos', async () => {
  const { response, body } = await request('/api/jobs');
  assert.equal(response.status, 200);
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].job_key, 'InfoJobs:test-1');
  assert.equal(body.jobs[0].favorite, false);
});

test('aplica cabeceras de seguridad a la web y la API', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);
  const api = await fetch(`${baseUrl}/api/jobs`);
  assert.equal(api.headers.get('referrer-policy'), 'no-referrer');
});

test('valida el identificador antes de consultar el detalle de Empléate', async () => {
  const { response, body } = await request('/api/empleate-detail?id=no-valido');
  assert.equal(response.status, 502);
  assert.match(body.error, /identificador/);
});

test('rechaza URLs avanzadas ajenas o con protocolos inseguros', async () => {
  for (const url of ['https://example.com/trabajos', 'javascript:alert(1)', 'http://www.infojobs.net/ofertas']) {
    const { response, body } = await request('/api/search/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searches: [{ url }] }),
    });
    assert.equal(response.status, 400);
    assert.match(body.error, /plataforma compatible/);
  }
});

test('valida la URL antes de consultar el detalle de Tecnoempleo', async () => {
  const { response, body } = await request('/api/tecnoempleo-detail?url=https%3A%2F%2Fexample.com%2Foferta');
  assert.equal(response.status, 502);
  assert.match(body.error, /Tecnoempleo/);
});

test('valida la URL antes de consultar el detalle de Job Today', async () => {
  const response = await fetch(`${baseUrl}/api/jobtoday-detail?url=${encodeURIComponent('https://example.com/es/trabajo/oferta')}`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /Job Today/);
});

test('valida la URL antes de consultar el detalle de Infoempleo', async () => {
  const { response, body } = await request('/api/infoempleo-detail?url=https%3A%2F%2Fexample.com%2Foferta');
  assert.equal(response.status, 502);
  assert.match(body.error, /Infoempleo/);
});

test('valida la URL antes de consultar el detalle de Eurofirms', async () => {
  const { response, body } = await request('/api/eurofirms-detail?url=https%3A%2F%2Fexample.com%2Foferta');
  assert.equal(response.status, 502);
  assert.match(body.error, /Eurofirms/);
});

test('valida la URL antes de consultar el detalle de Infofeina', async () => {
  const { response, body } = await request('/api/infofeina-detail?url=https%3A%2F%2Fexample.com%2Foferta');
  assert.equal(response.status, 502);
  assert.match(body.error, /Infofeina/);
});

test('valida la URL antes de consultar el detalle de Feina Activa', async () => {
  const { response, body } = await request('/api/feinaactiva-detail?url=https%3A%2F%2Fexample.com%2Foferta');
  assert.equal(response.status, 502);
  assert.match(body.error, /Feina Activa/);
});

test('guarda y recupera favoritos con URL sin convertir salarios desconocidos en cero', async () => {
  const job = (await request('/api/jobs')).body.jobs[0];
  const saved = await request('/api/jobs/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: job.job_key, favorite: true, job }),
  });
  assert.equal(saved.response.status, 200);
  const favorites = await request('/api/jobs/favorites');
  assert.equal(favorites.body.jobs.length, 1);
  assert.equal(favorites.body.jobs[0].url, job.url);
  assert.equal(favorites.body.jobs[0].budget_eur_min, null);
  assert.equal(favorites.body.jobs[0].budget_eur_max, null);
  assert.ok(Number.isFinite(Date.parse(favorites.body.jobs[0].saved_at)));
  assert.equal(favorites.body.jobs[0].link_status, 'unknown');

  const currentDocument = JSON.parse(await fs.promises.readFile(path.join(dataRoot, 'jobs.json'), 'utf8'));
  currentDocument.jobs[0].title = 'Oferta de prueba actualizada';
  await fs.promises.writeFile(path.join(dataRoot, 'jobs.json'), JSON.stringify(currentDocument));
  const refreshedFavorites = await request('/api/jobs/favorites');
  assert.equal(refreshedFavorites.body.jobs[0].title, 'Oferta de prueba actualizada');
});

test('limpia favoritos rotos o antiguos solo cuando se solicita', async () => {
  const favoriteFile = path.join(dataRoot, 'favorite_jobs.json');
  const baseJob = (await request('/api/jobs')).body.jobs[0];
  const broken = { ...baseJob, job_key: 'InfoJobs:roto', title: 'Roto', saved_at: new Date().toISOString(), link_status: 'broken' };
  const old = { ...baseJob, job_key: 'InfoJobs:antiguo', title: 'Antiguo', saved_at: '2020-01-01T00:00:00.000Z', link_status: 'unknown' };
  await fs.promises.writeFile(favoriteFile, JSON.stringify({ keys: [broken.job_key, old.job_key], jobs: [broken, old] }));
  const cleanedBroken = await request('/api/jobs/favorites/clean', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'broken' }),
  });
  assert.equal(cleanedBroken.body.removed, 1);
  const cleanedOld = await request('/api/jobs/favorites/clean', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'old' }),
  });
  assert.equal(cleanedOld.body.removed, 1);
  assert.equal((await request('/api/jobs/favorites')).body.jobs.length, 0);
});

test('rechaza favoritos sin datos de la oferta', async () => {
  const result = await request('/api/jobs/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'InfoJobs:incompleto', favorite: true }),
  });
  assert.equal(result.response.status, 400);
});

test('persiste vistos y perfiles de búsqueda', async () => {
  const seen = await request('/api/jobs/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'InfoJobs:test-1', seen: true }),
  });
  assert.equal(seen.response.status, 200);
  assert.equal((await request('/api/jobs')).body.jobs[0].seen, true);

  const savedProfile = await request('/api/search-profiles/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { name: 'Prueba', infojobsSearches: [{ keyword: 'it', city: 'Girona' }] } }),
  });
  assert.equal(savedProfile.response.status, 200);
  assert.equal((await request('/api/search-profiles')).body.profiles[0].name, 'Prueba');
  const seenDocument = JSON.parse(await fs.promises.readFile(path.join(dataRoot, 'seen_jobs.json'), 'utf8'));
  assert.equal(seenDocument.retention_months, 6);
  assert.equal(seenDocument.entries[0].key, 'InfoJobs:test-1');
  assert.ok(Number.isFinite(Date.parse(seenDocument.entries[0].seen_at)));
});

test('elimina vistos con más de seis meses al actualizar el archivo', async () => {
  await fs.promises.writeFile(path.join(dataRoot, 'seen_jobs.json'), JSON.stringify({
    entries: [
      { key: 'InfoJobs:antiguo', seen_at: '2020-01-01T00:00:00.000Z' },
      { key: 'InfoJobs:reciente', seen_at: new Date().toISOString() },
    ],
  }));
  const saved = await request('/api/jobs/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'InfoJobs:nuevo', seen: true }),
  });
  assert.equal(saved.response.status, 200);
  const document = JSON.parse(await fs.promises.readFile(path.join(dataRoot, 'seen_jobs.json'), 'utf8'));
  assert.deepEqual(document.entries.map(item => item.key), ['InfoJobs:nuevo', 'InfoJobs:reciente']);
});
