/**
 * search.js
 * ==========
 * Buscador de nodos genérico, reutilizado por cualquier grafo.
 * Filtra por coincidencia parcial (case-insensitive, sin acentos) sobre
 * el label del nodo, y delega en GraphEngine el resaltado visual.
 */

const NodeSearch = (() => {
  function foldText(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // quita acentos
  }

  /**
   * @param {object[]} nodes - cy.nodes() o array plano de nodos
   * @param {string} term
   * @returns {string[]} ids de nodos que matchean
   */
  function findMatches(nodes, term) {
    const t = foldText(term.trim());
    if (!t) return [];
    return nodes
      .filter((n) => {
        const label = typeof n.data === 'function' ? n.data('label') : n.label;
        return foldText(label || '').includes(t);
      })
      .map((n) => (typeof n.id === 'function' ? n.id() : n.id));
  }

  /**
   * Conecta un <input> de búsqueda con un GraphEngine: a medida que se
   * escribe, resalta los nodos que matchean y atenúa el resto.
   */
  function wireSearchInput(inputEl, engine, getNodes) {
    inputEl.addEventListener('input', () => {
      const term = inputEl.value;
      if (!term) {
        engine.clearHighlight();
        return;
      }
      const ids = findMatches(getNodes(), term);
      engine.highlightNodesByIds(ids);
    });
  }

  return { findMatches, wireSearchInput, foldText };
})();
