#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = 'https://www.tecnoempleo.com';
const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const delayMs = clampNumber(process.env.TECNOEMPLEO_DELAY_MS, 500, 250, 10000);
const maximumPages = clampNumber(process.env.TECNOEMPLEO_MAX_PAGES, 100, 1, 500);
const directUrl = String(process.env.TECNOEMPLEO_URL || '').trim();
const keyword = String(process.env.TECNOEMPLEO_KEYWORD || '').trim().slice(0, 120);
const city = String(process.env.TECNOEMPLEO_CITY || '').trim().slice(0, 120);

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function decodeHtml(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function plainText(value) {
  return decodeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanTecnoempleoUrl(value, listingOnly = false) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || !/(^|\.)tecnoempleo\.com$/i.test(url.hostname)) return '';
    if (listingOnly && !/^\/ofertas-trabajo(?:\/|$)/.test(url.pathname)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function buildSearchUrl(search = {}) {
  if (search.url) {
    const safeUrl = cleanTecnoempleoUrl(search.url, true);
    if (!safeUrl) throw new Error('la URL debe ser un listado de Tecnoempleo');
    return safeUrl;
  }
  const segments = [slugify(search.city), slugify(search.keyword)].filter(Boolean);
  return `${baseUrl}/ofertas-trabajo/${segments.join('/')}`;
}

function parseDate(value) {
  const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function parseSalary(value) {
  const label = plainText(value);
  const values = [...label.matchAll(/([\d.]+)\s*€/g)].map(match => Number(match[1].replace(/\./g, '')));
  const period = /b\s*\/\s*m|\/mes/i.test(label) ? 'MONTH' : /b\s*\/\s*a|\/año/i.test(label) ? 'YEAR' : null;
  return { label, min: values[0] ?? null, max: values[1] ?? values[0] ?? null, period };
}

function parseListing(html) {
  const anchors = [...String(html).matchAll(/<a\s+name=["'](rf-[a-z0-9]+)["'][^>]*><\/a>/gi)];
  const jobs = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const detectedEnd = anchors[index + 1]?.index ?? html.indexOf('Ofertas de Empleo<nav', anchors[index].index);
    const block = html.slice(anchors[index].index, detectedEnd > anchors[index].index ? detectedEnd : html.length);
    const id = anchors[index][1];
    const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const url = cleanTecnoempleoUrl(titleMatch[1]);
    const companyMatch = block.match(/<a\s+title=["']Ofertas de Empleo[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const mobileSummary = block.match(/d-block d-lg-none[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const desktopSummary = block.match(/col-12 col-lg-3[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const summary = plainText(mobileSummary || desktopSummary);
    const descriptionBlock = block.match(/hidden-md-down text-gray-800[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const technologies = [...block.matchAll(/<span[^>]*class=["'][^"']*badge[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map(match => plainText(match[1])).filter(Boolean);
    const description = plainText(descriptionBlock.replace(/<span\b[\s\S]*$/i, ''));
    const salaryMatch = plainText(block).match(/([\d.]+\s*€\s*-\s*[\d.]+\s*€\s*b\s*\/\s*[am])/i);
    const salary = parseSalary(salaryMatch?.[1] || '');
    const modality = plainText(summary.replace(/\s*-\s*\d{2}\/\d{2}\/\d{4}[\s\S]*$/, ''));
    jobs.push({
      source: 'Tecnoempleo', source_id: id, slug: `tecnoempleo-${id}`, title: plainText(titleMatch[3] || titleMatch[2]),
      company: plainText(companyMatch?.[1] || ''), author: plainText(companyMatch?.[1] || ''), description,
      url, country: 'España', countries: ['España'], location: modality, modality,
      workday: '', salary: salary.label || 'No indicado', budget: salary.label || 'No indicado',
      budget_eur_min: salary.min, budget_eur_max: salary.max, salary_period: salary.period,
      language: 'es', published_at: parseDate(summary || desktopSummary), published_label: '', urgent: /Nueva/i.test(summary),
      minimumStudies: '', minimumExperience: '', requiredLanguages: [], technologies,
      tecnoempleoDetailLoaded: false,
    });
  }
  const total = Number(html.match(/\d+\s*-\s*\d+\s+de\s+<b>([\d.]+)<\/b>\s+Ofertas/i)?.[1]?.replace(/\./g, '')) || jobs.length;
  const pages = Math.max(1, ...[...html.matchAll(/[?&](?:amp;)?pagina=(\d+)/gi)].map(match => Number(match[1])));
  return { jobs, total, pages };
}

function parseJobPosting(html) {
  for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      const values = Array.isArray(value) ? value : [value];
      const posting = values.find(item => item?.['@type'] === 'JobPosting');
      if (posting) return posting;
    } catch {}
  }
  throw new Error('el detalle no contiene datos JobPosting válidos');
}

function sanitizeDescriptionHtml(value) {
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
  }).trim();
}

function detailBlockValue(html, label) {
  for (const match of String(html).matchAll(/<li\b[^>]*class=["'][^"']*list-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const blockLabel = plainText(block.match(/<span\b[^>]*class=["'][^"']*d-inline-block[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    if (blockLabel.toLocaleLowerCase('es') !== label.toLocaleLowerCase('es')) continue;
    return plainText(block.match(/<span\b[^>]*class=["'][^"']*float-end[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  }
  return '';
}

function labeledParagraphValue(html, label) {
  const expected = `${label.toLocaleLowerCase('es')}:`;
  for (const match of String(html).matchAll(/<p\b[^>]*class=["'][^"']*m-0[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = plainText(match[1]);
    if (text.toLocaleLowerCase('es').startsWith(expected)) return text.slice(text.indexOf(':') + 1).trim();
  }
  return '';
}

function parseDetail(html) {
  const posting = parseJobPosting(html);
  const detail = detailFromPosting(posting);
  const descriptionBlock = String(html).match(/<div\b[^>]*itemprop=["']description["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*fs--16[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const descriptionHtml = sanitizeDescriptionHtml(descriptionBlock);
  const location = detailBlockValue(html, 'Ubicación');
  const workday = detailBlockValue(html, 'Jornada');
  return {
    ...detail,
    descriptionHtml,
    minimumExperience: detailBlockValue(html, 'Experiencia'),
    minimumStudies: labeledParagraphValue(html, 'Formación Mínima'),
    requiredLanguages: labeledParagraphValue(html, 'Idiomas')
      .split(/[,;|]/).map(value => value.trim()).filter(Boolean),
    location: location || detail.location,
    modality: /remoto|teletrabajo/i.test(location) ? location : detail.modality,
    workday: workday || detail.workday,
    functions: detailBlockValue(html, 'Funciones'),
    contractType: detailBlockValue(html, 'Tipo contrato'),
  };
}

function detailFromPosting(posting) {
  const address = posting?.jobLocation?.address || {};
  const location = [address.addressLocality, address.addressRegion].filter((value, index, values) => value && values.indexOf(value) === index).join(', ');
  return {
    description: plainText(posting.description), company: plainText(posting.hiringOrganization?.name),
    author: plainText(posting.hiringOrganization?.name), published_at: posting.datePosted || null,
    workday: posting.employmentType === 'FULL_TIME' ? 'Jornada completa' : plainText(posting.employmentType),
    location: posting.jobLocationType === 'TELECOMMUTE' ? '100% remoto' : location,
    modality: posting.jobLocationType === 'TELECOMMUTE' ? '100% remoto' : '', tecnoempleoDetailLoaded: true,
  };
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(delayMs * attempt * 2);
    }
  }
  throw lastError;
}

async function runSearch(search) {
  const firstUrl = new URL(buildSearchUrl(search));
  firstUrl.searchParams.delete('pagina');
  const jobs = new Map();
  let pages = 1;
  let total = 0;
  for (let page = 1; page <= Math.min(pages, maximumPages); page += 1) {
    const pageUrl = new URL(firstUrl);
    if (page > 1) pageUrl.searchParams.set('pagina', String(page));
    process.stderr.write(`Tecnoempleo: descargando página ${page}${pages > 1 ? `/${pages}` : ''}…\n`);
    const parsed = parseListing(await fetchHtml(pageUrl));
    pages = parsed.pages;
    total = parsed.total;
    for (const job of parsed.jobs) jobs.set(job.source_id, job);
    if (page < pages) await wait(delayMs);
  }
  return { jobs: [...jobs.values()], total, pages: Math.min(pages, maximumPages), url: firstUrl.toString() };
}

async function writeJsonAtomically(file, value) {
  const temporaryFile = `${file}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, file);
}

async function main() {
  const result = await runSearch({ url: directUrl, keyword, city });
  const document = { scraped_at: new Date().toISOString(), source: result.url, method: 'public-html', complete: result.jobs.length >= Math.min(result.total, maximumPages * 30), pages_scraped: result.pages, total_elements_at_start: result.total, unique_records: result.jobs.length, jobs: result.jobs };
  await fs.promises.mkdir(dataRoot, { recursive: true });
  await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'Tecnoempleo', unique_records: result.jobs.length, total_elements_at_start: result.total, scraped_at: document.scraped_at })}\n`);
}

async function runChild(search, directory) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename], { env: { ...process.env, DATA_DIR: directory, TECNOEMPLEO_SEARCHES: '', TECNOEMPLEO_URL: search.url || '', TECNOEMPLEO_KEYWORD: search.keyword || '', TECNOEMPLEO_CITY: search.city || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => process.stderr.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`la búsqueda terminó con código ${code}`)));
  });
}

async function mainBatch() {
  let searches;
  try { searches = JSON.parse(process.env.TECNOEMPLEO_SEARCHES || '[]'); } catch { throw new Error('las búsquedas de Tecnoempleo no son válidas'); }
  if (!Array.isArray(searches) || !searches.length) return main();
  const jobs = new Map();
  const completed = [];
  for (const search of searches.slice(0, 20)) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-tecnoempleo-'));
    try {
      await runChild(search, directory);
      const document = JSON.parse(await fs.promises.readFile(path.join(directory, 'jobs.json'), 'utf8'));
      for (const job of document.jobs || []) jobs.set(job.source_id, job);
      completed.push({ url: search.url || '', keyword: search.keyword || '', city: search.city || '', total_elements: document.total_elements_at_start || 0 });
    } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
  }
  const document = { scraped_at: new Date().toISOString(), source: `${baseUrl}/ofertas-trabajo/`, queries: completed, method: 'public-html', complete: true, unique_records: jobs.size, jobs: [...jobs.values()] };
  await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'Tecnoempleo', searches: completed.length, unique_records: jobs.size, scraped_at: document.scraped_at })}\n`);
}

function hasBatchSearches(value) {
  try { const searches = JSON.parse(value || '[]'); return Array.isArray(searches) && searches.length > 0; } catch { return false; }
}

if (require.main === module) (hasBatchSearches(process.env.TECNOEMPLEO_SEARCHES) ? mainBatch() : main()).catch(error => { process.stderr.write(`Tecnoempleo: ${error.message}\n`); process.exitCode = 1; });

module.exports = { buildSearchUrl, cleanTecnoempleoUrl, detailFromPosting, hasBatchSearches, parseDetail, parseJobPosting, parseListing, parseSalary, plainText, sanitizeDescriptionHtml, slugify };
