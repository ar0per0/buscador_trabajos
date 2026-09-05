const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanOfferUrl,
  hasBatchSearches,
  normalizeOffer,
  salaryLabel,
  sanitizeInfoJobsDescription,
} = require('../scrape_infojobs');

test('activa el modo de búsquedas también cuando solo hay una búsqueda', () => {
  assert.equal(hasBatchSearches('[{"keyword":"odontólogo","city":"Girona"}]'), true);
  assert.equal(hasBatchSearches('[]'), false);
  assert.equal(hasBatchSearches('no es json'), false);
});

test('normaliza ofertas y elimina parámetros de seguimiento de InfoJobs', () => {
  const job = normalizeOffer({
    code: 'abc',
    title: 'Desarrollador',
    companyName: 'Empresa',
    city: 'Girona',
    link: '/girona/desarrollador/of-iabc?navOrigen=busqueda&tracking=1#contenido',
    salary: { range: { min: 30000, max: 40000 }, period: 'YEAR' },
  });
  assert.equal(job.source, 'InfoJobs');
  assert.equal(job.source_id, 'abc');
  assert.equal(job.url, 'https://www.infojobs.net/girona/desarrollador/of-iabc');
  assert.equal(job.salary, '30.000 € - 40.000 €/año');
  assert.equal(job.budget_eur_min, 30000);
  assert.equal(job.budget_eur_max, 40000);
  assert.equal(salaryLabel(), 'No indicado');
  assert.equal(cleanOfferUrl('https://www.infojobs.net/oferta?a=1#x'), 'https://www.infojobs.net/oferta');
  assert.equal(cleanOfferUrl('javascript:alert(1)'), '');
  assert.equal(cleanOfferUrl('https://example.com/oferta'), '');
});

test('sanea la descripción enriquecida de InfoJobs', () => {
  assert.equal(
    sanitizeInfoJobsDescription('<p onclick="x">Hola <strong>mundo</strong><script>alert(1)</script><a href="x">enlace</a></p>'),
    '<p>Hola <strong>mundo</strong>enlace</p>',
  );
});
