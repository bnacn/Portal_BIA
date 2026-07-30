/**
 * data-loader.js
 * ===============
 * Módulo genérico de carga de datos para el Portal BIA.
 *
 * Responsabilidad única: traer los archivos JSON (nodos/aristas) declarados
 * en la config de un grafo y devolver un objeto { nodes, edges } ya validado
 * y normalizado, listo para que graph-engine.js lo convierta en elementos
 * de Cytoscape.
 *
 * No conoce nada específico de "Salidas" ni "Aplicativos": solo entiende el
 * contrato genérico definido en README.md:
 *   Nodo:  { id, type, label, data }
 *   Arista: { id, type, source, target, directed, data }
 *
 * IMPORTANTE: por el uso de fetch(), este portal debe servirse por http(s)
 * (GitHub Pages lo hace automáticamente). Si lo abrís como archivo local
 * (file://) el navegador bloquea fetch() por CORS; para probar en local
 * corré, por ejemplo: `python3 -m http.server 8000` desde la raíz del proyecto.
 */

const DataLoader = (() => {
  /**
   * Descarga un único archivo JSON.
   * @param {string} path - ruta relativa al archivo (ej. "data/nodes-salidas.json")
   * @returns {Promise<any>}
   */
  async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`No se pudo cargar "${path}" (HTTP ${res.status}). ` +
        `Verificá que el archivo exista en /data y que estés sirviendo el ` +
        `portal por http(s), no abriendo el .html directamente.`);
    }
    return res.json();
  }

  /**
   * Valida que un array de nodos cumpla el contrato mínimo.
   * Lanza un error descriptivo (no silencioso) si algo no cierra: preferimos
   * fallar fuerte y avisar, antes que renderizar un grafo con datos rotos.
   */
  function validateNodes(nodes, sourceName) {
    const ids = new Set();
    nodes.forEach((n, i) => {
      if (!n.id) throw new Error(`${sourceName}: nodo en posición ${i} sin "id".`);
      if (!n.type) throw new Error(`${sourceName}: nodo "${n.id}" sin "type".`);
      if (n.label === undefined || n.label === null) {
        throw new Error(`${sourceName}: nodo "${n.id}" sin "label".`);
      }
      if (ids.has(n.id)) {
        throw new Error(`${sourceName}: id de nodo duplicado "${n.id}".`);
      }
      ids.add(n.id);
    });
  }

  /**
   * Valida aristas y avisa (sin frenar la carga) si source/target no existen
   * dentro del conjunto de nodos ya cargado, para detectar referencias rotas
   * cuanto antes en vez de que Cytoscape falle silenciosamente.
   */
  function validateEdges(edges, nodeIdSet, sourceName) {
    const ids = new Set();
    edges.forEach((e, i) => {
      if (!e.id) throw new Error(`${sourceName}: arista en posición ${i} sin "id".`);
      if (!e.source || !e.target) {
        throw new Error(`${sourceName}: arista "${e.id}" sin "source"/"target".`);
      }
      if (ids.has(e.id)) {
        throw new Error(`${sourceName}: id de arista duplicado "${e.id}".`);
      }
      ids.add(e.id);
      if (!nodeIdSet.has(e.source)) {
        console.warn(`${sourceName}: arista "${e.id}" referencia un nodo source ` +
          `inexistente "${e.source}" (se omite la arista).`);
      }
      if (!nodeIdSet.has(e.target)) {
        console.warn(`${sourceName}: arista "${e.id}" referencia un nodo target ` +
          `inexistente "${e.target}" (se omite la arista).`);
      }
    });
  }

  /**
   * Carga el conjunto completo de datos de un grafo a partir de su config.
   * @param {object} graphConfig - ver js/configs/*.config.js
   * @returns {Promise<{nodes: object[], edges: object[]}>}
   */
  async function loadGraphData(graphConfig) {
    const { nodeSources, edgeSources } = graphConfig.dataSources;

    // Carga en paralelo de todos los archivos de nodos y de aristas declarados.
    const nodeArrays = await Promise.all(nodeSources.map((path) => fetchJson(path)));
    const edgeArrays = await Promise.all(edgeSources.map((path) => fetchJson(path)));

    let nodes = [];
    nodeArrays.forEach((arr, i) => {
      validateNodes(arr, nodeSources[i]);
      nodes = nodes.concat(arr);
    });

    const nodeIdSet = new Set(nodes.map((n) => n.id));

    let edges = [];
    edgeArrays.forEach((arr, i) => {
      validateEdges(arr, nodeIdSet, edgeSources[i]);
      // solo se conservan aristas cuyos dos extremos existen en el set de nodos
      const valid = arr.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
      edges = edges.concat(valid);
    });

    return { nodes, edges };
  }

  /**
   * Carga una tabla de dimensión "suelta" (no nodo/arista), por ejemplo
   * dim-rango-rto.json o dim-subproducto.json, usada por los filtros y
   * por el panel lateral.
   */
  async function loadDimension(path) {
    return fetchJson(path);
  }

  return { loadGraphData, loadDimension, fetchJson };
})();
