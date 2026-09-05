#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const host = '0.0.0.0';
const port = Number(process.env.WEB_TRABAJOS_PORT || 8085);
const root = __dirname;
const projectRoot = path.join(root, '..');
const dataRoot = process.env.DATA_DIR || projectRoot;
const dataFile = path.join(dataRoot, 'jobs.json');
const seenJobsFile = path.join(dataRoot, 'seen_jobs.json');
const favoriteJobsFile = path.join(dataRoot, 'favorite_jobs.json');
const searchProfilesFile = path.join(dataRoot, 'search_profiles.json');
const infoJobsScraper = path.join(projectRoot, 'scrape_infojobs.js');
const combinedSearch = path.join(projectRoot, 'search_jobs.js');
const { parseDetail: parseTecnoempleoDetail } = require('../scrape_tecnoempleo');
const { parseDetail: parseJobTodayDetail } = require('../scrape_jobtoday');
const { parseDetail: parseInfoempleoDetail } = require('../scrape_infoempleo');
const { parseDetail: parseEurofirmsDetail } = require('../scrape_eurofirms');
const { parseDetail: parseInfofeinaDetail } = require('../scrape_infofeina');
const { parseDetail: parseFeinaActivaDetail } = require('../scrape_feinaactiva');
const refreshState = {
  running: false,
  target: null,
  startedAt: null,
  finishedAt: null,
  message: 'Listo para actualizar',
  error: null,
  warning: null,
};
const locationCache = new Map();
const infoJobsDetailCache = new Map();
const empleateDetailCache = new Map();
const tecnoempleoDetailCache = new Map();
const jobTodayDetailCache = new Map();
const infoempleoDetailCache = new Map();
const eurofirmsDetailCache = new Map();
const infofeinaDetailCache = new Map();
const feinaActivaDetailCache = new Map();

const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/favicon.png', ['favicon.png', 'image/png']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function sendFile(response, filePath, contentType) {
  fs.readFile(filePath, (error, body) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...securityHeaders,
    });
    response.end(body);
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders,
  });
  response.end(JSON.stringify(value));
}

function formatRefreshProgress(value) {
  const line = String(value || '').trim().split('\n').filter(Boolean).at(-1) || '';
  if (!line) return 'Buscando ofertas…';
  try {
    const progress = JSON.parse(line);
    if (progress?.source && Number.isFinite(Number(progress.unique_records))) {
      const count = Number(progress.unique_records);
      return `${progress.source} completada · ${count.toLocaleString('es-ES')} oferta${count === 1 ? '' : 's'} encontrada${count === 1 ? '' : 's'}`;
    }
  } catch {
    if (line.startsWith('{')) return 'Procesando resultados de la plataforma…';
  }
  return line.replace(/^Aviso:\s*/i, '').replace(/[….]+$/, '') + '…';
}

async function findLocations(query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('es');
  if (normalizedQuery.length < 2 || normalizedQuery.length > 100) return [];
  const cached = locationCache.get(normalizedQuery);
  if (cached && Date.now() - cached.createdAt < 24 * 60 * 60 * 1000) return cached.locations;
  const url = new URL('https://www.cartociudad.es/geocoder/api/geocoder/candidates');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('limit', '12');
  const externalResponse = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!externalResponse.ok) throw new Error(`CartoCiudad respondió HTTP ${externalResponse.status}`);
  const candidates = await externalResponse.json();
  const locations = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!/^(municipio|poblacion)$/i.test(String(candidate.type || ''))) continue;
    const city = String(candidate.poblacion || candidate.muni || '').trim();
    const province = String(candidate.province || '').trim();
    if (!city) continue;
    const label = province && city.toLocaleLowerCase('es') !== province.toLocaleLowerCase('es')
      ? `${city}, ${province}`
      : city;
    const key = label.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ label, city, province });
    if (locations.length === 8) break;
  }
  if (locationCache.size >= 500) locationCache.delete(locationCache.keys().next().value);
  locationCache.set(normalizedQuery, { createdAt: Date.now(), locations });
  return locations;
}

function parseInfoJobsInitialProps(html) {
  const marker = 'window.__INITIAL_PROPS__ = JSON.parse("';
  const start = html.indexOf(marker);
  const end = html.indexOf('");</script>', start + marker.length);
  if (start < 0 || end < 0) throw new Error('InfoJobs no publicó los datos del detalle');
  return JSON.parse(JSON.parse(`"${html.slice(start + marker.length, end)}"`));
}

function sanitizeInfoJobsDescription(value) {
  const allowedTags = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br']);
  const source = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return source.replace(/<[^>]*>/g, tag => {
    const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i);
    if (!match) return '';
    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    if (!allowedTags.has(name)) return '';
    if (name === 'br') return '<br>';
    return closing ? `</${name}>` : `<${name}>`;
  });
}

async function findInfoJobsDetail(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !/(^|\.)infojobs\.net$/i.test(url.hostname)) throw new Error('La oferta debe pertenecer a InfoJobs');
  url.search = '';
  url.hash = '';
  const cached = infoJobsDetailCache.get(url.href);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const externalResponse = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
      'User-Agent': 'web-trabajos/1.0 (panel local de empleo)',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!externalResponse.ok) throw new Error(`InfoJobs respondió HTTP ${externalResponse.status}`);
  const offer = parseInfoJobsInitialProps(await externalResponse.text()).offer || {};
  const requiredLanguages = (Array.isArray(offer.requiredLanguages) ? offer.requiredLanguages : []).map(item => {
    if (typeof item === 'string') return item;
    const language = item?.name || item?.language || item?.label || '';
    const level = item?.level || item?.value || '';
    return [language, level].filter(Boolean).join(' · ');
  }).filter(Boolean);
  const detail = {
    descriptionHtml: sanitizeInfoJobsDescription(offer.description),
    minimumStudies: offer.minimumStudies?.level || offer.minimumStudies || '',
    minimumExperience: offer.minimumExperience || '',
    requiredLanguages,
  };
  if (infoJobsDetailCache.size >= 500) infoJobsDetailCache.delete(infoJobsDetailCache.keys().next().value);
  infoJobsDetailCache.set(url.href, { createdAt: Date.now(), detail });
  return detail;
}

function fetchEmpleateJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      rejectUnauthorized: false,
      timeout: 20000,
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.empleate.gob.es/empleo/',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      },
    }, externalResponse => {
      let body = '';
      externalResponse.setEncoding('utf8');
      externalResponse.on('data', chunk => { body += chunk; });
      externalResponse.on('end', () => {
        if (externalResponse.statusCode !== 200) return reject(new Error(`Empléate respondió HTTP ${externalResponse.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Empléate devolvió un detalle no válido')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Empléate superó el tiempo de espera')));
    request.on('error', reject);
  });
}

async function findEmpleateDetail(value) {
  const id = String(value || '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new Error('El identificador de Empléate no es válido');
  const cached = empleateDetailCache.get(id);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const payload = await fetchEmpleateJson(`https://www.empleate.gob.es/empleate/open/offer/load/${id}`);
  if (String(payload?.status) !== '200' || !payload.response) throw new Error('Empléate no encontró el detalle de la oferta');
  const offer = payload.response;
  const languageValues = Array.isArray(offer.requiredLanguages) ? offer.requiredLanguages
    : Array.isArray(offer.languages) ? offer.languages : [];
  const requiredLanguages = languageValues.map(item => {
    if (typeof item === 'string') return item;
    return [item?.language?.name || item?.name, item?.level?.name || item?.level].filter(Boolean).join(' · ');
  }).filter(Boolean);
  const modality = String(offer.modality?.name || offer.modality || '').trim();
  const detail = {
    description: String(offer.content || '').trim(),
    minimumStudies: String(offer.educationalLevel?.name || offer.educationalReq?.name || '').trim(),
    minimumExperience: String(offer.minimumExperience?.name || offer.minimumExperience || '').trim(),
    requiredLanguages,
    modality: /^no informado$/i.test(modality) ? '' : modality,
    workday: String(offer.dayType?.name || offer.schedule || '').trim(),
    salary: String(offer.salary || '').trim(),
    company: String(offer.creator || '').trim(),
  };
  if (empleateDetailCache.size >= 500) empleateDetailCache.delete(empleateDetailCache.keys().next().value);
  empleateDetailCache.set(id, { createdAt: Date.now(), detail });
  return detail;
}

async function findTecnoempleoDetail(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !/(^|\.)tecnoempleo\.com$/i.test(url.hostname) || !/\/rf-[a-z0-9]+\/?$/i.test(url.pathname)) {
    throw new Error('La oferta debe pertenecer a Tecnoempleo');
  }
  url.search = '';
  url.hash = '';
  const cached = tecnoempleoDetailCache.get(url.href);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const externalResponse = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!externalResponse.ok) throw new Error(`Tecnoempleo respondió HTTP ${externalResponse.status}`);
  const detail = parseTecnoempleoDetail(await externalResponse.text());
  if (tecnoempleoDetailCache.size >= 500) tecnoempleoDetailCache.delete(tecnoempleoDetailCache.keys().next().value);
  tecnoempleoDetailCache.set(url.href, { createdAt: Date.now(), detail });
  return detail;
}

async function findJobTodayDetail(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !/(^|\.)jobtoday\.com$/i.test(url.hostname) || !/^\/es\/trabajo\//i.test(url.pathname)) {
    throw new Error('La oferta debe pertenecer a Job Today');
  }
  url.search = '';
  url.hash = '';
  const cached = jobTodayDetailCache.get(url.href);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const externalResponse = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!externalResponse.ok) throw new Error(`Job Today respondió HTTP ${externalResponse.status}`);
  const detail = parseJobTodayDetail(await externalResponse.text());
  if (jobTodayDetailCache.size >= 500) jobTodayDetailCache.delete(jobTodayDetailCache.keys().next().value);
  jobTodayDetailCache.set(url.href, { createdAt: Date.now(), detail });
  return detail;
}

async function findInfoempleoDetail(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !/(^|\.)infoempleo\.com$/i.test(url.hostname) || !/^\/ofertasdetrabajo\//i.test(url.pathname)) throw new Error('La oferta debe pertenecer a Infoempleo');
  url.search = ''; url.hash = '';
  const cached = infoempleoDetailCache.get(url.href);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const externalResponse = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' }, signal: AbortSignal.timeout(20000) });
  if (!externalResponse.ok) throw new Error(`Infoempleo respondió HTTP ${externalResponse.status}`);
  const detail = parseInfoempleoDetail(await externalResponse.text());
  if (infoempleoDetailCache.size >= 500) infoempleoDetailCache.delete(infoempleoDetailCache.keys().next().value);
  infoempleoDetailCache.set(url.href, { createdAt: Date.now(), detail });
  return detail;
}
async function findEurofirmsDetail(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !/(^|\.)eurofirms\.com$/i.test(url.hostname) || !/^\/es\/es\//i.test(url.pathname)) throw new Error('La oferta debe pertenecer a Eurofirms');
  url.search = ''; url.hash = '';
  const cached = eurofirmsDetailCache.get(url.href);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.detail;
  const externalResponse = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' }, signal: AbortSignal.timeout(20000) });
  if (!externalResponse.ok) throw new Error(`Eurofirms respondió HTTP ${externalResponse.status}`);
  const detail = parseEurofirmsDetail(await externalResponse.text());
  if (eurofirmsDetailCache.size >= 500) eurofirmsDetailCache.delete(eurofirmsDetailCache.keys().next().value);
  eurofirmsDetailCache.set(url.href, { createdAt: Date.now(), detail }); return detail;
}
async function findInfofeinaDetail(value) { const url=new URL(String(value||'')); if(url.protocol!=='https:'||!/(^|\.)infofeina\.com$/i.test(url.hostname)||!/^\/ofertes\//i.test(url.pathname))throw Error('La oferta debe pertenecer a Infofeina');url.search='';url.hash='';const cached=infofeinaDetailCache.get(url.href);if(cached&&Date.now()-cached.createdAt<21600000)return cached.detail;const externalResponse=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'ca,es;q=0.9','User-Agent':'web-trabajos/1.0 (panel local de empleo)'},signal:AbortSignal.timeout(20000)});if(!externalResponse.ok)throw Error(`Infofeina respondió HTTP ${externalResponse.status}`);const detail=parseInfofeinaDetail(await externalResponse.text());if(infofeinaDetailCache.size>=500)infofeinaDetailCache.delete(infofeinaDetailCache.keys().next().value);infofeinaDetailCache.set(url.href,{createdAt:Date.now(),detail});return detail}
async function findFeinaActivaDetail(value){const url=new URL(String(value||''));if(url.protocol!=='https:'||url.hostname!=='feinaactiva.gencat.cat'||!/^\/(?:es|ca)\/search\/offers\/detail\//i.test(url.pathname))throw Error('La oferta debe pertenecer a Feina Activa');url.search='';url.hash='';const cached=feinaActivaDetailCache.get(url.href);if(cached&&Date.now()-cached.createdAt<21600000)return cached.detail;const r=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'es,ca;q=0.9','User-Agent':'web-trabajos/1.0 (panel local de empleo)'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Feina Activa respondió HTTP ${r.status}`);const detail=parseFeinaActivaDetail(await r.text());if(feinaActivaDetailCache.size>=500)feinaActivaDetailCache.delete(feinaActivaDetailCache.keys().next().value);feinaActivaDetailCache.set(url.href,{createdAt:Date.now(),detail});return detail}

function jobKey(job) {
  return `${job.source}:${job.source_id || job.slug || job.url}`;
}

function seenJobsCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 6);
  return cutoff.getTime();
}

async function readSeenJobStore() {
  try {
    const document = JSON.parse(await fs.promises.readFile(seenJobsFile, 'utf8'));
    const now = new Date().toISOString();
    const sourceEntries = Array.isArray(document.entries)
      ? document.entries
      : (Array.isArray(document.keys) ? document.keys : []).map(key => ({ key, seen_at: now }));
    const cutoff = seenJobsCutoff();
    const entries = new Map();
    for (const item of sourceEntries) {
      const key = String(item?.key || '').trim();
      const seenAt = String(item?.seen_at || '');
      const timestamp = Date.parse(seenAt);
      if (!key || key.length > 1000 || !Number.isFinite(timestamp) || timestamp < cutoff) continue;
      const previous = entries.get(key);
      if (!previous || Date.parse(previous) < timestamp) entries.set(key, new Date(timestamp).toISOString());
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
}

async function writeSeenJobStore(entries) {
  const document = {
    updated_at: new Date().toISOString(),
    retention_months: 6,
    entries: [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([key, seen_at]) => ({ key, seen_at })),
  };
  const temporaryFile = `${seenJobsFile}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, seenJobsFile);
}

async function readSeenJobs() {
  return new Set((await readSeenJobStore()).keys());
}

async function readFavoriteJobs() {
  try {
    const document = JSON.parse(await fs.promises.readFile(favoriteJobsFile, 'utf8'));
    const keys = new Set(Array.isArray(document.keys) ? document.keys : []);
    const jobs = new Map((Array.isArray(document.jobs) ? document.jobs : [])
      .filter(job => job && typeof job === 'object' && typeof job.job_key === 'string')
      .map(job => [job.job_key, {
        ...job,
        saved_at: Number.isFinite(Date.parse(job.saved_at)) ? new Date(job.saved_at).toISOString() : document.updated_at || new Date().toISOString(),
        link_status: ['ok', 'broken', 'unknown'].includes(job.link_status) ? job.link_status : 'unknown',
        link_checked_at: Number.isFinite(Date.parse(job.link_checked_at)) ? new Date(job.link_checked_at).toISOString() : null,
      }]));
    return { keys, jobs };
  } catch (error) {
    if (error.code === 'ENOENT') return { keys: new Set(), jobs: new Map() };
    throw error;
  }
}

function sanitizeFavoriteJob(value, key) {
  const job = value && typeof value === 'object' ? value : {};
  const text = (field, maximum = 500) => String(job[field] || '').slice(0, maximum);
  let url = text('url', 2000);
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) url = '';
  } catch { url = ''; }
  const numberOrNull = field => job[field] == null || job[field] === '' || !Number.isFinite(Number(job[field]))
    ? null
    : Number(job[field]);
  return {
    job_key: key,
    source: text('source', 100),
    source_id: text('source_id', 500),
    slug: text('slug', 500),
    title: text('title', 500),
    author: text('author', 500),
    company: text('company', 500),
    description: text('description', 20000),
    url,
    country: text('country', 200),
    countries: (Array.isArray(job.countries) ? job.countries : []).slice(0, 20).map(item => String(item).slice(0, 200)),
    location: text('location', 500),
    modality: text('modality', 200),
    workday: text('workday', 200),
    salary: text('salary', 200),
    budget: text('budget', 200),
    budget_eur_min: numberOrNull('budget_eur_min'),
    budget_eur_max: numberOrNull('budget_eur_max'),
    salary_period: text('salary_period', 100),
    language: text('language', 100),
    published_at: text('published_at', 100),
    published_label: text('published_label', 200),
    urgent: Boolean(job.urgent),
    minimumStudies: text('minimumStudies', 500),
    minimumExperience: text('minimumExperience', 500),
    requiredLanguages: (Array.isArray(job.requiredLanguages) ? job.requiredLanguages : []).slice(0, 20).map(item => String(item).slice(0, 300)),
    saved_at: Number.isFinite(Date.parse(job.saved_at)) ? new Date(job.saved_at).toISOString() : new Date().toISOString(),
    link_status: ['ok', 'broken', 'unknown'].includes(job.link_status) ? job.link_status : 'unknown',
    link_checked_at: Number.isFinite(Date.parse(job.link_checked_at)) ? new Date(job.link_checked_at).toISOString() : null,
  };
}

async function readSearchProfiles() {
  try {
    const document = JSON.parse(await fs.promises.readFile(searchProfilesFile, 'utf8'));
    return Array.isArray(document.profiles) ? document.profiles : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeProfileName(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

function sanitizeSearchProfile(value) {
  const profile = value && typeof value === 'object' ? value : {};
  const name = String(profile.name || '').trim();
  if (!name || name.length > 60) throw new Error('El nombre del perfil no es válido');
  const safeText = (field, maximum = 1000) => String(profile[field] || '').slice(0, maximum);
  const safeNumber = (field, fallback, minimum, maximum) => {
    const number = Number(profile[field]);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };
  const infojobsSearches = (Array.isArray(profile.infojobsSearches) ? profile.infojobsSearches : []).slice(0, 10)
    .map(item => ({ keyword: String(item?.keyword || '').trim().slice(0, 120), city: String(item?.city || '').trim().slice(0, 120) }))
    .filter(item => item.keyword || item.city);
  const infojobsUrls = (Array.isArray(profile.infojobsUrls) ? profile.infojobsUrls : []).slice(0, 10)
    .map(item => ({ description: String(item?.description || '').trim().slice(0, 200), url: String(item?.url || '').trim().slice(0, 2000) }))
    .filter(item => item.url);
  const platformIds = new Set(['infojobs', 'empleate', 'tecnoempleo', 'jobtoday', 'infoempleo', 'eurofirms', 'infofeina', 'feinaactiva']);
  const selectedPlatforms = Array.isArray(profile.selectedPlatforms)
    ? [...new Set(profile.selectedPlatforms.map(String).filter(item => platformIds.has(item)))]
    : [...platformIds];
  return {
    name,
    search: safeText('search'),
    city: safeText('city', 120),
    contentSearch: safeText('contentSearch'),
    exclude: safeText('exclude'),
    source: safeText('source', 100),
    sources: (Array.isArray(profile.sources) ? profile.sources : []).slice(0, 20).map(item => String(item).slice(0, 100)),
    sourcesActive: typeof profile.sourcesActive === 'boolean' ? profile.sourcesActive : Array.isArray(profile.sources) && profile.sources.length > 0,
    type: safeText('type', 30),
    sort: safeText('sort', 30) || 'newest',
    priceScaleVersion: safeNumber('priceScaleVersion', 1, 1, 2),
    minPrice: safeNumber('minPrice', 0, 0, 100000),
    maxPrice: safeNumber('maxPrice', profile.priceScaleVersion >= 2 ? 100000 : 105, 0, 100000),
    date: safeNumber('date', 42, 1, 42),
    showSeen: Boolean(profile.showSeen),
    favoritesOnly: Boolean(profile.favoritesOnly),
    infojobsSearches,
    infojobsUrls,
    selectedPlatforms,
  };
}

let searchProfilesWriteQueue = Promise.resolve();
function saveSearchProfile(response, request) {
  readJsonBody(request).then(body => {
    const profile = sanitizeSearchProfile(body.profile);
    searchProfilesWriteQueue = searchProfilesWriteQueue.catch(() => {}).then(async () => {
      const profiles = await readSearchProfiles();
      const existingIndex = profiles.findIndex(item => normalizeProfileName(item.name) === normalizeProfileName(profile.name));
      if (existingIndex >= 0) profile.name = profiles[existingIndex].name;
      if (existingIndex >= 0) profiles[existingIndex] = profile;
      else profiles.push(profile);
      profiles.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const document = { updated_at: new Date().toISOString(), profiles };
      const temporaryFile = `${searchProfilesFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, searchProfilesFile);
      return { profile, profiles, created: existingIndex < 0 };
    });
    searchProfilesWriteQueue.then(result => sendJson(response, 200, result))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function deleteSearchProfile(response, request) {
  readJsonBody(request).then(body => {
    const name = String(body.name || '').trim();
    if (!name || name.length > 60) throw new Error('El nombre del perfil no es válido');
    searchProfilesWriteQueue = searchProfilesWriteQueue.catch(() => {}).then(async () => {
      const profiles = (await readSearchProfiles())
        .filter(profile => normalizeProfileName(profile.name) !== normalizeProfileName(name));
      const document = { updated_at: new Date().toISOString(), profiles };
      const temporaryFile = `${searchProfilesFile}.tmp`;
      await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
      await fs.promises.rename(temporaryFile, searchProfilesFile);
      return profiles;
    });
    searchProfilesWriteQueue.then(profiles => sendJson(response, 200, { profiles }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 128 * 1024) {
        tooLarge = true;
        body = '';
        reject(new Error('Petición demasiado grande'));
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('JSON inválido')); }
    });
    request.on('error', reject);
  });
}

let seenWriteQueue = Promise.resolve();
function updateSeenJob(response, request) {
  readJsonBody(request).then(body => {
    if (typeof body.key !== 'string' || !body.key || body.key.length > 1000 || typeof body.seen !== 'boolean') {
      sendJson(response, 400, { error: 'Datos de visto inválidos' });
      return;
    }
    seenWriteQueue = seenWriteQueue.catch(() => {}).then(async () => {
      const seenJobs = await readSeenJobStore();
      if (body.seen) seenJobs.set(body.key, new Date().toISOString());
      else seenJobs.delete(body.key);
      await writeSeenJobStore(seenJobs);
      return seenJobs.size;
    });
    seenWriteQueue.then(count => sendJson(response, 200, { key: body.key, seen: body.seen, count }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

let favoriteWriteQueue = Promise.resolve();
async function writeFavoriteStore(favoriteStore) {
  const document = {
    updated_at: new Date().toISOString(),
    keys: [...favoriteStore.keys].sort(),
    jobs: [...favoriteStore.jobs.values()].sort((a, b) => a.title.localeCompare(b.title, 'es')),
  };
  const temporaryFile = `${favoriteJobsFile}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, favoriteJobsFile);
}

function updateFavoriteJob(response, request) {
  readJsonBody(request).then(body => {
    if (typeof body.key !== 'string' || !body.key || body.key.length > 1000 || typeof body.favorite !== 'boolean'
      || (body.favorite && (!body.job || typeof body.job !== 'object' || !body.job.url))) {
      sendJson(response, 400, { error: 'Datos de favorito inválidos' });
      return;
    }
    favoriteWriteQueue = favoriteWriteQueue.catch(() => {}).then(async () => {
      const favoriteStore = await readFavoriteJobs();
      if (body.favorite) {
        favoriteStore.keys.add(body.key);
        favoriteStore.jobs.set(body.key, sanitizeFavoriteJob(body.job, body.key));
      } else {
        favoriteStore.keys.delete(body.key);
        favoriteStore.jobs.delete(body.key);
      }
      await writeFavoriteStore(favoriteStore);
      return favoriteStore.keys.size;
    });
    favoriteWriteQueue.then(count => sendJson(response, 200, { key: body.key, favorite: body.favorite, count }))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

async function checkFavoriteUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'web-trabajos/1.0 (comprobación de favorito)' },
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 404 || response.status === 410) return { status: 'broken', statusCode: response.status };
    if (response.ok || (response.status >= 300 && response.status < 400)) return { status: 'ok', statusCode: response.status };
    return { status: 'unknown', statusCode: response.status };
  } catch {
    return { status: 'unknown', statusCode: null };
  }
}

function checkFavoriteLinks(response) {
  favoriteWriteQueue = favoriteWriteQueue.catch(() => {}).then(async () => {
    const favoriteStore = await readFavoriteJobs();
    const jobs = [...favoriteStore.jobs.values()];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        const result = await checkFavoriteUrl(job.url);
        job.link_status = result.status;
        job.link_status_code = result.statusCode;
        job.link_checked_at = new Date().toISOString();
      }
    });
    await Promise.all(workers);
    await writeFavoriteStore(favoriteStore);
    const counts = { ok: 0, broken: 0, unknown: 0 };
    jobs.forEach(job => { counts[job.link_status] += 1; });
    return counts;
  });
  favoriteWriteQueue.then(counts => sendJson(response, 200, counts))
    .catch(error => sendJson(response, 500, { error: error.message }));
}

function cleanFavoriteJobs(response, request) {
  readJsonBody(request).then(body => {
    if (!['broken', 'old'].includes(body.mode)) throw new Error('Modo de limpieza no válido');
    favoriteWriteQueue = favoriteWriteQueue.catch(() => {}).then(async () => {
      const favoriteStore = await readFavoriteJobs();
      const cutoff = seenJobsCutoff();
      let removed = 0;
      for (const [key, job] of favoriteStore.jobs) {
        const shouldRemove = body.mode === 'broken'
          ? job.link_status === 'broken'
          : Date.parse(job.saved_at) < cutoff;
        if (!shouldRemove) continue;
        favoriteStore.jobs.delete(key);
        favoriteStore.keys.delete(key);
        removed += 1;
      }
      await writeFavoriteStore(favoriteStore);
      return { removed, count: favoriteStore.keys.size };
    });
    favoriteWriteQueue.then(result => sendJson(response, 200, result))
      .catch(error => sendJson(response, 500, { error: error.message }));
  }).catch(error => sendJson(response, 400, { error: error.message }));
}

function sendCombinedJobs(response) {
  Promise.all([
    fs.promises.readFile(dataFile, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { jobs: [], unique_records: 0, scraped_at: null };
      throw error;
    }),
    readSeenJobs(),
    readFavoriteJobs(),
  ]).then(([document, seenJobs, favoriteStore]) => {
    const jobs = (document.jobs || []).map(job => ({
      ...job,
      source_id: job.source_id || job.slug || '',
      published_at: job.published_at || job.published_date || null,
    })).map(job => ({ ...job, job_key: jobKey(job), seen: seenJobs.has(jobKey(job)), favorite: favoriteStore.keys.has(jobKey(job)) }));
    const sources = {};
    for (const job of jobs) {
      if (!job.source) continue;
      sources[job.source] ||= { count: 0, scraped_at: document.scraped_at || null };
      sources[job.source].count += 1;
    }
    sendJson(response, 200, {
      scraped_at: document.scraped_at || null,
      unique_records: jobs.length,
      sources,
      jobs,
    });
  }).catch(error => sendJson(response, 500, { error: error.message }));
}

function sendFavoriteJobs(response) {
  Promise.all([
    readFavoriteJobs(),
    readSeenJobs(),
    fs.promises.readFile(dataFile, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return { jobs: [] };
      throw error;
    }),
  ]).then(([favoriteStore, seenJobs, document]) => {
    const currentJobs = new Map((document.jobs || []).map(job => [jobKey(job), job]));
    const jobs = [...favoriteStore.keys].map(key => {
      const stored = favoriteStore.jobs.get(key);
      const current = currentJobs.get(key);
      return current ? { ...stored, ...current, saved_at: stored?.saved_at, link_status: stored?.link_status, link_status_code: stored?.link_status_code, link_checked_at: stored?.link_checked_at } : stored;
    })
      .filter(Boolean)
      .map(job => ({
        ...job,
        job_key: job.job_key || jobKey(job),
        seen: seenJobs.has(job.job_key || jobKey(job)),
        favorite: true,
      }));
    sendJson(response, 200, { jobs });
  }).catch(error => sendJson(response, 500, { error: error.message }));
}

function startInfoJobsRefresh(response, scope = 'sample', search = {}) {
  if (refreshState.running) {
    sendJson(response, 409, refreshState);
    return;
  }
  Object.assign(refreshState, {
    running: true,
    target: scope === 'search' ? 'jobs-search' : scope === 'all' ? 'infojobs-all' : 'infojobs',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: scope === 'search' ? 'Buscando ofertas en las plataformas configuradas…' : scope === 'all' ? 'Iniciando descarga completa de InfoJobs…' : 'Iniciando actualización de InfoJobs…',
    error: null,
    warning: null,
  });
  const child = spawn(process.execPath, [scope === 'search' ? combinedSearch : infoJobsScraper], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATA_DIR: dataRoot,
      INFOJOBS_PAGES: ['all', 'search'].includes(scope) ? 'all' : (process.env.INFOJOBS_PAGES || '6'),
      INFOJOBS_CONCURRENCY: '1',
      INFOJOBS_DELAY_MS: ['all', 'search'].includes(scope) ? '750' : (process.env.INFOJOBS_DELAY_MS || '600'),
      INFOJOBS_KEYWORD: scope === 'search' ? (search.keyword || '') : '',
      INFOJOBS_CITY: scope === 'search' ? (search.city || '') : '',
      INFOJOBS_URL: scope === 'search' ? (search.url || '') : '',
      INFOJOBS_SEARCHES: scope === 'search' && Array.isArray(search.searches) ? JSON.stringify(search.searches) : '',
      JOB_SEARCHES: scope === 'search' && Array.isArray(search.searches) ? JSON.stringify(search.searches) : '',
      JOB_PLATFORMS: scope === 'search' && Array.isArray(search.platforms) ? JSON.stringify(search.platforms) : '',
    },
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    refreshState.message = 'La actualización superó el tiempo máximo';
    child.kill('SIGTERM');
  }, scope === 'all' ? 4 * 60 * 60 * 1000 : scope === 'search' ? 60 * 60 * 1000 : 2 * 60 * 1000);
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-1024 * 1024); });
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-128 * 1024);
    refreshState.message = formatRefreshProgress(stderr);
  });
  child.on('error', error => {
    clearTimeout(timeout);
    Object.assign(refreshState, {
      running: false,
      finishedAt: new Date().toISOString(),
      message: 'No se pudo iniciar la actualización',
      error: error.message,
      warning: null,
    });
  });
  child.on('close', code => {
    clearTimeout(timeout);
    let summary = null;
    try { summary = JSON.parse(stdout); } catch {}
    Object.assign(refreshState, {
      running: false,
      finishedAt: new Date().toISOString(),
      message: code === 0
        ? summary?.partial
          ? `Búsqueda parcial: ${Number(summary?.unique_records || 0).toLocaleString('es-ES')} ofertas`
          : `Búsqueda actualizada: ${Number(summary?.unique_records || 0).toLocaleString('es-ES')} ofertas`
        : 'La búsqueda de ofertas terminó con errores',
      error: code === 0 ? null : (stderr.trim().split('\n').at(-1) || `Código de salida ${code}`),
      warning: code === 0 && summary?.partial ? (summary.warnings || []).join(' · ') : null,
    });
  });
  sendJson(response, 202, refreshState);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;
  if (pathname === '/api/jobs') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    sendCombinedJobs(response);
    return;
  }
  if (pathname === '/api/locations') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findLocations(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('q') || '')
      .then(locations => sendJson(response, 200, { locations }))
      .catch(error => sendJson(response, 502, { error: error.message, locations: [] }));
    return;
  }
  if (pathname === '/api/infojobs-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findInfoJobsDetail(requestUrl.searchParams.get('url') || '')
      .then(detail => sendJson(response, 200, { detail }))
      .catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (pathname === '/api/empleate-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findEmpleateDetail(requestUrl.searchParams.get('id') || '')
      .then(detail => sendJson(response, 200, { detail }))
      .catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (pathname === '/api/tecnoempleo-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findTecnoempleoDetail(requestUrl.searchParams.get('url') || '')
      .then(detail => sendJson(response, 200, { detail }))
      .catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (pathname === '/api/jobtoday-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findJobTodayDetail(requestUrl.searchParams.get('url') || '')
      .then(detail => sendJson(response, 200, { detail }))
      .catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (pathname === '/api/infoempleo-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findInfoempleoDetail(requestUrl.searchParams.get('url') || '').then(detail => sendJson(response, 200, { detail })).catch(error => sendJson(response, 502, { error: error.message }));
    return;
  }
  if (pathname === '/api/eurofirms-detail') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    findEurofirmsDetail(requestUrl.searchParams.get('url') || '').then(detail => sendJson(response, 200, { detail })).catch(error => sendJson(response, 502, { error: error.message })); return;
  }
  if(pathname==='/api/infofeina-detail'){if(request.method!=='GET')return sendJson(response,405,{error:'Método no permitido'});findInfofeinaDetail(requestUrl.searchParams.get('url')||'').then(detail=>sendJson(response,200,{detail})).catch(error=>sendJson(response,502,{error:error.message}));return}
  if(pathname==='/api/feinaactiva-detail'){if(request.method!=='GET')return sendJson(response,405,{error:'Método no permitido'});findFeinaActivaDetail(requestUrl.searchParams.get('url')||'').then(detail=>sendJson(response,200,{detail})).catch(error=>sendJson(response,502,{error:error.message}));return}
  if (pathname === '/api/jobs/seen') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    updateSeenJob(response, request);
    return;
  }
  if (pathname === '/api/jobs/favorite') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    updateFavoriteJob(response, request);
    return;
  }
  if (pathname === '/api/jobs/favorites') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    sendFavoriteJobs(response);
    return;
  }
  if (pathname === '/api/jobs/favorites/check') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    checkFavoriteLinks(response);
    return;
  }
  if (pathname === '/api/jobs/favorites/clean') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    cleanFavoriteJobs(response, request);
    return;
  }
  if (pathname === '/api/search-profiles') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    readSearchProfiles()
      .then(profiles => sendJson(response, 200, { profiles }))
      .catch(error => sendJson(response, 500, { error: error.message }));
    return;
  }
  if (pathname === '/api/search-profiles/save') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    saveSearchProfile(response, request);
    return;
  }
  if (pathname === '/api/search-profiles/delete') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    deleteSearchProfile(response, request);
    return;
  }
  if (pathname === '/api/refresh-status') {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Método no permitido' });
    sendJson(response, 200, refreshState);
    return;
  }
  if (pathname === '/api/refresh/infojobs') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    startInfoJobsRefresh(response, requestUrl.searchParams.get('scope') === 'all' ? 'all' : 'sample');
    return;
  }
  if (pathname === '/api/search/infojobs' || pathname === '/api/search/jobs') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Método no permitido' });
    readJsonBody(request).then(body => {
      const inputSearches = Array.isArray(body.searches) ? body.searches : [body];
      const platformIds = new Set(['infojobs', 'empleate', 'tecnoempleo', 'jobtoday', 'infoempleo', 'eurofirms', 'infofeina', 'feinaactiva']);
      const platforms = Array.isArray(body.platforms) ? [...new Set(body.platforms.map(String).filter(item => platformIds.has(item)))] : [...platformIds];
      const searches = inputSearches.slice(0, 10).map(item => {
        const url = String(item?.url || '').trim().slice(0, 2000);
        if (url) {
          const parsed = new URL(url);
          const supported = /(^|\.)infojobs\.net$/i.test(parsed.hostname) || /(^|\.)empleate\.gob\.es$/i.test(parsed.hostname) || /(^|\.)tecnoempleo\.com$/i.test(parsed.hostname) || /(^|\.)jobtoday\.com$/i.test(parsed.hostname) || /(^|\.)infoempleo\.com$/i.test(parsed.hostname) || /(^|\.)eurofirms\.com$/i.test(parsed.hostname) || /(^|\.)infofeina\.com$/i.test(parsed.hostname) || /^feinaactiva\.gencat\.cat$/i.test(parsed.hostname);
          if (parsed.protocol !== 'https:' || !supported) throw new Error('La URL avanzada debe pertenecer a una plataforma compatible');
        }
        return {
          url,
          keyword: String(item?.keyword || '').trim().slice(0, 120),
          city: String(item?.city || '').trim().slice(0, 120),
        };
      }).filter(item => item.url || item.keyword || item.city);
      if (!searches.length) return sendJson(response, 400, { error: 'Indica al menos un puesto o una ciudad' });
      startInfoJobsRefresh(response, 'search', { ...searches[0], searches, platforms });
    }).catch(error => sendJson(response, 400, { error: error.message }));
    return;
  }
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders });
    response.end('Not found');
    return;
  }
  sendFile(response, path.join(root, route[0]), route[1]);
});

fs.promises.mkdir(dataRoot, { recursive: true })
  .then(async () => {
    const seenJobs = await readSeenJobStore();
    await writeSeenJobStore(seenJobs);
    server.listen(port, host, () => {
      console.log('Trabajos de distintas webs iniciado correctamente.');
    });
  })
  .catch(error => {
    console.error(`No se pudo preparar el directorio de datos: ${error.message}`);
    process.exitCode = 1;
  });
