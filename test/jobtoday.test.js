const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, cleanJobTodayUrl, normalizeOffer, parseDetail, parseListing } = require('../scrape_jobtoday');

test('construye la URL SEO para puesto y ciudad', () => {
  assert.equal(buildSearchUrl({ keyword: 'Programador Java', city: 'Girona' }), 'https://jobtoday.com/es/trabajos-programador-java-en/girona');
  assert.match(buildSearchUrl({ url: 'https://jobtoday.com/es/trabajos-it-en/girona' }), /trabajos-it-en\/girona/);
  assert.equal(
    buildSearchUrl({ url: 'https://jobtoday.com/es/trabajos-informatica_f_sin-experiencia/girona?languageCodes=es' }),
    'https://jobtoday.com/es/trabajos-informatica_f_sin-experiencia/girona?languageCodes=es'
  );
  assert.equal(cleanJobTodayUrl('https://example.com/es/trabajos-it'), '');
  assert.equal(cleanJobTodayUrl(''), '');
  assert.throws(() => buildSearchUrl({ url: 'https://jobtoday.com/es/candidates/girona' }), /listado público/);
});

test('normaliza una oferta pública de Job Today', () => {
  const job = normalizeOffer({
    key: 'es123', role: 'Desarrollador/a Java', companyName: 'Empresa',
    description: 'Puesto 100% remoto', addressInfo: { display: { cityAddress: 'Girona' } },
    createDate: Date.parse('2026-09-03T10:00:00Z'),
    externalUrl: 'https://via.jobtoday.com/v2?job=es123', urgent: true,
    categories: [{ label: 'Tecnología de la información' }],
  });
  assert.equal(job.source, 'Job Today');
  assert.equal(job.source_id, 'es123');
  assert.equal(job.modality, 'Teletrabajo');
  assert.equal(job.location, 'Girona');
  assert.deepEqual(job.categories, ['Tecnología de la información']);
  assert.match(job.url, /^https:\/\/via\.jobtoday\.com\/v2/);
});

test('extrae únicamente ofertas del estado SSR', () => {
  const data = { props: { pageProps: { pageMeta: { tags: { title: '204 Mejores trabajos' } }, pagination: { currentPage: 1, hasNext: true }, feed: { sections: [{ items: [
    { type: 'job', payload: { key: 'es1', role: 'IT', externalUrl: 'https://via.jobtoday.com/v2?job=es1' } },
    { type: 'candidate', payload: { key: 'persona' } },
  ] }] } } } };
  const result = parseListing(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.total, 204);
  assert.equal(result.pagination.hasNext, true);
});

test('reconoce el contador del título español actual', () => {
  const data = { props: { pageProps: { pageMeta: { tags: { title: 'Buscar empleo: 209 ofertas de trabajo de it en Girona' } }, pagination: { hasNext: false }, feed: { sections: [] } } } };
  assert.equal(parseListing(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`).total, 209);
});

test('extrae experiencia, idiomas, jornada y salario del detalle público', () => {
  const offer = {
    key: 'LKV2rA', role: 'Auxiliar Administrativo/a', description: 'Descripción',
    canonicalUrl: '/es/trabajo/auxiliar-administrativo-a-LKV2rA', experienceNotRequired: true,
    employmentType: 'PART_TIME', salary: { from: 500, to: 900, currencyCode: 'EUR', period: 'MONTHLY', isValid: true },
    languages: [{ language: { es: 'Español' }, level: 'ADVANCED' }],
    formattedDetails: [
      { title: { es: 'Jornada' }, content: { text: { es: '*Parcial*' } } },
      { title: { es: 'Salario' }, content: { text: { es: '*500 € – 900 € mensual*' } } },
    ],
    descriptionHTML: '<div><p>Descripción <strong>completa</strong></p><br><ul><li>Primera condición</li><li><strong>Segunda</strong> condición</li></ul></div>',
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { job: offer } } })}</script>`;
  const detail = parseDetail(html);
  assert.equal(detail.minimumExperience, 'Sin experiencia');
  assert.deepEqual(detail.requiredLanguages, ['Español · Avanzado']);
  assert.equal(detail.workday, 'Parcial');
  assert.equal(detail.salary, '500 € – 900 € mensual');
  assert.equal(detail.budget_eur_min, 500);
  assert.equal(detail.budget_eur_max, 900);
  assert.match(detail.descriptionHtml, /<strong>completa<\/strong>/);
  assert.match(detail.descriptionHtml, /<br><ul><li>Primera condición<\/li><li><strong>Segunda<\/strong> condición<\/li><\/ul>/);
});
