'use strict';

// Adaptador EXCLUSIVO de pruebas para el recolector histórico de gráficos que
// permanece independiente. No es código productivo ni una opción de Buscar.
// Todas las lecturas, filtros, caché y páginas las ejecutan los helpers REALES
// extraídos de index.html. El nuevo Buscar se prueba aparte de extremo a extremo.
module.exports = `
  globalThis.searchAnalysisPage = async function(options = {}) {
    const criteria = currentActivityFilterCriteria();
    const run = ++_activitySearchRun;
    if (options === true || options.force === true) invalidateActivityQueryCache();
    const context = activityEnsureQueryContext();
    const generation = _activityQueryGeneration;
    const active = () => {
      if (run !== _activitySearchRun || generation !== _activityQueryGeneration ||
          context !== activityQueryContextKey() ||
          activityFilterSignature(criteria) !== activityFilterSignature(currentActivityFilterCriteria())) {
        throw new Error('La sesión o los filtros cambiaron durante el análisis.');
      }
    };
    try {
      const entry = await activityGetLightEntry(criteria, active);
      const source = entry.source;
      const session = {
        start: criteria.start, end: criteria.end,
        cursorKey: firebasePushIdBoundary(criteria.end, 'z'),
        sourcePath: source.path, sourceLabel: source.label, indexed: source.indexed,
        seen: new Set(), pendingMatches: [], hasMore: false,
        lightEntry: entry, reuseFirstPage: Boolean(entry.firstPageLoaded), ensureActive: active,
      };
      const result = await loadActivityTextPage(session, activityAnalysisPreview, criteria);
      active();
      _activityPageSession = session;
      _activitiesData = result.page.filter(record => isInManagerActivityScope(record) && activityMatchesCriteria(record, criteria));
      _activitiesVisibleCount = ACTIVITY_RESULTS_PAGE_SIZE;
      window.__activitySearchSources = {
        direct: result.page.length, historical: 0, paginated: true, indexed: source.indexed,
        label: source.label, scannedBatches: result.scannedBatches,
        partial: session.partial, scanned: session.scanned, statusText: session.statusText,
      };
      window.renderActivities();
      return true;
    } catch (error) {
      if (run !== _activitySearchRun || context !== activityQueryContextKey() ||
          activityFilterSignature(criteria) !== activityFilterSignature(currentActivityFilterCriteria())) return false;
      document.getElementById('activitiesTableContainer').innerHTML = 'Error de análisis histórico: ' + activityText(error.message);
      return false;
    }
  };
`;
