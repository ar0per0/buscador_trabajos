#!/usr/bin/env node

const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const maximumResults = Math.max(1, Math.min(5000, Number(process.env.EMPLEATE_MAX_RESULTS || 5000)));
const openclawBin = process.env.OPENCLAW_BIN || '/home/prova/.npm-global/bin/openclaw';
let chromiumBrowser = null;
let chromiumPage = null;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      rejectUnauthorized: false,
      timeout: 20000,
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.empleate.gob.es/empleo/',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('respuesta JSON no válida')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('tiempo de espera agotado')));
    request.on('error', reject);
  });
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function prepareBrowser() {
  const chromiumPath = process.env.CHROMIUM_PATH || [
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    path.join(os.homedir(), '.local/opt/google-chrome/opt/google/chrome/google-chrome'),
  ].find(candidate => fs.existsSync(candidate));
  if (chromiumPath) {
    const puppeteer = require('puppeteer-core');
    chromiumBrowser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      acceptInsecureCerts: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    chromiumPage = await chromiumBrowser.newPage();
    await chromiumPage.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    return;
  }
  execFileSync(openclawBin, ['browser', 'start'], { stdio: 'ignore' });
}

function buildSearchUrl(search) {
  if (search?.url) return search.url;
  return `https://www.empleate.gob.es/empleo/#/trabajo?search=${encodeURIComponent(search?.term || '*')}&pag=0`;
}

async function fetchSearch(search) {
  const searchUrl = buildSearchUrl(search);
  if (chromiumPage) await chromiumPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  else {
    try { execFileSync(openclawBin, ['browser', 'navigate', searchUrl], { stdio: 'ignore' }); }
    catch { execFileSync(openclawBin, ['browser', 'open', searchUrl], { stdio: 'ignore' }); }
  }
  const browserFunction = `async () => {
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    let scope;
    for (let attempt = 0; attempt < 40 && !scope; attempt++) {
      for (const element of document.querySelectorAll('*')) {
        try {
          const candidate = window.angular?.element(element).scope();
          if (candidate && Array.isArray(candidate.searchOfferResult)) { scope = candidate; break; }
        } catch {}
      }
      if (!scope) await wait(250);
    }
    if (!scope) throw new Error('no se encontraron los resultados del portal');
    const awaitResult = async predicate => {
      for (let attempt = 0; attempt < 40; attempt++) {
        await wait(250);
        if (predicate()) return;
      }
      throw new Error('el portal no terminó de cargar la página solicitada');
    };
    // Angular crea el controlador con una lista vacía antes de completar la
    // primera petición. No interpretes ese estado transitorio como una
    // búsqueda legítima sin resultados: espera hasta que el total y la lista
    // permanezcan estables durante varios ciclos.
    let stableCycles = 0;
    let previousSignature = '';
    for (let attempt = 0; attempt < 40 && stableCycles < 5; attempt++) {
      await wait(250);
      const results = Array.isArray(scope.searchOfferResult) ? scope.searchOfferResult : [];
      const total = Number(scope.totalResults || 0);
      const signature = total + ':' + results.length + ':' + (results[0]?.id || '');
      stableCycles = signature === previousSignature ? stableCycles + 1 : 0;
      previousSignature = signature;
    }
    if (stableCycles < 5) throw new Error('el portal no estabilizó los resultados iniciales');
    const docs = [];
    const total = Number(scope.totalResults || 0);
    scope.pageSize = 100;
    scope.currentPage = 0;
    scope.doSearchApply();
    const expectedFirstPage = Math.min(100, total);
    await awaitResult(() => scope.searchOfferResult?.length === expectedFirstPage);
    const pages = Math.max(1, Math.ceil(Math.min(total, ${maximumResults}) / 100));
    for (let page = 0; page < pages; page++) {
      if (page > 0) {
        const previousId = scope.searchOfferResult?.[0]?.id;
        const expectedLength = Math.min(100, total - page * 100);
        scope.currentPage = page;
        scope.doSearchApply();
        await awaitResult(() => scope.searchOfferResult?.[0]?.id !== previousId
          && scope.searchOfferResult?.length === expectedLength);
      }
      docs.push(...JSON.parse(JSON.stringify(scope.searchOfferResult || [])));
      if (page < pages - 1) await wait(700);
    }
    const target = Math.min(total, ${maximumResults});
    const selected = docs.slice(0, target);
    if (selected.length !== target) throw new Error('se esperaban ' + target + ' ofertas y se cargaron ' + selected.length);
    return { numFound: total, docs: selected, truncated: total > ${maximumResults} };
  }`;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      if (chromiumPage) return await chromiumPage.evaluate(source => (0, eval)(`(${source})`)(), browserFunction);
      const output = execFileSync(openclawBin, ['browser', 'evaluate', '--fn', browserFunction], {
        encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
      });
      return JSON.parse(output);
    }
    catch (error) {
      lastError = error;
      if (attempt < 4) {
        const delay = attempt * 2500;
        process.stderr.write(`Empléate: reintentando en ${delay / 1000}s (${error.message})…\n`);
        await wait(delay);
      }
    }
  }
  throw lastError;
}

function firstValue(value) {
  if (Array.isArray(value)) return value.map(firstValue).filter(Boolean).join(', ');
  return value == null ? '' : String(value).trim();
}

function normalizeOffer(offer) {
  const city = firstValue(offer.ciudadF);
  const province = firstValue(offer.provinciaF);
  const location = city && province && city.toLocaleLowerCase('es') !== province.toLocaleLowerCase('es')
    ? `${city}, ${province}` : city || province;
  const externalUrl = safeExternalUrl(firstValue(offer.url));
  const id = firstValue(offer.id || offer.externalId);
  const requiredLanguages = firstValue(offer.idiomasF || offer.idiomaF || offer.languagesF)
    .split(/[,;|]/).map(value => value.trim()).filter(Boolean);
  return {
    source: 'Empléate',
    source_id: id,
    slug: `empleate-${id}`,
    title: firstValue(offer.titulo),
    company: firstValue(offer.creador || offer.contacto),
    author: firstValue(offer.creador || offer.contacto),
    description: firstValue(offer.contenido),
    url: `https://www.empleate.gob.es/empleo/#/oferta/${encodeURIComponent(id)}`,
    external_url: externalUrl,
    country: firstValue(offer.paisF) || 'España',
    countries: [firstValue(offer.paisF) || 'España'],
    location,
    modality: firstValue(offer.modalidadF || offer.modality),
    workday: firstValue(offer.jornadaF || offer.horario),
    salary: firstValue(offer.salarioF || offer.salario),
    published_at: firstValue(offer.fechaCreacionPortal || offer.fechaCreacion),
    minimumStudies: firstValue(offer.educacionF || offer.educacionS),
    minimumExperience: firstValue(offer.experienciaF || offer.experienciaMinimaF || offer.experiencia),
    requiredLanguages,
    empleateDetailLoaded: false,
  };
}

async function fetchOfferDetail(offer) {
  try {
    const payload = await fetchJson(`https://www.empleate.gob.es/empleate/open/offer/load/${encodeURIComponent(offer.source_id)}`);
    if (String(payload?.status) !== '200' || !payload.response) throw new Error('oferta no encontrada');
    const detail = payload.response;
    const languageValues = Array.isArray(detail.requiredLanguages) ? detail.requiredLanguages
      : Array.isArray(detail.languages) ? detail.languages : [];
    const requiredLanguages = languageValues.map(item => {
      if (typeof item === 'string') return item;
      return [item?.language?.name || item?.name, item?.level?.name || item?.level].filter(Boolean).join(' · ');
    }).filter(Boolean);
    const modality = firstValue(detail.modality?.name || detail.modality);
    Object.assign(offer, {
      description: firstValue(detail.content) || offer.description,
      minimumStudies: firstValue(detail.educationalLevel?.name || detail.educationalReq?.name) || offer.minimumStudies,
      minimumExperience: firstValue(detail.minimumExperience?.name || detail.minimumExperience) || offer.minimumExperience,
      requiredLanguages: requiredLanguages.length ? requiredLanguages : offer.requiredLanguages,
      modality: /^no informado$/i.test(modality) || modality === '0' ? '' : modality,
      workday: firstValue(detail.dayType?.name || detail.schedule) || offer.workday,
      salary: firstValue(detail.salary) || offer.salary,
      company: firstValue(detail.creator) || offer.company,
      author: firstValue(detail.creator) || offer.author,
      empleateDetailLoaded: true,
    });
  } catch (error) {
    process.stderr.write(`Empléate: no se pudieron cargar los requisitos de ${offer.source_id} (${error.message}).\n`);
  }
  return offer;
}

function parseSearchItem(item) {
  const directUrl = String(item?.url || '').trim();
  if (directUrl) {
    const parsed = new URL(directUrl);
    if (parsed.protocol !== 'https:' || !/(^|\.)empleate\.gob\.es$/i.test(parsed.hostname)) {
      throw new Error('la URL debe pertenecer a Empléate');
    }
    const hashQuery = parsed.hash.includes('?') ? parsed.hash.slice(parsed.hash.indexOf('?') + 1) : '';
    const term = new URLSearchParams(hashQuery).get('search') || parsed.searchParams.get('search') || '';
    return { term: term.trim(), url: directUrl };
  }
  return { term: [item?.keyword, item?.city].map(value => String(value || '').trim()).filter(Boolean).join(' ') };
}

function parseSearches() {
  let values;
  try { values = JSON.parse(process.env.EMPLEATE_SEARCHES || '[]'); }
  catch { throw new Error('las búsquedas de Empléate no son válidas'); }
  if (!Array.isArray(values)) throw new Error('las búsquedas de Empléate no son válidas');
  return values.slice(0, 20).map(parseSearchItem).filter(item => item.term || item.url);
}

async function main() {
  const searches = parseSearches();
  const jobs = new Map();
  let truncated = false;
  process.stderr.write('Empléate: preparando el navegador…\n');
  await prepareBrowser();
  for (let index = 0; index < searches.length; index += 1) {
    const search = searches[index];
    process.stderr.write(`Empléate: búsqueda ${index + 1}/${searches.length} (${search.term || search.url})…\n`);
    const result = await fetchSearch(search);
    truncated ||= Boolean(result.truncated);
    const normalizedOffers = result.docs.map(normalizeOffer).filter(offer => offer.source_id && offer.title && offer.url);
    process.stderr.write(`Empléate: cargando requisitos de ${normalizedOffers.length} ofertas…\n`);
    const detailedOffers = await mapWithConcurrency(normalizedOffers, 4, fetchOfferDetail);
    for (const offer of detailedOffers) {
      if (offer.source_id && offer.title && offer.url) jobs.set(offer.source_id, offer);
    }
    if (index < searches.length - 1) await wait(1200);
  }
  const scrapedAt = new Date().toISOString();
  const document = {
    source: 'https://www.empleate.gob.es/empleo/#/trabajo',
    scraped_at: scrapedAt,
    unique_records: jobs.size,
    truncated,
    jobs: [...jobs.values()],
  };
  const temporaryFile = `${outputFile}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, outputFile);
  process.stdout.write(`${JSON.stringify({ source: 'Empléate', unique_records: jobs.size, scraped_at: scrapedAt, truncated })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Empléate: ${error.message}\n`);
    process.exitCode = 1;
  }).finally(async () => {
    if (chromiumBrowser) await chromiumBrowser.close();
  });
}

module.exports = { buildSearchUrl, normalizeOffer, parseSearchItem, safeExternalUrl };
