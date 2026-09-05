const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, normalizeOffer, parseSearchItem, safeExternalUrl } = require('../scrape_empleate');

test('convierte puesto y ciudad en el término utilizado por Empléate', () => {
  assert.deepEqual(parseSearchItem({ keyword: 'Programador', city: 'Girona' }), {
    term: 'Programador Girona',
  });
});

test('solo conserva enlaces web seguros de ofertas externas', () => {
  assert.equal(safeExternalUrl('https://empresa.example/oferta?id=1'), 'https://empresa.example/oferta?id=1');
  assert.equal(safeExternalUrl('javascript:alert(1)'), '');
  assert.equal(safeExternalUrl('no es una URL'), '');
});

test('extrae search de una URL avanzada de Empléate', () => {
  const url = 'https://www.empleate.gob.es/empleo/#/trabajo?search=it%20girona&pag=0';
  assert.deepEqual(parseSearchItem({ url }), { term: 'it girona', url });
  const provinceUrl = 'https://www.empleate.gob.es/empleo/#/trabajo?search=it&pag=0&provincia=17';
  assert.equal(buildSearchUrl(parseSearchItem({ url: provinceUrl })), provinceUrl);
  assert.throws(() => parseSearchItem({ url: 'https://example.com/?search=it' }), /debe pertenecer a Empléate/);
});

test('normaliza una oferta estructurada de Empléate', () => {
  const job = normalizeOffer({
    id: 123,
    titulo: 'Desarrollador',
    creador: 'Empresa',
    contenido: 'Descripción completa',
    ciudadF: 'Girona',
    provinciaF: 'GIRONA',
    paisF: 'ESPAÑA',
    educacionF: 'GRADO',
    jornadaF: 'COMPLETA',
    url: 'https://empresa.example/oferta?id=123',
    fechaCreacionPortal: '2026-08-30T00:00:00Z',
  });
  assert.equal(job.source, 'Empléate');
  assert.equal(job.source_id, '123');
  assert.equal(job.title, 'Desarrollador');
  assert.equal(job.location, 'Girona');
  assert.equal(job.minimumStudies, 'GRADO');
  assert.match(job.url, /#\/oferta\/123$/);
  assert.equal(job.external_url, 'https://empresa.example/oferta?id=123');
});
