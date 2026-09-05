const state = { jobs: [], regularJobs: [], filtered: [], sourceFilters: new Set(), sourceFilterActive: false, page: 1, pageSize: 16, detailJob: null, detailRemovedIndex: null, searchProfiles: [], interestLinkSections: [], searchSubmitted: false, regularSearchSubmitted: false, favoritesView: false, awaitingSearchCompletion: false, hasCompletedSearch: false };
const elements = Object.fromEntries([
  'totalJobs', 'infojobsCount', 'empleateCount', 'tecnoempleoCount', 'jobtodayCount', 'infoempleoCount', 'eurofirmsCount', 'infofeinaCount', 'feinaactivaCount', 'infojobsUpdated', 'refreshStatus',
  'jobSearchForm', 'searchRows', 'addSearchRow', 'advancedUrlRows', 'addAdvancedUrlRow', 'searchInput', 'citySearchInput', 'citySuggestions', 'contentSearchFilter', 'excludeInput', 'sourceFilter', 'selectedSources', 'minPriceFilter', 'maxPriceFilter', 'minPriceValue', 'maxPriceValue', 'priceRangeTrack', 'typeFilter', 'dateFilter', 'dateFilterValue', 'dateRangeTrack', 'sortOrder', 'showSeenFilter', 'favoritesOnlyFilter',
  'profileName', 'profileSelect', 'saveProfile', 'deleteProfile', 'importProfiles', 'exportProfiles', 'profilesFileInput', 'profileStatus', 'profileShortcuts', 'profileShortcutList',
  'openInterestLinks', 'interestLinkShortcuts', 'interestLinksDialog', 'closeInterestLinks', 'importInterestLinks', 'exportInterestLinks', 'interestLinksFileInput', 'interestSectionForm', 'interestSectionName', 'interestLinkForm', 'interestLinkEditIndex', 'interestLinkEditSection', 'interestLinkSection', 'interestLinkDescription', 'interestLinkUrl', 'cancelInterestLinkEdit', 'interestLinksStatus', 'interestLinksList',
  'filterToggle', 'filtersContent', 'advancedFiltersIndicator', 'clearFilters', 'loading', 'error', 'favoriteManagement', 'favoriteManagementStatus', 'checkFavoriteLinks', 'cleanBrokenFavorites', 'cleanOldFavorites', 'jobGrid', 'pagination', 'previousPage',
  'nextPage', 'pageInfo', 'resultsSummary', 'jobDialog', 'closeDialog', 'dialogContent', 'dialogExternalLink', 'dialogSeenToggle', 'dialogFavoriteToggle', 'dialogPreviousJob', 'dialogNextJob', 'dialogJobPosition'
].map(id => [id, document.getElementById(id)]));

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);
const normalizeText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es');

function sanitizeRichHtml(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value || '');
  const allowedTags = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BR']);
  [...template.content.querySelectorAll('*')].forEach(element => {
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(element.tagName)) {
      element.remove();
      return;
    }
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
  });
  return template.innerHTML;
}

function normalizePlatformJobUrl(job) {
  if (job?.source === 'Empléate' && job.source_id) {
    job.url = `https://www.empleate.gob.es/empleo/#/oferta/${encodeURIComponent(job.source_id)}`;
  }
  return job;
}

const platformSelectionStorageKey = 'web-trabajos.platform-selection.v1';
const interestLinksStorageKey = 'web-trabajos.interest-links.v1';
const simplePlatformLabels = {
  infojobs: 'InfoJobs',
  empleate: 'Empléate',
  tecnoempleo: 'Tecnoempleo',
  jobtoday: 'Job Today',
  infoempleo: 'Infoempleo',
  eurofirms: 'Eurofirms',
  infofeina: 'Infofeina',
  feinaactiva: 'Feina Activa',
};

function savePlatformSelectionState() {
  try {
    const selection = Object.fromEntries(
      [...document.querySelectorAll('input[name="simplePlatform"]')]
        .map(input => [input.value, input.checked])
    );
    localStorage.setItem(platformSelectionStorageKey, JSON.stringify(selection));
  } catch (_) {
    // La interfaz sigue funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

function updatePlatformCardState(input) {
  const card = input.closest('.stat-platform');
  if (!card) return;
  card.setAttribute('role', 'checkbox');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-checked', String(input.checked));
  card.setAttribute('aria-label', `${input.checked ? 'Excluir' : 'Incluir'} ${simplePlatformLabels[input.value]} en la búsqueda`);
}

function restorePlatformSelectionState() {
  try {
    const saved = JSON.parse(localStorage.getItem(platformSelectionStorageKey));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    document.querySelectorAll('input[name="simplePlatform"]').forEach(input => {
      if (typeof saved[input.value] === 'boolean') input.checked = saved[input.value];
      updatePlatformCardState(input);
    });
  } catch (_) {
    // Se mantiene la selección predeterminada si no hay una preferencia válida.
  }
}

function readSearchProfiles() {
  return [...state.searchProfiles];
}

function validInterestLinkUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function saveInterestLinks() {
  try {
    localStorage.setItem(interestLinksStorageKey, JSON.stringify({ sections: state.interestLinkSections }));
  } catch (_) {
    elements.interestLinksStatus.textContent = 'No se pudieron guardar los enlaces en este navegador.';
  }
}

function renderInterestLinks() {
  const links = state.interestLinkSections.flatMap(section => section.links);
  elements.interestLinkShortcuts.innerHTML = links.map(link =>
    `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.description)}">${escapeHtml(link.description)}</a>`
  ).join('');
  elements.interestLinkSection.innerHTML = state.interestLinkSections.map((section, index) =>
    `<option value="${index}">${escapeHtml(section.name)}</option>`
  ).join('');
  elements.interestLinksList.innerHTML = state.interestLinkSections.length
    ? state.interestLinkSections.map((section, sectionIndex) => `
      <section class="interest-section">
        <header class="interest-section-header">
          <strong>${escapeHtml(section.name)}</strong>
          <button type="button" class="interest-icon-button" data-rename-interest-section="${sectionIndex}" aria-label="Renombrar apartado ${escapeHtml(section.name)}" title="Renombrar apartado"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path></svg></button>
          <button type="button" class="interest-icon-button delete-interest-section" data-delete-interest-section="${sectionIndex}" aria-label="Eliminar apartado ${escapeHtml(section.name)}" title="Eliminar apartado"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"></path></svg></button>
        </header>
        <div class="interest-section-links">
          ${section.links.length ? section.links.map((link, linkIndex) => `
            <div class="interest-link-row">
              <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.url)}">${escapeHtml(link.description)}</a>
              <button type="button" class="interest-icon-button" data-edit-interest-link="${linkIndex}" data-interest-section="${sectionIndex}" aria-label="Modificar enlace ${escapeHtml(link.description)}" title="Modificar enlace"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path></svg></button>
              <button type="button" class="interest-icon-button delete-interest-link" data-delete-interest-link="${linkIndex}" data-interest-section="${sectionIndex}" aria-label="Eliminar enlace ${escapeHtml(link.description)}" title="Eliminar enlace"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"></path></svg></button>
            </div>`).join('') : '<p class="empty-interest-section">Este apartado todavía no contiene enlaces.</p>'}
        </div>
      </section>`).join('')
    : '<p class="empty-interest-links">Crea un apartado para empezar a guardar enlaces.</p>';
  elements.interestLinkForm.querySelector('button[type="submit"]').disabled = state.interestLinkSections.length === 0;
}

function normalizeInterestLinksDocument(documentValue) {
  const cleanLinks = items => items.slice(0, 100).map(item => ({
    description: String(item?.description || '').trim().slice(0, 80),
    url: validInterestLinkUrl(item?.url),
  })).filter(item => item.description && item.url);
  if (Array.isArray(documentValue)) {
    const legacyLinks = cleanLinks(documentValue);
    return legacyLinks.length ? [{ name: 'General', links: legacyLinks }] : [];
  }
  const sections = Array.isArray(documentValue?.sections) ? documentValue.sections : null;
  if (!sections) throw new Error('El archivo no contiene apartados de enlaces válidos');
  return sections.slice(0, 30).map(section => ({
    name: String(section?.name || '').trim().slice(0, 60),
    links: cleanLinks(Array.isArray(section?.links) ? section.links : []),
  })).filter(section => section.name);
}

function loadInterestLinks() {
  try {
    const saved = JSON.parse(localStorage.getItem(interestLinksStorageKey) || '[]');
    state.interestLinkSections = normalizeInterestLinksDocument(saved);
  } catch (_) {
    state.interestLinkSections = [];
  }
  renderInterestLinks();
}

function resetInterestLinkForm() {
  elements.interestLinkForm.reset();
  elements.interestLinkEditIndex.value = '';
  elements.interestLinkEditSection.value = '';
  elements.cancelInterestLinkEdit.hidden = true;
}

function renderSearchProfiles(selectedName = '') {
  const profiles = readSearchProfiles().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  elements.profileSelect.innerHTML = '<option value="">Selecciona un perfil…</option>'
    + profiles.map(profile => `<option value="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</option>`).join('');
  elements.profileSelect.value = profiles.some(profile => profile.name === selectedName) ? selectedName : '';
  const hasSelection = Boolean(elements.profileSelect.value);
  elements.deleteProfile.disabled = !hasSelection;
  elements.profileShortcuts.hidden = false;
  elements.profileShortcutList.innerHTML = profiles.map(profile => `
    <button type="button" class="profile-shortcut${profile.name === elements.profileSelect.value ? ' is-active' : ''}" data-profile-name="${escapeHtml(profile.name)}"${profile.name === elements.profileSelect.value ? ' aria-current="true"' : ''}>${escapeHtml(profile.name)}</button>`).join('');
}

async function loadSearchProfiles() {
  try {
    const response = await fetch('/api/search-profiles', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles();
  } catch (error) {
    elements.profileStatus.textContent = `No se pudieron cargar los perfiles: ${error.message}`;
  }
}

function currentSearchProfile(name) {
  const selectedPlatforms = [...document.querySelectorAll('input[name="simplePlatform"]:checked')].map(input => input.value);
  const infojobsSearches = [...elements.searchRows.querySelectorAll('[data-infojobs-search-row]')].map(row => ({
    keyword: row.querySelector('.infojobs-keyword').value.trim(),
    city: (row.querySelector('.infojobs-city').dataset.cityValue || row.querySelector('.infojobs-city').value.split(',')[0]).trim(),
  })).filter(item => item.keyword || item.city);
  const infojobsUrls = [...elements.advancedUrlRows.querySelectorAll('[data-infojobs-url-row]')].map(row => ({
    description: row.querySelector('.infojobs-url-description').value.trim(),
    url: row.querySelector('.infojobs-direct-url').value.trim(),
  })).filter(item => item.url);
  return {
    name,
    search: elements.searchInput.value,
    city: elements.citySearchInput.value,
    contentSearch: elements.contentSearchFilter.value,
    exclude: elements.excludeInput.value,
    sources: [...state.sourceFilters],
    sourcesActive: state.sourceFilterActive,
    type: elements.typeFilter.value,
    sort: elements.sortOrder.value,
    priceScaleVersion: 2,
    minPrice: sliderPositionToPrice(elements.minPriceFilter.value),
    maxPrice: sliderPositionToPrice(elements.maxPriceFilter.value),
    date: Number(elements.dateFilter.value),
    showSeen: elements.showSeenFilter.checked,
    favoritesOnly: elements.favoritesOnlyFilter.checked,
    infojobsSearches,
    infojobsUrls,
    selectedPlatforms,
  };
}

function applySearchProfile(profile) {
  hideSearchRowOpenControls();
  const selectedPlatforms = Array.isArray(profile.selectedPlatforms) ? profile.selectedPlatforms : null;
  document.querySelectorAll('input[name="simplePlatform"]').forEach(input => {
    input.checked = !selectedPlatforms || selectedPlatforms.includes(input.value);
    updatePlatformCardState(input);
  });
  savePlatformSelectionState();
  const searches = Array.isArray(profile.infojobsSearches) && profile.infojobsSearches.length
    ? profile.infojobsSearches
    : [{ keyword: profile.search || '', city: profile.city || '' }];
  elements.searchRows.querySelectorAll('[data-infojobs-search-row]').forEach((row, index) => { if (index > 0) row.remove(); });
  elements.searchInput.value = searches[0]?.keyword || '';
  elements.citySearchInput.value = searches[0]?.city || '';
  delete elements.citySearchInput.dataset.cityValue;
  for (const search of searches.slice(1)) {
    elements.addSearchRow.click();
    const row = elements.searchRows.lastElementChild;
    row.querySelector('.infojobs-keyword').value = search.keyword || '';
    row.querySelector('.infojobs-city').value = search.city || '';
  }
  const urls = Array.isArray(profile.infojobsUrls) ? profile.infojobsUrls : [];
  elements.advancedUrlRows.querySelectorAll('[data-infojobs-url-row]').forEach((row, index) => { if (index > 0) row.remove(); });
  const firstUrlRow = elements.advancedUrlRows.firstElementChild;
  firstUrlRow.querySelector('.infojobs-url-description').value = urls[0]?.description || '';
  firstUrlRow.querySelector('.infojobs-direct-url').value = urls[0]?.url || '';
  for (const item of urls.slice(1)) {
    elements.addAdvancedUrlRow.click();
    const row = elements.advancedUrlRows.lastElementChild;
    row.querySelector('.infojobs-url-description').value = item.description || '';
    row.querySelector('.infojobs-direct-url').value = item.url || '';
  }
  elements.excludeInput.value = profile.exclude || '';
  elements.contentSearchFilter.value = profile.contentSearch || '';
  const savedSources = Array.isArray(profile.sources) ? profile.sources : profile.source ? [profile.source] : [];
  state.sourceFilters = new Set(savedSources.length
    ? savedSources
    : [...document.querySelectorAll('input[name="simplePlatform"]:checked')].map(input => simplePlatformLabels[input.value]));
  state.sourceFilterActive = true;
  syncSourceFiltersToPlatformChecks();
  renderSelectedSources();
  elements.typeFilter.value = profile.type || '';
  elements.sortOrder.value = profile.sort || 'newest';
  const usesPriceValues = Number(profile.priceScaleVersion) >= 2;
  const minimumPrice = usesPriceValues ? Number(profile.minPrice) || 0 : legacySliderPositionToPrice(profile.minPrice);
  const maximumPrice = usesPriceValues
    ? (Number.isFinite(Number(profile.maxPrice)) ? Number(profile.maxPrice) : 100000)
    : legacySliderPositionToPrice(Number.isFinite(Number(profile.maxPrice)) ? profile.maxPrice : 105);
  elements.minPriceFilter.value = String(priceToSliderPosition(minimumPrice));
  elements.maxPriceFilter.value = String(priceToSliderPosition(maximumPrice));
  elements.dateFilter.value = String(Math.max(1, Math.min(dateAnyValue, Number(profile.date) || dateAnyValue)));
  elements.showSeenFilter.checked = Boolean(profile.showSeen);
  elements.favoritesOnlyFilter.checked = Boolean(profile.favoritesOnly);
  state.searchSubmitted = Boolean(elements.searchInput.value.trim() || elements.citySearchInput.value.trim() || urls.length);
  updatePriceRange();
  updateDateRange();
  if (elements.favoritesOnlyFilter.checked) loadFavoriteJobs();
  else applyFilters();
}

function formatDate(value) {
  if (!value) return 'Fecha desconocida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha desconocida';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function jobCountries(job) {
  if (Array.isArray(job.countries) && job.countries.length) return job.countries.filter(Boolean);
  return job.country ? [job.country] : [];
}

function populateSources() {
  const sources = [...new Set(state.jobs.map(job => job.source).filter(Boolean))].sort();
  elements.sourceFilter.innerHTML = '<option value="">Añadir plataforma…</option>'
    + sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  normalizeAllSourcesSelection();
  renderSelectedSources();
}

function normalizeAllSourcesSelection() {
  if (!state.sourceFilterActive) return;
  const availableSources = new Set(state.jobs.map(job => job.source).filter(Boolean));
  if (availableSources.size && [...availableSources].every(source => state.sourceFilters.has(source))) {
    state.sourceFilters.clear();
    state.sourceFilterActive = false;
  }
}

function renderSelectedSources() {
  elements.selectedSources.innerHTML = [...state.sourceFilters].sort().map(source => `
    <span class="source-filter-chip">${escapeHtml(source)}<button type="button" data-remove-source="${escapeHtml(source)}" aria-label="Quitar ${escapeHtml(source)}">×</button></span>`).join('');
  for (const option of elements.sourceFilter.options) option.disabled = Boolean(option.value && state.sourceFilters.has(option.value));
  if (elements.sourceFilter.options[0]) elements.sourceFilter.options[0].textContent = state.sourceFilterActive ? 'Añadir plataforma…' : 'Todas las plataformas';
  elements.sourceFilter.value = '';
}

function syncSourceFiltersToPlatformChecks() {
  document.querySelectorAll('input[name="simplePlatform"]').forEach(input => {
    const source = simplePlatformLabels[input.value];
    input.checked = !state.sourceFilterActive || state.sourceFilters.has(source);
    updatePlatformCardState(input);
  });
  savePlatformSelectionState();
}

function syncPlatformChecksToSourceFilters() {
  if (!state.hasCompletedSearch) return;
  const availableSources = new Set(state.jobs.map(job => job.source).filter(Boolean));
  const selectedSources = [...document.querySelectorAll('input[name="simplePlatform"]:checked')]
    .map(input => simplePlatformLabels[input.value])
    .filter(source => availableSources.has(source));
  state.sourceFilters = new Set(selectedSources);
  state.sourceFilterActive = true;
  normalizeAllSourcesSelection();
  renderSelectedSources();
  applyFilters();
}

const priceSliderSteps = 154;
const priceFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});

function sliderPositionToPrice(position) {
  const step = Math.max(0, Math.min(priceSliderSteps, Number(position) || 0));
  if (step <= 50) return step * 10;
  if (step <= 59) return 500 + (step - 50) * 500;
  return 5000 + (step - 59) * 1000;
}

function priceToSliderPosition(price) {
  const value = Math.max(0, Math.min(100000, Number(price) || 0));
  if (value <= 500) return Math.round(value / 10);
  if (value <= 5000) return 50 + Math.round((value - 500) / 500);
  return 59 + Math.round((value - 5000) / 1000);
}

function legacySliderPositionToPrice(position) {
  const step = Math.max(0, Math.min(105, Number(position) || 0));
  return step <= 10 ? step * 500 : 5000 + (step - 10) * 1000;
}

function updatePriceRange(changedElement = null) {
  let minimumPosition = Number(elements.minPriceFilter.value);
  let maximumPosition = Number(elements.maxPriceFilter.value);
  if (minimumPosition > maximumPosition) {
    if (changedElement === elements.minPriceFilter) maximumPosition = minimumPosition;
    else minimumPosition = maximumPosition;
    elements.minPriceFilter.value = String(minimumPosition);
    elements.maxPriceFilter.value = String(maximumPosition);
  }
  elements.minPriceValue.textContent = priceFormatter.format(sliderPositionToPrice(minimumPosition));
  elements.maxPriceValue.textContent = priceFormatter.format(sliderPositionToPrice(maximumPosition));
  elements.priceRangeTrack.style.setProperty('--range-start', `${minimumPosition / priceSliderSteps * 100}%`);
  elements.priceRangeTrack.style.setProperty('--range-end', `${maximumPosition / priceSliderSteps * 100}%`);
}

function initializePriceRange() {
  elements.minPriceFilter.value = '0';
  elements.maxPriceFilter.value = String(priceSliderSteps);
  updatePriceRange();
}

const dateAnyValue = 42;
function datePositionToHours(position) {
  if (position <= 12) return position * 2;
  if (position < dateAnyValue) return (position - 11) * 24;
  return 0;
}

function updateDateRange() {
  const value = Number(elements.dateFilter.value);
  const hours = datePositionToHours(value);
  const label = value === dateAnyValue
    ? 'Cualquier fecha'
    : hours <= 24
      ? `Últimas ${hours} horas`
      : `Últimos ${hours / 24} días`;
  elements.dateFilterValue.textContent = label;
  elements.dateFilter.setAttribute('aria-valuetext', label);
  elements.dateRangeTrack.style.setProperty('--date-progress', `${((value - 1) / (dateAnyValue - 1)) * 100}%`);
}

function applyFilters() {
  if (!state.searchSubmitted) {
    state.filtered = [];
    state.page = 1;
    updateAdvancedFiltersIndicator();
    render();
    return;
  }
  const excludedQueries = elements.excludeInput.value.split(',')
    .map(value => normalizeText(value.trim()))
    .filter(Boolean);
  const contentQueries = elements.contentSearchFilter.value.split(/\s+/).map(normalizeText).filter(Boolean);
  const sources = state.sourceFilters;
  const minimumPosition = Number(elements.minPriceFilter.value);
  const maximumPosition = Number(elements.maxPriceFilter.value);
  const minimumPrice = minimumPosition === 0 ? null : sliderPositionToPrice(minimumPosition);
  const maximumPrice = maximumPosition === priceSliderSteps ? null : sliderPositionToPrice(maximumPosition);
  const type = elements.typeFilter.value;
  const dateValue = Number(elements.dateFilter.value);
  const hours = datePositionToHours(dateValue);
  const cutoff = hours ? Date.now() - hours * 60 * 60 * 1000 : 0;
  const showSeen = elements.showSeenFilter.checked;
  const favoritesOnly = elements.favoritesOnlyFilter.checked;
  state.filtered = state.jobs.filter(job => {
    const haystack = normalizeText([job.title, job.description, job.author, job.company, job.location, job.country, job.category, job.subcategory, job.minimumStudies, job.minimumExperience, ...(job.requiredLanguages || []), ...jobCountries(job)]
      .join(' '));
    const jobMinimum = Number(job.budget_eur_min);
    const jobMaximum = job.budget_eur_max == null ? Infinity : Number(job.budget_eur_max);
    const hasNumericBudget = Number.isFinite(jobMinimum) && !Number.isNaN(jobMaximum);
    return !excludedQueries.some(excludedQuery => haystack.includes(excludedQuery))
      && contentQueries.every(query => haystack.includes(query))
      && (!state.sourceFilterActive || sources.has(job.source))
      && (minimumPrice == null || (hasNumericBudget && jobMaximum >= minimumPrice))
      && (maximumPrice == null || (hasNumericBudget && jobMinimum <= maximumPrice))
      && (!type || normalizeText(job.modality).includes(normalizeText(type)))
      && (!cutoff || new Date(job.published_at || job.published_date).getTime() >= cutoff)
      && (!favoritesOnly || job.favorite)
      && (showSeen || !job.seen);
  });
  const collator = new Intl.Collator('es');
  const order = elements.sortOrder.value;
  state.filtered.sort((a, b) => {
    if (order === 'title') return collator.compare(a.title, b.title);
    if (order === 'country') {
      if (!a.country && b.country) return 1;
      if (a.country && !b.country) return -1;
      return collator.compare(a.country, b.country);
    }
    if (order === 'price-desc' || order === 'price-asc') {
      const priceOf = job => Number(job.budget_eur_max ?? job.budget_eur_min ?? 0);
      const difference = priceOf(a) - priceOf(b);
      return order === 'price-asc' ? difference : -difference;
    }
    const aDate = new Date(a.published_at || a.published_date).getTime() || 0;
    const bDate = new Date(b.published_at || b.published_date).getTime() || 0;
    return order === 'oldest' ? aDate - bDate : bDate - aDate;
  });
  state.page = 1;
  updateAdvancedFiltersIndicator();
  render();
}

function updateAdvancedFiltersIndicator() {
  const activeCount = [
    Boolean(elements.excludeInput.value.trim()),
    state.sourceFilterActive,
    Number(elements.minPriceFilter.value) > 0 || Number(elements.maxPriceFilter.value) < priceSliderSteps,
    Boolean(elements.typeFilter.value),
    Number(elements.dateFilter.value) < dateAnyValue,
    elements.sortOrder.value !== 'newest',
  ].filter(Boolean).reduce((total, value) => total + (typeof value === 'number' ? value : 1), 0);
  elements.advancedFiltersIndicator.hidden = activeCount === 0;
  if (!activeCount) return;
  const label = `${activeCount} avanzados`;
  elements.advancedFiltersIndicator.textContent = label;
  elements.advancedFiltersIndicator.setAttribute('aria-label', `${activeCount} filtros avanzados activos. Abrir buscador y filtros.`);
}

function renderCard(job, index) {
  const badges = [
    job.urgent ? '<span class="badge warm">Urgente</span>' : ''
  ].join('');
  const favoriteStatus = job.link_status === 'ok'
    ? '<span class="favorite-link-status is-ok">Enlace disponible</span>'
    : job.link_status === 'broken'
      ? '<span class="favorite-link-status is-broken">Enlace roto</span>'
      : job.link_checked_at
        ? '<span class="favorite-link-status is-unknown">No se pudo comprobar</span>'
        : '<span class="favorite-link-status is-unknown">Sin comprobar</span>';
  const favoriteMeta = state.favoritesView ? `<div class="favorite-meta">
    <span>Guardado ${escapeHtml(formatDate(job.saved_at))}</span>
    ${favoriteStatus}
  </div>` : '';
  return `<article class="job-card${job.seen ? ' seen' : ''}">
    <div class="card-top">
      <span><b>${escapeHtml(job.source || 'Otra fuente')}</b> · ${escapeHtml(job.location || job.country || 'Sin ubicación')}</span>
      <span class="card-flags">
        <button class="favorite-toggle${job.favorite ? ' is-favorite' : ''}" type="button" data-favorite-index="${index}" aria-label="${job.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-pressed="${job.favorite ? 'true' : 'false'}"><span aria-hidden="true">${job.favorite ? '★' : '☆'}</span></button>
        <label class="seen-toggle"><input type="checkbox" data-seen-index="${index}" ${job.seen ? 'checked' : ''}> Visto</label>
      </span>
      <span>${escapeHtml(formatDate(job.published_at || job.published_date))}</span>
    </div>
    <h2>${escapeHtml(job.title)}</h2>
    <p class="company">${escapeHtml(job.company || job.author || 'Empresa no indicada')}</p>
    ${favoriteMeta}
    <p class="description">${escapeHtml(job.description || 'Sin descripción')}</p>
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    <div class="card-footer">
      <div><small>Salario</small><div class="budget">${escapeHtml(job.salary || job.budget || 'No indicado')}</div></div>
      <div class="card-actions">
        <button class="details" data-job-index="${index}">Detalles</button>
        <a class="external" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>
      </div>
    </div>
  </article>`;
}

function renderPageButtons(pageCount) {
  const pages = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [...new Set([1, 2, state.page - 2, state.page - 1, state.page, state.page + 1, state.page + 2, pageCount - 1, pageCount]
      .filter(page => page >= 1 && page <= pageCount))].sort((a, b) => a - b);
  elements.pageInfo.replaceChildren();
  let previousPage = 0;
  for (const page of pages) {
    if (previousPage && page > previousPage + 1) {
      const gap = document.createElement('span');
      gap.className = 'page-gap';
      gap.textContent = '…';
      elements.pageInfo.append(gap);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary page-button';
    button.dataset.page = String(page);
    button.textContent = String(page);
    button.disabled = page === state.page;
    if (page === state.page) button.setAttribute('aria-current', 'page');
    elements.pageInfo.append(button);
    previousPage = page;
  }
}

function render() {
  const searchReady = state.searchSubmitted;
  elements.favoriteManagement.hidden = !state.favoritesView;
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const jobs = state.filtered.slice(start, start + state.pageSize);
  const hasActiveFilters = Boolean(
    elements.searchInput.value.trim()
    || elements.citySearchInput.value.trim()
    || elements.excludeInput.value.trim()
    || elements.contentSearchFilter.value.trim()
    || state.sourceFilterActive
    || Number(elements.minPriceFilter.value) > 0
    || Number(elements.maxPriceFilter.value) < priceSliderSteps
    || elements.typeFilter.value
    || Number(elements.dateFilter.value) < dateAnyValue
    || elements.favoritesOnlyFilter.checked
    || elements.showSeenFilter.checked
  );
  const resultLabel = state.filtered.length === 1 ? 'resultado encontrado' : 'resultados encontrados';
  elements.resultsSummary.textContent = !searchReady
    ? ''
    : hasActiveFilters
      ? `${state.filtered.length.toLocaleString('es')} ${resultLabel}`
      : `${state.filtered.length.toLocaleString('es')} trabajos disponibles`;
  elements.jobGrid.innerHTML = jobs.length
    ? jobs.map((job, offset) => renderCard(job, start + offset)).join('')
    : `<div class="state">${state.awaitingSearchCompletion
      ? 'Buscando ofertas…'
      : !searchReady
      ? 'Introduce un puesto o una ciudad para buscar trabajos.'
      : state.jobs.length
        ? 'No hay trabajos que coincidan con la búsqueda.'
        : 'Todavía no hay ninguna fuente de empleos integrada.'}</div>`;
  elements.pagination.hidden = state.filtered.length <= state.pageSize;
  elements.previousPage.disabled = state.page === 1;
  elements.nextPage.disabled = state.page === pageCount;
  renderPageButtons(pageCount);
}

function renderDetailsContent(job, loadingRequirements = false) {
  const requirementFallback = loadingRequirements ? 'Cargando…' : 'No indicado';
  const requiredLanguages = Array.isArray(job.requiredLanguages) && job.requiredLanguages.length
    ? job.requiredLanguages.join(', ')
    : requirementFallback;
  const description = job.descriptionHtml
    ? `<div class="dialog-description is-rich">${sanitizeRichHtml(job.descriptionHtml)}</div>`
    : `<div class="dialog-description">${escapeHtml(job.description || 'Sin descripción')}</div>`;
  const currentIndex = state.filtered.indexOf(job);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < state.filtered.length - 1;
  const positionLabel = currentIndex >= 0 ? `${currentIndex + 1} de ${state.filtered.length}` : '';
  elements.dialogPreviousJob.disabled = !hasPrevious;
  elements.dialogNextJob.disabled = !hasNext;
  elements.dialogJobPosition.textContent = positionLabel;
  elements.dialogContent.innerHTML = `
    <p class="dialog-published">Publicado ${escapeHtml(formatDate(job.published_at || job.published_date))}</p>
    <header class="dialog-header">
      <div class="dialog-source-line">
        <span class="dialog-source">${escapeHtml(job.source || 'Oferta')}</span>
        <span>${escapeHtml(job.location || job.country || 'Ubicación no indicada')}</span>
      </div>
      <h2 class="dialog-title">${escapeHtml(job.title)}</h2>
      <p class="dialog-company">${escapeHtml(job.company || job.author || 'Empresa no indicada')}</p>
    </header>
    <div class="detail-list">
      <div><small>Salario</small><strong>${escapeHtml(job.salary || job.budget || 'No indicado')}</strong></div>
      <div><small>Modalidad</small><strong>${escapeHtml(job.modality || 'No indicada')}</strong></div>
      <div><small>Jornada</small><strong>${escapeHtml(job.workday || 'No indicada')}</strong></div>
      <div><small>Estudios mínimos</small><strong>${escapeHtml(job.minimumStudies || requirementFallback)}</strong></div>
      <div><small>Experiencia mínima</small><strong>${escapeHtml(job.minimumExperience || requirementFallback)}</strong></div>
      <div><small>Idiomas requeridos</small><strong>${escapeHtml(requiredLanguages)}</strong></div>
    </div>
    <section class="dialog-description-section">
      <h3>Descripción del puesto</h3>
      ${description}
    </section>`;
}

async function showDetails(job) {
  state.detailJob = job;
  state.detailRemovedIndex = null;
  const needsInfoJobsDetail = job.source === 'InfoJobs'
    && job.url
    && (!job.infoJobsDetailLoaded || !job.descriptionHtml)
    && !job.infoJobsDetailAttempted;
  const needsEmpleateDetail = job.source === 'Empléate'
    && job.source_id
    && !job.empleateDetailLoaded
    && !job.empleateDetailAttempted;
  const needsTecnoempleoDetail = job.source === 'Tecnoempleo'
    && job.url
    && !job.tecnoempleoDetailLoaded
    && !job.tecnoempleoDetailAttempted;
  const needsJobTodayDetail = job.source === 'Job Today'
    && job.url
    && (!job.jobTodayDetailLoaded || !job.descriptionHtml)
    && !job.jobTodayDetailAttempted;
  const needsInfoempleoDetail = job.source === 'Infoempleo' && job.url && !job.infoempleoDetailLoaded && !job.infoempleoDetailAttempted;
  const needsEurofirmsDetail = job.source === 'Eurofirms' && job.url && !job.eurofirmsDetailLoaded && !job.eurofirmsDetailAttempted;
  const needsInfofeinaDetail = job.source === 'Infofeina' && job.url && !job.infofeinaDetailLoaded && !job.infofeinaDetailAttempted;
  const needsFeinaActivaDetail=job.source==='Feina Activa'&&job.url&&!job.feinaActivaDetailLoaded&&!job.feinaActivaDetailAttempted;
  const needsRemoteDetail = needsInfoJobsDetail || needsEmpleateDetail || needsTecnoempleoDetail || needsJobTodayDetail || needsInfoempleoDetail || needsEurofirmsDetail || needsInfofeinaDetail || needsFeinaActivaDetail;
  renderDetailsContent(job, needsRemoteDetail);
  elements.dialogExternalLink.href = job.url || '#';
  elements.dialogExternalLink.textContent = `Ver anuncio en ${job.source || 'la plataforma'} ↗`;
  elements.dialogExternalLink.hidden = !job.url;
  elements.dialogSeenToggle.checked = Boolean(job.seen);
  elements.dialogSeenToggle.disabled = false;
  elements.dialogFavoriteToggle.classList.toggle('is-favorite', Boolean(job.favorite));
  elements.dialogFavoriteToggle.setAttribute('aria-pressed', String(Boolean(job.favorite)));
  elements.dialogFavoriteToggle.setAttribute('aria-label', job.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos');
  elements.dialogFavoriteToggle.querySelector('span').textContent = job.favorite ? '★' : '☆';
  elements.dialogFavoriteToggle.disabled = false;
  if (!elements.jobDialog.open) elements.jobDialog.showModal();
  if (!needsRemoteDetail) return;
  try {
    const detailUrl = needsInfoJobsDetail
      ? `/api/infojobs-detail?url=${encodeURIComponent(job.url)}`
      : needsEmpleateDetail
        ? `/api/empleate-detail?id=${encodeURIComponent(job.source_id)}`
        : needsTecnoempleoDetail ? `/api/tecnoempleo-detail?url=${encodeURIComponent(job.url)}` : needsJobTodayDetail ? `/api/jobtoday-detail?url=${encodeURIComponent(job.url)}` : needsInfoempleoDetail ? `/api/infoempleo-detail?url=${encodeURIComponent(job.url)}` : needsEurofirmsDetail ? `/api/eurofirms-detail?url=${encodeURIComponent(job.url)}` : needsInfofeinaDetail ? `/api/infofeina-detail?url=${encodeURIComponent(job.url)}` : `/api/feinaactiva-detail?url=${encodeURIComponent(job.url)}`;
    const response = await fetch(detailUrl, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    const usefulDetail = Object.fromEntries(Object.entries(result.detail || {}).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== '' && value != null
    )));
    Object.assign(job, usefulDetail);
    if (needsInfoJobsDetail) Object.assign(job, { infoJobsDetailLoaded: true, infoJobsDetailAttempted: true });
    else if (needsEmpleateDetail) Object.assign(job, { empleateDetailLoaded: true, empleateDetailAttempted: true });
    else if (needsTecnoempleoDetail) Object.assign(job, { tecnoempleoDetailLoaded: true, tecnoempleoDetailAttempted: true });
    else if (needsJobTodayDetail) Object.assign(job, { jobTodayDetailLoaded: true, jobTodayDetailAttempted: true });
    else if (needsInfoempleoDetail) Object.assign(job, { infoempleoDetailLoaded: true, infoempleoDetailAttempted: true });
    else if(needsEurofirmsDetail) Object.assign(job,{eurofirmsDetailLoaded:true,eurofirmsDetailAttempted:true});else if(needsInfofeinaDetail)Object.assign(job,{infofeinaDetailLoaded:true,infofeinaDetailAttempted:true});else Object.assign(job,{feinaActivaDetailLoaded:true,feinaActivaDetailAttempted:true});
  } catch {
    if (needsInfoJobsDetail) job.infoJobsDetailAttempted = true;
    else if (needsEmpleateDetail) job.empleateDetailAttempted = true;
    else if (needsTecnoempleoDetail) job.tecnoempleoDetailAttempted = true;
    else if (needsJobTodayDetail) job.jobTodayDetailAttempted = true;
    else if (needsInfoempleoDetail) job.infoempleoDetailAttempted = true;
    else if(needsEurofirmsDetail)job.eurofirmsDetailAttempted=true;else if(needsInfofeinaDetail)job.infofeinaDetailAttempted=true;else job.feinaActivaDetailAttempted=true;
  }
  if (state.detailJob === job && elements.jobDialog.open) renderDetailsContent(job, false);
}

async function setJobSeen(job, nextSeen, input) {
  input.disabled = true;
  try {
    const detailIndexBeforeUpdate = state.detailJob === job ? state.filtered.indexOf(job) : -1;
    const response = await fetch('/api/jobs/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: job.job_key, seen: nextSeen }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    job.seen = nextSeen;
    if (state.detailJob === job) elements.dialogSeenToggle.checked = nextSeen;
    applyFilters();
    if (state.detailJob === job) {
      state.detailRemovedIndex = state.filtered.includes(job) || detailIndexBeforeUpdate < 0
        ? null
        : detailIndexBeforeUpdate;
    }
  } catch (error) {
    input.checked = !nextSeen;
    if (state.detailJob === job) elements.dialogSeenToggle.checked = !nextSeen;
    elements.refreshStatus.textContent = `No se pudo guardar como visto: ${error.message}`;
  } finally {
    input.disabled = false;
  }
}

async function setJobFavorite(job, nextFavorite, button) {
  button.disabled = true;
  try {
    const response = await fetch('/api/jobs/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: job.job_key, favorite: nextFavorite, job }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    job.favorite = nextFavorite;
    if (state.detailJob === job) {
      elements.dialogFavoriteToggle.classList.toggle('is-favorite', nextFavorite);
      elements.dialogFavoriteToggle.setAttribute('aria-pressed', String(nextFavorite));
      elements.dialogFavoriteToggle.setAttribute('aria-label', nextFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos');
      elements.dialogFavoriteToggle.querySelector('span').textContent = nextFavorite ? '★' : '☆';
    }
    applyFilters();
  } catch (error) {
    elements.refreshStatus.textContent = `No se pudo guardar el favorito: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function load() {
  try {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    const data = await response.json();
    state.jobs = (data.jobs || []).map(normalizePlatformJobUrl);
    state.regularJobs = [...state.jobs];
    state.favoritesView = false;
    state.filtered = [...state.jobs];
    elements.totalJobs.textContent = state.hasCompletedSearch ? state.jobs.length.toLocaleString('es') : '0';
    elements.infojobsCount.textContent = state.hasCompletedSearch ? (data.sources?.InfoJobs?.count || 0).toLocaleString('es') : '0';
    elements.empleateCount.textContent = state.hasCompletedSearch ? (data.sources?.['Empléate']?.count || 0).toLocaleString('es') : '0';
    elements.tecnoempleoCount.textContent = state.hasCompletedSearch ? (data.sources?.Tecnoempleo?.count || 0).toLocaleString('es') : '0';
    elements.jobtodayCount.textContent = state.hasCompletedSearch ? (data.sources?.['Job Today']?.count || 0).toLocaleString('es') : '0';
    elements.infoempleoCount.textContent = state.hasCompletedSearch ? (data.sources?.Infoempleo?.count || 0).toLocaleString('es') : '0';
    elements.eurofirmsCount.textContent = state.hasCompletedSearch ? (data.sources?.Eurofirms?.count || 0).toLocaleString('es') : '0';
    elements.infofeinaCount.textContent = state.hasCompletedSearch ? (data.sources?.Infofeina?.count || 0).toLocaleString('es') : '0';
    elements.feinaactivaCount.textContent = state.hasCompletedSearch ? (data.sources?.['Feina Activa']?.count || 0).toLocaleString('es') : '0';
    elements.infojobsUpdated.textContent = state.hasCompletedSearch && data.scraped_at
      ? `Actualizado ${formatDate(data.scraped_at)}`
      : 'Sin buscar';
    populateSources();
    initializePriceRange();
    updateDateRange();
    elements.loading.hidden = true;
    applyFilters();
  } catch (error) {
    elements.loading.hidden = true;
    elements.error.hidden = false;
    elements.error.textContent = `No se pudieron cargar los registros: ${error.message}`;
  }
}

function refreshJobFilterOptions() {
  const availableSources = new Set(state.jobs.map(job => job.source).filter(Boolean));
  state.sourceFilters = new Set([...state.sourceFilters].filter(source => availableSources.has(source)));
  if (!state.sourceFilters.size) state.sourceFilterActive = false;
  populateSources();
  initializePriceRange();
  updateDateRange();
}

async function loadFavoriteJobs() {
  if (!state.favoritesView) {
    state.regularJobs = [...state.jobs];
    state.regularSearchSubmitted = state.searchSubmitted;
  }
  elements.favoritesOnlyFilter.disabled = true;
  try {
    const response = await fetch('/api/jobs/favorites', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.jobs = Array.isArray(result.jobs) ? result.jobs.map(normalizePlatformJobUrl) : [];
    state.favoritesView = true;
    state.searchSubmitted = true;
    refreshJobFilterOptions();
    applyFilters();
  } catch (error) {
    elements.favoritesOnlyFilter.checked = false;
    elements.refreshStatus.textContent = `No se pudieron cargar los favoritos: ${error.message}`;
  } finally {
    elements.favoritesOnlyFilter.disabled = false;
  }
}

function restoreRegularJobs() {
  if (!state.favoritesView) {
    applyFilters();
    return;
  }
  state.jobs = [...state.regularJobs];
  state.favoritesView = false;
  state.searchSubmitted = state.regularSearchSubmitted;
  refreshJobFilterOptions();
  applyFilters();
}

let refreshPoller;
function setRefreshButton(running) {
  const label = elements.infojobsUpdated;
  elements.refreshStatus.classList.toggle('is-searching', running);
  if (running) {
    if (!label.dataset.previousLabel) label.dataset.previousLabel = label.textContent;
    label.textContent = 'Actualizando…';
  } else if (label.dataset.previousLabel) {
    label.textContent = label.dataset.previousLabel;
    delete label.dataset.previousLabel;
  }
}

async function checkRefreshStatus() {
  const response = await fetch('/api/refresh-status', { cache: 'no-store' });
  const status = await response.json();
  setRefreshButton(Boolean(status.running));
  if (status.running) {
    elements.refreshStatus.textContent = status.message || 'Actualizando ofertas…';
    clearTimeout(refreshPoller);
    refreshPoller = setTimeout(checkRefreshStatus, 1200);
    return;
  }
  if (status.finishedAt && !status.error) {
    if (state.awaitingSearchCompletion) {
      state.awaitingSearchCompletion = false;
      state.hasCompletedSearch = true;
    }
    await load();
    elements.refreshStatus.textContent = status.warning || '';
  } else if (status.error) {
    state.awaitingSearchCompletion = false;
    elements.refreshStatus.textContent = status.error;
  }
}

let cityLookupTimer;
let cityLookupController;
function hideCitySuggestions() {
  elements.citySuggestions.hidden = true;
  elements.citySuggestions.replaceChildren();
  elements.citySearchInput.setAttribute('aria-expanded', 'false');
}

function renderCitySuggestions(locations) {
  if (!locations.length) {
    hideCitySuggestions();
    return;
  }
  elements.citySuggestions.innerHTML = locations.map(location => `
    <button type="button" role="option" data-city-value="${escapeHtml(location.city)}" data-city-label="${escapeHtml(location.label)}">
      <span>${escapeHtml(location.label)}</span>
    </button>`).join('');
  elements.citySuggestions.hidden = false;
  elements.citySearchInput.setAttribute('aria-expanded', 'true');
}

async function requestCitySuggestions() {
  const query = elements.citySearchInput.value.trim();
  if (query.length < 2) {
    hideCitySuggestions();
    return;
  }
  cityLookupController?.abort();
  cityLookupController = new AbortController();
  try {
    const response = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
      signal: cityLookupController.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    if (query !== elements.citySearchInput.value.trim()) return;
    renderCitySuggestions(Array.isArray(result.locations) ? result.locations : []);
  } catch (error) {
    if (error.name !== 'AbortError') hideCitySuggestions();
  }
}

async function requestAdditionalCitySuggestions(input) {
  const query = input.value.trim();
  const suggestions = input.closest('.main-search-input-wrap').querySelector('.city-suggestions');
  if (query.length < 2) { suggestions.hidden = true; suggestions.replaceChildren(); return; }
  try {
    const response = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || query !== input.value.trim()) return;
    const locations = Array.isArray(result.locations) ? result.locations : [];
    suggestions.innerHTML = locations.map(location => `
      <button type="button" role="option" data-city-value="${escapeHtml(location.city)}" data-city-label="${escapeHtml(location.label)}"><span>${escapeHtml(location.label)}</span></button>`).join('');
    suggestions.hidden = !locations.length;
    input.setAttribute('aria-expanded', String(locations.length > 0));
  } catch { suggestions.hidden = true; }
}

let debounceTimer;
elements.searchInput.addEventListener('input', () => {
  state.searchSubmitted = false;
  applyFilters();
});
elements.citySearchInput.addEventListener('input', () => {
  delete elements.citySearchInput.dataset.cityValue;
  state.searchSubmitted = false;
  applyFilters();
  clearTimeout(cityLookupTimer);
  cityLookupTimer = setTimeout(requestCitySuggestions, 300);
});
elements.citySearchInput.addEventListener('focus', () => {
  if (elements.citySearchInput.value.trim().length >= 2) requestCitySuggestions();
});
elements.citySearchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideCitySuggestions();
  if (event.key === 'ArrowDown') {
    const firstOption = elements.citySuggestions.querySelector('button');
    if (firstOption) {
      event.preventDefault();
      firstOption.focus();
    }
  }
});
elements.citySuggestions.addEventListener('click', event => {
  const option = event.target.closest('[data-city-label]');
  if (!option) return;
  elements.citySearchInput.value = option.dataset.cityLabel;
  elements.citySearchInput.dataset.cityValue = option.dataset.cityValue;
  state.searchSubmitted = false;
  hideSearchRowOpenControls();
  hideCitySuggestions();
  applyFilters();
});
elements.jobSearchForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.favoritesView) restoreRegularJobs();
  elements.favoritesOnlyFilter.checked = false;
  const selectedPlatforms = [...document.querySelectorAll('input[name="simplePlatform"]:checked')].map(input => input.value);
  const simpleSearches = [...elements.searchRows.querySelectorAll('[data-infojobs-search-row]')]
    .map(row => {
      const keywordInput = row.querySelector('.infojobs-keyword');
      const cityInput = row.querySelector('.infojobs-city');
      return {
        keyword: keywordInput.value.trim(),
        city: (cityInput.dataset.cityValue || cityInput.value.split(',')[0]).trim(),
      };
    }).filter(search => search.keyword || search.city);
  const searches = selectedPlatforms.length ? simpleSearches : [];
  for (const row of elements.advancedUrlRows.querySelectorAll('[data-infojobs-url-row]')) {
    const url = row.querySelector('.infojobs-direct-url').value.trim();
    const description = row.querySelector('.infojobs-url-description').value.trim();
    if (url) searches.push({ url, description });
  }
  if (!searches.length) {
    state.searchSubmitted = false;
    elements.refreshStatus.textContent = simpleSearches.length && !selectedPlatforms.length
      ? 'Selecciona al menos una plataforma para la búsqueda simple o añade una URL avanzada.'
      : 'Indica un puesto o una ciudad para buscar.';
    elements.searchInput.focus();
    applyFilters();
    return;
  }
  state.awaitingSearchCompletion = true;
  state.searchSubmitted = true;
  state.hasCompletedSearch = false;
  state.jobs = [];
  state.regularJobs = [];
  state.filtered = [];
  state.page = 1;
  state.favoritesView = false;
  state.sourceFilters = new Set(selectedPlatforms.map(platform => simplePlatformLabels[platform]).filter(Boolean));
  state.sourceFilterActive = true;
  renderSelectedSources();
  if (elements.jobDialog.open) elements.jobDialog.close();
  showSearchRowOpenControls(selectedPlatforms);
  elements.totalJobs.textContent = '0';
  elements.infojobsCount.textContent = '0';
  elements.empleateCount.textContent = '0';
  elements.tecnoempleoCount.textContent = '0';
  elements.jobtodayCount.textContent = '0';
  elements.infoempleoCount.textContent = '0';
  elements.eurofirmsCount.textContent = '0';
  elements.infofeinaCount.textContent = '0';
  elements.feinaactivaCount.textContent = '0';
  hideCitySuggestions();
  render();
  setRefreshButton(true);
  elements.refreshStatus.textContent = 'Buscando ofertas en las plataformas seleccionadas…';
  try {
    const response = await fetch('/api/search/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searches, platforms: selectedPlatforms }),
    });
    const status = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(status.error || `Error HTTP ${response.status}`);
    elements.refreshStatus.textContent = status.message || 'Buscando ofertas…';
    clearTimeout(refreshPoller);
    refreshPoller = setTimeout(checkRefreshStatus, 800);
  } catch (error) {
    state.awaitingSearchCompletion = false;
    setRefreshButton(false);
    elements.refreshStatus.textContent = `No se pudo completar la búsqueda: ${error.message}`;
  }
  elements.resultsSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.addSearchRow.addEventListener('click', () => {
  hideSearchRowOpenControls();
  const row = document.createElement('div');
  row.className = 'search-row';
  row.dataset.infojobsSearchRow = '';
  row.innerHTML = `
    <label class="main-search-field"><span class="main-search-input-wrap"><input class="infojobs-keyword" type="search" placeholder="Puesto, empresa o palabra clave" aria-label="Puesto" autocomplete="off"></span></label>
    <label class="main-search-field"><span class="main-search-input-wrap"><input class="infojobs-city" type="search" placeholder="Ciudad o localidad" aria-label="Ciudad" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"><div class="city-suggestions" role="listbox" hidden></div></span></label>
    <span class="search-row-open-controls" hidden><select class="search-row-platform" aria-label="Plataforma donde abrir la búsqueda"></select><button class="open-search-row-url" type="button" aria-label="Abrir esta búsqueda en la plataforma seleccionada" title="Abrir URL">↗</button></span>
    <button class="remove-search-row" type="button" aria-label="Eliminar este puesto y ciudad" title="Eliminar">🗑</button>`;
  elements.searchRows.append(row);
  row.querySelector('.infojobs-keyword').focus();
});
elements.searchRows.addEventListener('click', event => {
  const cityOption = event.target.closest('[data-city-label]');
  if (cityOption && cityOption.closest('.city-suggestions') !== elements.citySuggestions) {
    const input = cityOption.closest('.main-search-input-wrap').querySelector('.infojobs-city');
    input.value = cityOption.dataset.cityLabel;
    input.dataset.cityValue = cityOption.dataset.cityValue;
    cityOption.closest('.city-suggestions').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    state.searchSubmitted = false;
    hideSearchRowOpenControls();
    return;
  }
  const removeButton = event.target.closest('.remove-search-row');
  if (removeButton) {
    const row = removeButton.closest('[data-infojobs-search-row]');
    if (row.querySelector('#searchInput')) {
      row.querySelectorAll('input').forEach(input => { input.value = ''; delete input.dataset.cityValue; });
    } else row.remove();
    state.searchSubmitted = false;
    hideSearchRowOpenControls();
    return;
  }
  const openButton = event.target.closest('.open-search-row-url');
  if (openButton) {
    const row = openButton.closest('[data-infojobs-search-row]');
    const platform = row.querySelector('.search-row-platform').value;
    window.open(searchUrlForRow(row, platform), '_blank', 'noopener');
  }
});
elements.searchRows.addEventListener('input', event => {
  const input = event.target.closest('.infojobs-city');
  if (event.target.closest('.infojobs-keyword, .infojobs-city')) hideSearchRowOpenControls();
  if (!input || input === elements.citySearchInput) return;
  delete input.dataset.cityValue;
  clearTimeout(input._cityLookupTimer);
  input._cityLookupTimer = setTimeout(() => requestAdditionalCitySuggestions(input), 300);
});
elements.searchRows.addEventListener('focusin', event => {
  const input = event.target.closest('.infojobs-city');
  if (input && input !== elements.citySearchInput && input.value.trim().length >= 2) requestAdditionalCitySuggestions(input);
});
function hideSearchRowOpenControls() {
  elements.searchRows.querySelectorAll('.search-row-open-controls').forEach(controls => { controls.hidden = true; });
}

function showSearchRowOpenControls(platforms) {
  const options = platforms.map(platform => `<option value="${platform}">${simplePlatformLabels[platform]}</option>`).join('');
  elements.searchRows.querySelectorAll('[data-infojobs-search-row]').forEach(row => {
    const keyword = row.querySelector('.infojobs-keyword').value.trim();
    const cityInput = row.querySelector('.infojobs-city');
    const city = (cityInput.dataset.cityValue || cityInput.value.split(',')[0]).trim();
    const controls = row.querySelector('.search-row-open-controls');
    controls.hidden = !options || !(keyword || city);
    controls.querySelector('.search-row-platform').innerHTML = options;
    row.dataset.openKeyword = keyword;
    row.dataset.openCity = city;
  });
}

function searchSlug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function searchUrlForRow(row, platform) {
  const keyword = row.dataset.openKeyword || '';
  const city = row.dataset.openCity || '';
  if (platform === 'empleate') {
    return `https://www.empleate.gob.es/empleo/#/trabajo?search=${encodeURIComponent([keyword, city].filter(Boolean).join(' ') || '*')}&pag=0`;
  }
  if (platform === 'tecnoempleo') return `https://www.tecnoempleo.com/ofertas-trabajo/${[searchSlug(city), searchSlug(keyword)].filter(Boolean).join('/')}`;
  if (platform === 'jobtoday') {
    const keywordSlug = searchSlug(keyword);
    const citySlug = searchSlug(city);
    if (keywordSlug && citySlug) return `https://jobtoday.com/es/trabajos-${keywordSlug}-en/${citySlug}`;
    if (keywordSlug) return `https://jobtoday.com/es/trabajos-${keywordSlug}`;
    return `https://jobtoday.com/es/trabajos/${citySlug}`;
  }
  if (platform === 'infoempleo') {
    const url = new URL('https://www.infoempleo.com/trabajo/');
    if (keyword) url.searchParams.set('search', keyword);
    if (city) url.searchParams.set('region', city);
    return url.toString();
  }
  if (platform === 'eurofirms') {
    const url = new URL(`/es/es/trabajo${city ? `/${searchSlug(city)}` : ''}`, 'https://jobs.eurofirms.com');
    if (keyword) url.searchParams.set('search', keyword);
    return url.toString();
  }
  if (platform === 'infofeina') {
    const url = new URL('/cercador-ofertes-feina', 'https://www.infofeina.com');
    if (keyword) url.searchParams.set('title', keyword);
    if (city) url.searchParams.set('location', city);
    url.searchParams.set('radius', '30');
    return url.toString();
  }
  if (platform === 'feinaactiva') {
    const url = new URL('/es/search/offers/list', 'https://feinaactiva.gencat.cat');
    const term = [keyword, city].filter(Boolean).join(' ');
    if (term) url.searchParams.set('keywords', term);
    return url.toString();
  }
  const url = new URL('https://www.infojobs.net/jobsearch/search-results/list.xhtml');
  if (keyword) url.searchParams.set('keyword', keyword);
  if (city) url.searchParams.set('cityIds', city);
  url.searchParams.set('page', '1');
  url.searchParams.set('sortBy', 'PUBLICATION_DATE');
  return url.toString();
}
elements.addAdvancedUrlRow.addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'advanced-url-row';
  row.dataset.infojobsUrlRow = '';
  row.innerHTML = `
    <input class="infojobs-url-description" type="text" placeholder="Descripción" aria-label="Descripción de la URL">
    <input class="infojobs-direct-url" type="url" placeholder="URL de búsqueda" aria-label="URL avanzada de búsqueda">
    <button class="open-advanced-url" type="button" aria-label="Abrir esta URL" title="Abrir URL">↗</button>
    <button class="remove-advanced-url" type="button" aria-label="Eliminar esta URL" title="Eliminar">🗑</button>`;
  elements.advancedUrlRows.append(row);
  row.querySelector('input').focus();
});
elements.advancedUrlRows.addEventListener('click', event => {
  const row = event.target.closest('[data-infojobs-url-row]');
  if (!row) return;
  if (event.target.closest('.open-advanced-url')) {
    const url = row.querySelector('.infojobs-direct-url').value.trim();
    if (url) window.open(url, '_blank', 'noopener');
    else row.querySelector('input').focus();
    return;
  }
  if (event.target.closest('.remove-advanced-url')) {
    if (elements.advancedUrlRows.children.length === 1) row.querySelectorAll('input').forEach(input => { input.value = ''; });
    else row.remove();
  }
});
elements.advancedUrlRows.addEventListener('input', () => {
  state.searchSubmitted = false;
  applyFilters();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.main-search-field')) {
    hideCitySuggestions();
    elements.searchRows.querySelectorAll('.city-suggestions').forEach(suggestions => { suggestions.hidden = true; });
  }
});
elements.excludeInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 180);
});
elements.contentSearchFilter.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 180);
});
elements.sourceFilter.addEventListener('change', () => {
  if (elements.sourceFilter.value) {
    state.sourceFilters.add(elements.sourceFilter.value);
    state.sourceFilterActive = true;
  }
  normalizeAllSourcesSelection();
  syncSourceFiltersToPlatformChecks();
  renderSelectedSources();
  applyFilters();
});
elements.selectedSources.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-source]');
  if (!button) return;
  state.sourceFilters.delete(button.dataset.removeSource);
  state.sourceFilterActive = true;
  syncSourceFiltersToPlatformChecks();
  renderSelectedSources();
  applyFilters();
});
document.querySelectorAll('input[name="simplePlatform"]').forEach(input => {
  updatePlatformCardState(input);
  input.addEventListener('change', () => {
    updatePlatformCardState(input);
    savePlatformSelectionState();
    syncPlatformChecksToSourceFilters();
  });
  const card = input.closest('.stat-platform');
  const toggleCard = () => {
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  card.addEventListener('click', event => {
    if (event.target.closest('.platform-selector')) return;
    toggleCard();
  });
  card.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || event.target !== card) return;
    event.preventDefault();
    toggleCard();
  });
});
[elements.typeFilter, elements.sortOrder, elements.showSeenFilter]
  .forEach(element => element.addEventListener('change', applyFilters));
elements.favoritesOnlyFilter.addEventListener('change', () => {
  if (elements.favoritesOnlyFilter.checked) loadFavoriteJobs();
  else restoreRegularJobs();
});
elements.checkFavoriteLinks.addEventListener('click', async () => {
  elements.checkFavoriteLinks.disabled = true;
  elements.favoriteManagementStatus.textContent = 'Comprobando enlaces guardados…';
  try {
    const response = await fetch('/api/jobs/favorites/check', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    elements.favoriteManagementStatus.textContent = `${result.ok} disponibles · ${result.broken} rotos · ${result.unknown} sin confirmar.`;
    await loadFavoriteJobs();
  } catch (error) {
    elements.favoriteManagementStatus.textContent = `No se pudieron comprobar los enlaces: ${error.message}`;
  } finally {
    elements.checkFavoriteLinks.disabled = false;
  }
});
async function cleanFavorites(mode) {
  const label = mode === 'broken' ? 'los favoritos con enlaces rotos confirmados' : 'los favoritos guardados hace más de seis meses';
  if (!confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
  const button = mode === 'broken' ? elements.cleanBrokenFavorites : elements.cleanOldFavorites;
  button.disabled = true;
  try {
    const response = await fetch('/api/jobs/favorites/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    elements.favoriteManagementStatus.textContent = `${result.removed} favorito${result.removed === 1 ? '' : 's'} eliminado${result.removed === 1 ? '' : 's'}.`;
    await loadFavoriteJobs();
  } catch (error) {
    elements.favoriteManagementStatus.textContent = `No se pudieron limpiar los favoritos: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}
elements.cleanBrokenFavorites.addEventListener('click', () => cleanFavorites('broken'));
elements.cleanOldFavorites.addEventListener('click', () => cleanFavorites('old'));
[elements.minPriceFilter, elements.maxPriceFilter].forEach(element => {
  element.addEventListener('input', () => {
    updatePriceRange(element);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 180);
  });
});
elements.dateFilter.addEventListener('input', () => {
  updateDateRange();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 120);
});
elements.profileSelect.addEventListener('change', () => {
  const profile = readSearchProfiles().find(item => item.name === elements.profileSelect.value);
  elements.deleteProfile.disabled = !profile;
  if (!profile) {
    elements.profileStatus.textContent = '';
    return;
  }
  renderSearchProfiles(profile.name);
  applySearchProfile(profile);
  elements.profileName.value = profile.name;
  elements.profileStatus.textContent = `Perfil «${profile.name}» aplicado.`;
});
elements.profileShortcutList.addEventListener('click', event => {
  const button = event.target.closest('[data-profile-name]');
  if (!button) return;
  elements.profileSelect.value = button.dataset.profileName;
  elements.profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
  requestAnimationFrame(() => elements.jobSearchForm.requestSubmit());
});
elements.saveProfile.addEventListener('click', async () => {
  const name = elements.profileName.value.trim();
  if (!name) {
    elements.profileStatus.textContent = 'Escribe un nombre para guardar el perfil.';
    elements.profileName.focus();
    return;
  }
  elements.saveProfile.disabled = true;
  try {
    const profiles = readSearchProfiles();
    const existingIndex = profiles.findIndex(profile => normalizeText(profile.name) === normalizeText(name));
    const profile = currentSearchProfile(existingIndex >= 0 ? profiles[existingIndex].name : name);
    const response = await fetch('/api/search-profiles/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles(result.profile.name);
    elements.profileName.value = result.profile.name;
    elements.profileStatus.textContent = result.created
      ? `Perfil «${result.profile.name}» guardado.`
      : `Perfil «${result.profile.name}» actualizado.`;
  } catch (error) {
    elements.profileStatus.textContent = `No se pudo guardar el perfil: ${error.message}`;
  } finally {
    elements.saveProfile.disabled = false;
  }
});
elements.deleteProfile.addEventListener('click', async () => {
  const selectedName = elements.profileSelect.value;
  if (!selectedName) return;
  elements.deleteProfile.disabled = true;
  try {
    const response = await fetch('/api/search-profiles/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
    state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : [];
    renderSearchProfiles();
    if (elements.profileName.value === selectedName) elements.profileName.value = '';
    elements.profileStatus.textContent = `Perfil «${selectedName}» eliminado.`;
  } catch (error) {
    elements.profileStatus.textContent = `No se pudo eliminar el perfil: ${error.message}`;
    elements.deleteProfile.disabled = false;
  }
});
elements.profileName.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    elements.saveProfile.click();
  }
});

elements.exportProfiles.addEventListener('click', () => {
  const profiles = readSearchProfiles();
  if (!profiles.length) {
    elements.profileStatus.textContent = 'No hay perfiles para exportar.';
    return;
  }

  const documentData = {
    format: 'web-trabajos-search-profiles',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles
  };
  const blob = new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `perfiles-trabajos-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
  elements.profileStatus.textContent = `${profiles.length} perfil${profiles.length === 1 ? '' : 'es'} exportado${profiles.length === 1 ? '' : 's'}.`;
});

elements.importProfiles.addEventListener('click', () => elements.profilesFileInput.click());

elements.profilesFileInput.addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  elements.importProfiles.disabled = true;
  elements.exportProfiles.disabled = true;
  elements.profileStatus.textContent = 'Importando perfiles…';
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('El archivo supera el límite de 2 MB');
    const importedDocument = JSON.parse(await file.text());
    const profiles = Array.isArray(importedDocument) ? importedDocument : importedDocument?.profiles;
    if (!Array.isArray(profiles) || !profiles.length) throw new Error('El archivo no contiene perfiles');
    if (profiles.length > 100) throw new Error('El archivo contiene demasiados perfiles');
    profiles.forEach((profile, index) => {
      if (!profile || typeof profile !== 'object' || !String(profile.name || '').trim()) {
        throw new Error(`El perfil ${index + 1} no tiene un nombre válido`);
      }
    });

    let importedCount = 0;
    for (const profile of profiles) {
      const response = await fetch('/api/search-profiles/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
      state.searchProfiles = Array.isArray(result.profiles) ? result.profiles : state.searchProfiles;
      importedCount++;
    }

    renderSearchProfiles();
    elements.profileStatus.textContent = `${importedCount} perfil${importedCount === 1 ? '' : 'es'} importado${importedCount === 1 ? '' : 's'} correctamente.`;
  } catch (error) {
    elements.profileStatus.textContent = `No se pudieron importar los perfiles: ${error.message}.`;
  } finally {
    elements.importProfiles.disabled = false;
    elements.exportProfiles.disabled = false;
  }
});

elements.clearFilters.addEventListener('click', () => {
  elements.contentSearchFilter.value = '';
  elements.excludeInput.value = '';
  state.sourceFilters.clear();
  state.sourceFilterActive = false;
  syncSourceFiltersToPlatformChecks();
  renderSelectedSources();
  elements.minPriceFilter.value = '0';
  elements.maxPriceFilter.value = String(priceSliderSteps);
  elements.typeFilter.value = '';
  elements.dateFilter.value = String(dateAnyValue);
  elements.sortOrder.value = 'newest';
  elements.showSeenFilter.checked = false;
  elements.favoritesOnlyFilter.checked = false;
  if (state.favoritesView) {
    state.jobs = [...state.regularJobs];
    state.favoritesView = false;
    state.searchSubmitted = state.regularSearchSubmitted;
  }
  updatePriceRange();
  updateDateRange();
  applyFilters();
});

const collapsiblePanelsStorageKey = 'web-trabajos.collapsible-panels.v1';

function saveCollapsiblePanelsState() {
  try {
    const profilesToggle = document.querySelector('[aria-controls="profilesPanelContent"].panel-collapse-toggle');
    const searchToggle = document.querySelector('[aria-controls="searchPanelContent"].panel-collapse-toggle');
    localStorage.setItem(collapsiblePanelsStorageKey, JSON.stringify({
      profiles: profilesToggle.getAttribute('aria-expanded') === 'true',
      search: searchToggle.getAttribute('aria-expanded') === 'true',
      filters: elements.filterToggle.getAttribute('aria-expanded') === 'true'
    }));
  } catch (_) {
    // La interfaz sigue funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

function setPanelExpanded(button, expanded) {
  const content = document.getElementById(button.getAttribute('aria-controls'));
  button.setAttribute('aria-expanded', String(expanded));
  button.classList.toggle('is-collapsed', !expanded);
  button.closest('.profiles-panel, .main-search-panel')?.classList.toggle('is-panel-collapsed', !expanded);
  content.hidden = !expanded;

  if (button.getAttribute('aria-controls') === 'searchPanelContent') {
    const iconToggle = document.getElementById('searchPanelToggleIcon');
    iconToggle.setAttribute('aria-expanded', String(expanded));
    iconToggle.setAttribute('aria-label', expanded ? 'Plegar búsqueda de empleo' : 'Abrir búsqueda de empleo');
    iconToggle.classList.toggle('is-collapsed', !expanded);
  }
}

function setFiltersExpanded(expanded) {
  elements.filterToggle.setAttribute('aria-expanded', String(expanded));
  elements.filterToggle.classList.toggle('is-collapsed', !expanded);
  const iconToggle = document.getElementById('filterToggleIcon');
  iconToggle.setAttribute('aria-expanded', String(expanded));
  iconToggle.setAttribute('aria-label', expanded ? 'Cerrar filtros avanzados' : 'Abrir filtros avanzados');
  iconToggle.classList.toggle('is-collapsed', !expanded);
  elements.filtersContent.hidden = !expanded;
}

function restoreCollapsiblePanelsState() {
  try {
    const saved = JSON.parse(localStorage.getItem(collapsiblePanelsStorageKey));
    if (!saved || typeof saved !== 'object') return;
    const profilesToggle = document.querySelector('[aria-controls="profilesPanelContent"].panel-collapse-toggle');
    const searchToggle = document.querySelector('[aria-controls="searchPanelContent"].panel-collapse-toggle');
    if (typeof saved.profiles === 'boolean') setPanelExpanded(profilesToggle, saved.profiles);
    if (typeof saved.search === 'boolean') setPanelExpanded(searchToggle, saved.search);
    if (typeof saved.filters === 'boolean') setFiltersExpanded(saved.filters);
  } catch (_) {
    // Se mantienen los estados predeterminados si no hay una preferencia válida.
  }
}

restoreCollapsiblePanelsState();
restorePlatformSelectionState();

elements.filterToggle.addEventListener('click', () => {
  const expanded = elements.filterToggle.getAttribute('aria-expanded') === 'true';
  setFiltersExpanded(!expanded);
  saveCollapsiblePanelsState();
});
document.getElementById('filterToggleIcon').addEventListener('click', () => elements.filterToggle.click());
elements.advancedFiltersIndicator.addEventListener('click', () => {
  if (elements.filterToggle.getAttribute('aria-expanded') !== 'true') elements.filterToggle.click();
  elements.filtersContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.querySelectorAll('.panel-collapse-toggle').forEach(button => {
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    setPanelExpanded(button, !expanded);
    saveCollapsiblePanelsState();
  });
});
document.getElementById('searchPanelToggleIcon').addEventListener('click', () => {
  document.querySelector('[aria-controls="searchPanelContent"].panel-collapse-toggle').click();
});
document.querySelector('.search-panel-header').addEventListener('click', event => {
  if (event.target.closest('button, input, label, select, a')) return;
  document.querySelector('[aria-controls="searchPanelContent"].panel-collapse-toggle').click();
});
document.querySelector('.toolbar-header').addEventListener('click', event => {
  if (event.target.closest('button, input, label, select, a')) return;
  elements.filterToggle.click();
});
elements.previousPage.addEventListener('click', () => { state.page--; render(); window.scrollTo({ top: 320, behavior: 'smooth' }); });
elements.nextPage.addEventListener('click', () => { state.page++; render(); window.scrollTo({ top: 320, behavior: 'smooth' }); });
elements.pageInfo.addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  state.page = Number(button.dataset.page);
  render();
  window.scrollTo({ top: 320, behavior: 'smooth' });
});
elements.jobGrid.addEventListener('click', event => {
  const favoriteButton = event.target.closest('[data-favorite-index]');
  if (favoriteButton) {
    const job = state.filtered[Number(favoriteButton.dataset.favoriteIndex)];
    setJobFavorite(job, !job.favorite, favoriteButton);
    return;
  }
  const button = event.target.closest('[data-job-index]');
  if (button) showDetails(state.filtered[Number(button.dataset.jobIndex)]);
});
elements.jobGrid.addEventListener('change', async event => {
  const input = event.target.closest('[data-seen-index]');
  if (!input) return;
  const job = state.filtered[Number(input.dataset.seenIndex)];
  setJobSeen(job, input.checked, input);
});
elements.dialogSeenToggle.addEventListener('change', event => {
  if (state.detailJob) setJobSeen(state.detailJob, event.target.checked, event.target);
});
elements.dialogFavoriteToggle.addEventListener('click', event => {
  if (state.detailJob) setJobFavorite(state.detailJob, !state.detailJob.favorite, event.currentTarget);
});
function navigateJobDetail(offset) {
  if (!state.detailJob) return;
  const currentIndex = state.filtered.indexOf(state.detailJob);
  const targetIndex = currentIndex >= 0
    ? currentIndex + offset
    : state.detailRemovedIndex == null
      ? -1
      : state.detailRemovedIndex + (offset < 0 ? -1 : 0);
  const nextJob = state.filtered[targetIndex];
  if (nextJob) showDetails(nextJob);
}
elements.dialogPreviousJob.addEventListener('click', () => navigateJobDetail(-1));
elements.dialogNextJob.addEventListener('click', () => navigateJobDetail(1));
elements.closeDialog.addEventListener('click', () => elements.jobDialog.close());
elements.jobDialog.addEventListener('click', event => {
  if (event.target === elements.jobDialog) elements.jobDialog.close();
});
elements.jobDialog.addEventListener('close', () => {
  state.detailJob = null;
  state.detailRemovedIndex = null;
});
elements.openInterestLinks.addEventListener('click', () => {
  resetInterestLinkForm();
  elements.interestLinksStatus.textContent = '';
  renderInterestLinks();
  elements.interestLinksDialog.showModal();
  requestAnimationFrame(() => elements.interestLinkDescription.focus());
});
elements.exportInterestLinks.addEventListener('click', () => {
  if (!state.interestLinkSections.length) {
    elements.interestLinksStatus.textContent = 'No hay enlaces para exportar.';
    return;
  }
  const documentValue = {
    format: 'web-trabajos-interest-links',
    version: 1,
    sections: state.interestLinkSections,
  };
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(documentValue, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `enlaces-interes-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
  elements.interestLinksStatus.textContent = 'Enlaces exportados correctamente.';
});
elements.importInterestLinks.addEventListener('click', () => elements.interestLinksFileInput.click());
elements.interestLinksFileInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 1024 * 1024) {
    elements.interestLinksStatus.textContent = 'El archivo es demasiado grande.';
    return;
  }
  try {
    const importedSections = normalizeInterestLinksDocument(JSON.parse(await file.text()));
    if (!importedSections.length) throw new Error('El archivo no contiene enlaces');
    importedSections.forEach(importedSection => {
      let section = state.interestLinkSections.find(item => normalizeText(item.name) === normalizeText(importedSection.name));
      if (!section) {
        section = { name: importedSection.name, links: [] };
        state.interestLinkSections.push(section);
      }
      importedSection.links.forEach(link => {
        if (!section.links.some(item => item.url === link.url && normalizeText(item.description) === normalizeText(link.description))) section.links.push(link);
      });
    });
    saveInterestLinks();
    renderInterestLinks();
    resetInterestLinkForm();
    elements.interestLinksStatus.textContent = 'Enlaces importados correctamente.';
  } catch (error) {
    elements.interestLinksStatus.textContent = `No se pudieron importar los enlaces: ${error.message}.`;
  }
});
elements.closeInterestLinks.addEventListener('click', () => elements.interestLinksDialog.close());
elements.interestLinksDialog.addEventListener('click', event => {
  if (event.target === elements.interestLinksDialog) elements.interestLinksDialog.close();
});
elements.cancelInterestLinkEdit.addEventListener('click', () => {
  resetInterestLinkForm();
  elements.interestLinksStatus.textContent = 'Edición cancelada.';
  elements.interestLinkDescription.focus();
});
elements.interestSectionForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = elements.interestSectionName.value.trim().slice(0, 60);
  if (!name) return;
  if (state.interestLinkSections.some(section => normalizeText(section.name) === normalizeText(name))) {
    elements.interestLinksStatus.textContent = `Ya existe el apartado «${name}».`;
    return;
  }
  state.interestLinkSections.push({ name, links: [] });
  saveInterestLinks();
  renderInterestLinks();
  elements.interestLinkSection.value = String(state.interestLinkSections.length - 1);
  elements.interestSectionForm.reset();
  elements.interestLinksStatus.textContent = `Apartado «${name}» creado.`;
  elements.interestLinkDescription.focus();
});
elements.interestLinkForm.addEventListener('submit', event => {
  event.preventDefault();
  const description = elements.interestLinkDescription.value.trim();
  const url = validInterestLinkUrl(elements.interestLinkUrl.value.trim());
  if (!description || !url) {
    elements.interestLinksStatus.textContent = 'Introduce una descripción y una URL válida que empiece por http:// o https://.';
    return;
  }
  const sectionIndex = Number(elements.interestLinkSection.value);
  const section = state.interestLinkSections[sectionIndex];
  if (!section) {
    elements.interestLinksStatus.textContent = 'Crea o selecciona un apartado.';
    return;
  }
  const editIndex = elements.interestLinkEditIndex.value === '' ? -1 : Number(elements.interestLinkEditIndex.value);
  const editSectionIndex = elements.interestLinkEditSection.value === '' ? -1 : Number(elements.interestLinkEditSection.value);
  const link = { description: description.slice(0, 80), url };
  if (editIndex >= 0 && state.interestLinkSections[editSectionIndex]?.links[editIndex]) {
    state.interestLinkSections[editSectionIndex].links.splice(editIndex, 1);
    section.links.push(link);
    elements.interestLinksStatus.textContent = `Enlace «${description}» actualizado.`;
  } else {
    section.links.push(link);
    elements.interestLinksStatus.textContent = `Enlace «${description}» guardado.`;
  }
  saveInterestLinks();
  renderInterestLinks();
  resetInterestLinkForm();
});
elements.interestLinksList.addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-interest-link]');
  if (editButton) {
    const index = Number(editButton.dataset.editInterestLink);
    const sectionIndex = Number(editButton.dataset.interestSection);
    const link = state.interestLinkSections[sectionIndex]?.links[index];
    if (!link) return;
    elements.interestLinkEditIndex.value = String(index);
    elements.interestLinkEditSection.value = String(sectionIndex);
    elements.interestLinkSection.value = String(sectionIndex);
    elements.interestLinkDescription.value = link.description;
    elements.interestLinkUrl.value = link.url;
    elements.cancelInterestLinkEdit.hidden = false;
    elements.interestLinksStatus.textContent = `Modificando «${link.description}».`;
    elements.interestLinkDescription.focus();
    return;
  }
  const deleteButton = event.target.closest('[data-delete-interest-link]');
  if (deleteButton) {
    const sectionIndex = Number(deleteButton.dataset.interestSection);
    const index = Number(deleteButton.dataset.deleteInterestLink);
    const [removed] = state.interestLinkSections[sectionIndex]?.links.splice(index, 1) || [];
    if (!removed) return;
    saveInterestLinks();
    renderInterestLinks();
    resetInterestLinkForm();
    elements.interestLinksStatus.textContent = `Enlace «${removed.description}» eliminado.`;
    return;
  }
  const renameButton = event.target.closest('[data-rename-interest-section]');
  if (renameButton) {
    const section = state.interestLinkSections[Number(renameButton.dataset.renameInterestSection)];
    if (!section) return;
    const name = prompt('Nuevo nombre del apartado:', section.name)?.trim().slice(0, 60);
    if (!name || state.interestLinkSections.some(item => item !== section && normalizeText(item.name) === normalizeText(name))) return;
    section.name = name;
    saveInterestLinks();
    renderInterestLinks();
    elements.interestLinksStatus.textContent = `Apartado renombrado como «${name}».`;
    return;
  }
  const sectionButton = event.target.closest('[data-delete-interest-section]');
  if (!sectionButton) return;
  const sectionIndex = Number(sectionButton.dataset.deleteInterestSection);
  const section = state.interestLinkSections[sectionIndex];
  if (!section || !confirm(`¿Eliminar el apartado «${section.name}» y sus ${section.links.length} enlace(s)?`)) return;
  state.interestLinkSections.splice(sectionIndex, 1);
  saveInterestLinks();
  renderInterestLinks();
  resetInterestLinkForm();
  elements.interestLinksStatus.textContent = `Apartado «${section.name}» eliminado.`;
});
loadInterestLinks();
loadSearchProfiles();
load();
checkRefreshStatus().catch(() => {});
