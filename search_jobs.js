#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const dataRoot = process.env.DATA_DIR || root;
const outputFile = path.join(dataRoot, 'jobs.json');

function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script)], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split('\n').at(-1) || `${script} terminó con código ${code}`)));
  });
}

async function readJobs(directory) {
  const document = JSON.parse(await fs.promises.readFile(path.join(directory, 'jobs.json'), 'utf8'));
  return Array.isArray(document.jobs) ? document.jobs : [];
}

async function main() {
  const searches = JSON.parse(process.env.JOB_SEARCHES || '[]');
  const allPlatforms = ['infojobs', 'empleate', 'tecnoempleo', 'jobtoday', 'infoempleo', 'eurofirms', 'infofeina', 'feinaactiva'];
  let selectedPlatforms = allPlatforms;
  try {
    const parsed = JSON.parse(process.env.JOB_PLATFORMS || 'null');
    if (Array.isArray(parsed)) selectedPlatforms = parsed.filter(item => allPlatforms.includes(item));
  } catch { throw new Error('La selección de plataformas no es válida'); }
  const selected = new Set(selectedPlatforms);
  const simple = searches.filter(item => !item.url);
  const infoJobs = [...(selected.has('infojobs') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)infojobs\.net$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const empleate = [...(selected.has('empleate') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)empleate\.gob\.es$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const tecnoempleo = [...(selected.has('tecnoempleo') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)tecnoempleo\.com$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const jobToday = [...(selected.has('jobtoday') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)jobtoday\.com$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const infoempleo = [...(selected.has('infoempleo') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)infoempleo\.com$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const eurofirms = [...(selected.has('eurofirms') ? simple : []), ...searches.filter(item => {
    try { return /(^|\.)eurofirms\.com$/i.test(new URL(item.url).hostname); } catch { return false; }
  })];
  const infofeina = [...(selected.has('infofeina') ? simple : []), ...searches.filter(item => { try { return /(^|\.)infofeina\.com$/i.test(new URL(item.url).hostname); } catch { return false; } })];
  const feinaActiva = [...(selected.has('feinaactiva') ? simple : []), ...searches.filter(item => { try { return /^feinaactiva\.gencat\.cat$/i.test(new URL(item.url).hostname); } catch { return false; } })];
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-search-'));
  const infoJobsRoot = path.join(temporaryRoot, 'infojobs');
  const empleateRoot = path.join(temporaryRoot, 'empleate');
  const tecnoempleoRoot = path.join(temporaryRoot, 'tecnoempleo');
  const jobTodayRoot = path.join(temporaryRoot, 'jobtoday');
  const infoempleoRoot = path.join(temporaryRoot, 'infoempleo');
  const eurofirmsRoot = path.join(temporaryRoot, 'eurofirms');
  const infofeinaRoot = path.join(temporaryRoot, 'infofeina');
  const feinaActivaRoot = path.join(temporaryRoot, 'feinaactiva');
  await Promise.all([fs.promises.mkdir(infoJobsRoot), fs.promises.mkdir(empleateRoot), fs.promises.mkdir(tecnoempleoRoot), fs.promises.mkdir(jobTodayRoot), fs.promises.mkdir(infoempleoRoot), fs.promises.mkdir(eurofirmsRoot), fs.promises.mkdir(infofeinaRoot), fs.promises.mkdir(feinaActivaRoot)]);
  try {
    const tasks = [];
    if (infoJobs.length) tasks.push({ source: 'InfoJobs', promise: run('scrape_infojobs.js', {
      DATA_DIR: infoJobsRoot,
      INFOJOBS_PAGES: 'all',
      INFOJOBS_CONCURRENCY: '1',
      INFOJOBS_DELAY_MS: '750',
      INFOJOBS_SEARCHES: JSON.stringify(infoJobs),
    }).then(() => readJobs(infoJobsRoot)) });
    if (empleate.length) tasks.push({ source: 'Empléate', promise: run('scrape_empleate.js', {
      DATA_DIR: empleateRoot,
      EMPLEATE_SEARCHES: JSON.stringify(empleate),
    }).then(() => readJobs(empleateRoot)) });
    if (tecnoempleo.length) tasks.push({ source: 'Tecnoempleo', promise: run('scrape_tecnoempleo.js', {
      DATA_DIR: tecnoempleoRoot,
      TECNOEMPLEO_SEARCHES: JSON.stringify(tecnoempleo),
    }).then(() => readJobs(tecnoempleoRoot)) });
    if (jobToday.length) tasks.push({ source: 'Job Today', promise: run('scrape_jobtoday.js', {
      DATA_DIR: jobTodayRoot,
      JOBTODAY_SEARCHES: JSON.stringify(jobToday),
    }).then(() => readJobs(jobTodayRoot)) });
    if (infoempleo.length) tasks.push({ source: 'Infoempleo', promise: run('scrape_infoempleo.js', {
      DATA_DIR: infoempleoRoot,
      INFOEMPLEO_SEARCHES: JSON.stringify(infoempleo),
    }).then(() => readJobs(infoempleoRoot)) });
    if (eurofirms.length) tasks.push({ source: 'Eurofirms', promise: run('scrape_eurofirms.js', {
      DATA_DIR: eurofirmsRoot,
      EUROFIRMS_SEARCHES: JSON.stringify(eurofirms),
    }).then(() => readJobs(eurofirmsRoot)) });
    if (infofeina.length) tasks.push({ source: 'Infofeina', promise: run('scrape_infofeina.js', { DATA_DIR: infofeinaRoot, INFOFEINA_SEARCHES: JSON.stringify(infofeina) }).then(() => readJobs(infofeinaRoot)) });
    if (feinaActiva.length) tasks.push({ source: 'Feina Activa', promise: run('scrape_feinaactiva.js', { DATA_DIR: feinaActivaRoot, FEINAACTIVA_SEARCHES: JSON.stringify(feinaActiva) }).then(() => readJobs(feinaActivaRoot)) });
    const settled = await Promise.allSettled(tasks.map(task => task.promise));
    const results = [];
    const warnings = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') results.push(result.value);
      else {
        const source = tasks[index].source;
        const message = String(result.reason?.message || 'error desconocido').replace(new RegExp(`^${source}:\\s*`, 'i'), '');
        warnings.push(`${source}: ${message}`);
      }
    });
    if (!results.length) throw new Error(warnings.join(' | ') || 'No se pudo consultar ninguna plataforma');
    for (const warning of warnings) process.stderr.write(`Aviso: ${warning}\n`);
    const jobs = new Map();
    for (const sourceJobs of results) for (const job of sourceJobs) jobs.set(`${job.source}:${job.source_id || job.url}`, job);
    const scrapedAt = new Date().toISOString();
    const document = { scraped_at: scrapedAt, unique_records: jobs.size, jobs: [...jobs.values()] };
    const temporaryFile = `${outputFile}.tmp`;
    await fs.promises.writeFile(temporaryFile, `${JSON.stringify(document, null, 2)}\n`);
    await fs.promises.rename(temporaryFile, outputFile);
    process.stdout.write(JSON.stringify({
      source: 'Búsqueda combinada',
      unique_records: jobs.size,
      scraped_at: scrapedAt,
      partial: warnings.length > 0,
      warnings,
    }));
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
