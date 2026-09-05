#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = 'https://www.infojobs.net';
const directUrl = String(process.env.INFOJOBS_URL || '').trim();
const keyword = String(process.env.INFOJOBS_KEYWORD || '').trim().slice(0, 120);
const city = String(process.env.INFOJOBS_CITY || '').trim().slice(0, 120);
const filteredSearch = Boolean(directUrl || keyword || city);
const listingPath = directUrl ? new URL(directUrl).pathname : filteredSearch ? '/jobsearch/search-results/list.xhtml' : '/ofertas-trabajo';
const searchKey = JSON.stringify({ url: directUrl, keyword, city });
const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const checkpointFile = path.join(dataRoot, filteredSearch ? '.infojobs-search-checkpoint.json' : '.infojobs-checkpoint.json');
const requestedPages = String(process.env.INFOJOBS_PAGES || '6').trim().toLowerCase();
const delayMs = clampNumber(process.env.INFOJOBS_DELAY_MS, 600, 250, 10000);
const concurrency = clampNumber(process.env.INFOJOBS_CONCURRENCY, 1, 1, 3);
const checkpointEvery = clampNumber(process.env.INFOJOBS_CHECKPOINT_EVERY, 25, 1, 250);
const maximumRetries = clampNumber(process.env.INFOJOBS_RETRIES, 4, 1, 10);

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function cleanOfferUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || !/(^|\.)infojobs\.net$/i.test(url.hostname)) return '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function salaryLabel(salary) {
  if (!salary?.range) return 'No indicado';
  const { min, max } = salary.range;
  const periodLabels = { HOUR: 'hora', DAY: 'día', MONTH: 'mes', YEAR: 'año' };
  const period = periodLabels[salary.period] || String(salary.period || '').toLocaleLowerCase('es');
  const format = value => Number(value).toLocaleString('es-ES');
  if (min == null && max == null) return 'No indicado';
  if (min != null && max != null && min !== max) return `${format(min)} € - ${format(max)} €/${period}`;
  return `${format(min ?? max)} €/${period}`;
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

function normalizeOffer(offer) {
  const salary = salaryLabel(offer.salary);
  const states = Array.isArray(offer.states) ? offer.states : [];
  return {
    source: 'InfoJobs',
    source_id: offer.code,
    slug: `infojobs-${offer.code}`,
    title: offer.title || '',
    author: offer.companyName || '',
    company: offer.companyName || '',
    description: offer.description || '',
    url: cleanOfferUrl(offer.link),
    country: 'España',
    countries: ['España'],
    location: offer.city || '',
    modality: offer.teleworking || '',
    workday: offer.workday || '',
    salary,
    budget: salary,
    budget_eur_min: offer.salary?.range?.min ?? null,
    budget_eur_max: offer.salary?.range?.max ?? offer.salary?.range?.min ?? null,
    salary_period: offer.salary?.period || null,
    language: 'es',
    published_at: offer.publishedAt || null,
    published_label: '',
    urgent: states.includes('URGENT'),
    minimumStudies: '',
    minimumExperience: '',
    requiredLanguages: [],
    infoJobsDetailLoaded: false,
  };
}

function parseInitialProps(html) {
  const marker = 'window.__INITIAL_PROPS__ = JSON.parse("';
  const start = html.indexOf(marker);
  const end = html.indexOf('");</script>', start + marker.length);
  if (start < 0 || end < 0) throw new Error('no se encontró el estado JSON público');
  const encoded = html.slice(start + marker.length, end);
  return JSON.parse(JSON.parse(`"${encoded}"`));
}

async function fetchPage(page) {
  const url = new URL(directUrl || listingPath, baseUrl);
  if (url.protocol !== 'https:' || !/(^|\.)infojobs\.net$/i.test(url.hostname)) throw new Error('la URL debe pertenecer a InfoJobs');
  if (keyword) url.searchParams.set('keyword', keyword);
  if (city) url.searchParams.set('cityIds', city);
  url.searchParams.set('sortBy', 'PUBLICATION_DATE');
  url.searchParams.set('page', page);
  for (let attempt = 1; attempt <= maximumRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
          'User-Agent': 'web-trabajos/1.0 (panel local de empleo)',
        },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        const serverRetryAfter = Number(response.headers.get('retry-after')) * 1000 || 0;
        const rateLimitCooldown = [403, 429].includes(response.status) ? 60000 : 0;
        error.retryAfter = Math.max(serverRetryAfter, rateLimitCooldown);
        throw error;
      }
      return parseInitialProps(await response.text());
    } catch (error) {
      if (attempt === maximumRetries) throw new Error(`página ${page}: ${error.message}`);
      const backoff = Math.max(error.retryAfter || 0, delayMs * (2 ** attempt));
      process.stderr.write(`InfoJobs: reintentando página ${page} en ${backoff} ms (${error.message})…\n`);
      await wait(backoff);
    }
  }
}

async function fetchOfferDetail(offer) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(offer.url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
          'User-Agent': 'web-trabajos/1.0 (panel local de empleo)',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const detail = parseInitialProps(await response.text()).offer || {};
      offer.descriptionHtml = sanitizeInfoJobsDescription(detail.description);
      offer.minimumStudies = detail.minimumStudies?.level || detail.minimumStudies || '';
      offer.minimumExperience = detail.minimumExperience || '';
      offer.requiredLanguages = (Array.isArray(detail.requiredLanguages) ? detail.requiredLanguages : []).map(item => {
        if (typeof item === 'string') return item;
        const language = item?.name || item?.language || item?.label || '';
        const level = item?.level || item?.value || '';
        return [language, level].filter(Boolean).join(' · ');
      }).filter(Boolean);
      offer.infoJobsDetailLoaded = true;
      return offer;
    } catch (error) {
      if (attempt === 2) {
        process.stderr.write(`InfoJobs: no se pudieron cargar los requisitos de ${offer.source_id} (${error.message}).\n`);
        return offer;
      }
      await wait(delayMs * attempt);
    }
  }
  return offer;
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function readCheckpoint() {
  try {
    const checkpoint = JSON.parse(await fs.promises.readFile(checkpointFile, 'utf8'));
    if (!Array.isArray(checkpoint.jobs) || !Number.isInteger(checkpoint.next_page)) return null;
    if (filteredSearch && checkpoint.search_key !== searchKey) return null;
    return checkpoint;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomically(file, value) {
  const temporaryFile = `${file}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, file);
}

async function saveCheckpoint(nextPage, totalPages, totalElements, jobsById, scrapedAt) {
  await writeJsonAtomically(checkpointFile, {
    scraped_at: scrapedAt,
    source: new URL(listingPath, baseUrl).toString(),
    search_key: searchKey,
    query: { url: directUrl, keyword, city },
    method: 'public-html-embedded-json',
    next_page: nextPage,
    total_pages: totalPages,
    total_elements_at_start: totalElements,
    jobs: [...jobsById.values()],
  });
}

async function main() {
  await fs.promises.mkdir(dataRoot, { recursive: true });
  const checkpoint = await readCheckpoint();
  const jobsById = new Map((checkpoint?.jobs || []).map(job => [job.source_id, job]));
  const scrapedAt = checkpoint?.scraped_at || new Date().toISOString();
  let page = checkpoint?.next_page || 1;
  let totalPages = checkpoint?.total_pages || null;
  let totalElements = checkpoint?.total_elements_at_start || null;
  let targetPages = requestedPages === 'all' ? Infinity : clampNumber(requestedPages, 6, 1, 100000);

  if (checkpoint) {
    process.stderr.write(`InfoJobs: reanudando en la página ${page} con ${jobsById.size} ofertas guardadas…\n`);
  }

  while (page <= targetPages && (totalPages == null || page <= totalPages)) {
    const lastKnownPage = Math.min(targetPages, totalPages || page);
    const batchSize = totalPages == null ? 1 : Math.min(concurrency, lastKnownPage - page + 1);
    const pages = Array.from({ length: batchSize }, (_, index) => page + index);
    process.stderr.write(`InfoJobs: descargando ${pages.length === 1 ? `página ${page}` : `páginas ${page}-${pages.at(-1)}`}${totalPages ? `/${Math.min(totalPages, targetPages)}` : ''}…\n`);
    const pageResults = await Promise.all(pages.map(fetchPage));
    for (const props of pageResults) {
      totalPages = Number(props.navigation?.totalPages) || totalPages || page;
      totalElements = Number(props.navigation?.totalElements) || totalElements || 0;
      const rawOffers = props.offers || [];
      process.stderr.write(`InfoJobs: cargando requisitos de ${rawOffers.length} ofertas…\n`);
      const offers = await mapWithConcurrency(rawOffers, concurrency, rawOffer => fetchOfferDetail(normalizeOffer(rawOffer)));
      for (const offer of offers) {
        if (offer.source_id && offer.title && offer.url) jobsById.set(offer.source_id, offer);
      }
    }
    if (requestedPages === 'all') targetPages = totalPages;
    page += batchSize;
    if ((page - 1) % checkpointEvery < batchSize || page > targetPages || page > totalPages) {
      await saveCheckpoint(page, totalPages, totalElements, jobsById, scrapedAt);
      process.stderr.write(`InfoJobs: checkpoint ${jobsById.size} ofertas únicas.\n`);
    }
    if (page <= targetPages && page <= totalPages) await wait(delayMs);
  }

  const jobs = [...jobsById.values()];
  const complete = page > totalPages;
  const document = {
    scraped_at: scrapedAt,
    source: new URL(listingPath, baseUrl).toString(),
    query: { url: directUrl, keyword, city },
    method: 'public-html-embedded-json',
    complete,
    pages_scraped: page - 1,
    total_pages_at_start: totalPages,
    total_elements_at_start: totalElements,
    unique_records: jobs.length,
    jobs,
  };
  await writeJsonAtomically(outputFile, document);
  if (complete) await fs.promises.unlink(checkpointFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  process.stdout.write(`${JSON.stringify({ source: 'InfoJobs', method: document.method, complete, pages_scraped: document.pages_scraped, unique_records: jobs.length, total_elements_at_start: totalElements, scraped_at: scrapedAt })}\n`);
}

async function runChild(search, temporaryDataRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename], {
      env: {
        ...process.env,
        DATA_DIR: temporaryDataRoot,
        INFOJOBS_SEARCHES: '',
        INFOJOBS_URL: search.url || '',
        INFOJOBS_KEYWORD: search.keyword || '',
        INFOJOBS_CITY: search.city || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => process.stderr.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`la búsqueda terminó con código ${code}`)));
  });
}

async function mainBatch() {
  let searches;
  try { searches = JSON.parse(process.env.INFOJOBS_SEARCHES || '[]'); }
  catch { throw new Error('las búsquedas de InfoJobs no son válidas'); }
  if (!Array.isArray(searches) || searches.length < 1) return main();
  const jobsById = new Map();
  const completed = [];
  for (let index = 0; index < searches.length; index += 1) {
    const search = searches[index] || {};
    const url = String(search.url || '').trim().slice(0, 2000);
    const keyword = String(search.keyword || '').trim().slice(0, 120);
    const city = String(search.city || '').trim().slice(0, 120);
    if (!url && !keyword && !city) continue;
    process.stderr.write(`InfoJobs: búsqueda ${index + 1}/${searches.length} (${url ? 'URL avanzada' : `${keyword || 'cualquier puesto'} · ${city || 'cualquier ciudad'}`})…\n`);
    const temporaryDataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-infojobs-'));
    try {
      await runChild({ url, keyword, city }, temporaryDataRoot);
      const document = JSON.parse(await fs.promises.readFile(path.join(temporaryDataRoot, 'jobs.json'), 'utf8'));
      for (const job of document.jobs || []) jobsById.set(job.source_id, job);
      completed.push({ url, keyword, city, total_elements: document.total_elements_at_start || 0 });
    } finally {
      await fs.promises.rm(temporaryDataRoot, { recursive: true, force: true });
    }
  }
  const document = {
    scraped_at: new Date().toISOString(),
    source: 'https://www.infojobs.net/jobsearch/search-results/list.xhtml',
    queries: completed,
    method: 'public-html-embedded-json',
    complete: true,
    unique_records: jobsById.size,
    jobs: [...jobsById.values()],
  };
  await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'InfoJobs', method: document.method, complete: true, searches: completed.length, unique_records: jobsById.size, scraped_at: document.scraped_at })}\n`);
}

function hasBatchSearches(value) {
  try {
    const searches = JSON.parse(value || '[]');
    return Array.isArray(searches) && searches.length > 0;
  }
  catch { return false; }
}

if (require.main === module) {
  (hasBatchSearches(process.env.INFOJOBS_SEARCHES) ? mainBatch() : main()).catch(error => {
    process.stderr.write(`InfoJobs: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { cleanOfferUrl, hasBatchSearches, normalizeOffer, parseInitialProps, salaryLabel, sanitizeInfoJobsDescription };
