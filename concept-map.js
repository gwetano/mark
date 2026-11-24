/**
 * Concept Map (Mappa dei Concetti) for Mark
 * 2D Force-directed interactive concept graph local to a Mark folder/project (.mark/)
 */

const fs = require('fs');
const path = require('path');

// ====== GRAPH VISUAL SETTINGS (Modifica qui per personalizzare nodi e linee) ======
const GRAPH_CONFIG = {
  // Nodi
  nodeMinRadius: 4.0,         // Raggio base minimo dei nodi (più piccoli e compatti)
  nodeMaxRadius: 11.0,        // Raggio massimo per nodi con molte connessioni
  nodeDegreeFactor: 1.4,      // Incremento raggio per connessione (r = min + sqrt(deg) * factor)
  drawNodeBorder: false,      // false = nessun bordo nero/scuro sui nodi
  
  // Collegamenti / Linee
  linkWidthNormal: 1.8,       // Spessore linee collegamenti normali (leggermente più doppi)
  linkWidthHover: 2.8,        // Spessore linee su hover
  linkDashed: false,          // false = collegamenti sempre diretti e continui (non tratteggiati)
  linkOpacityDark: 0.28,      // Opacità linee su tema scuro (0.0 - 1.0)
  linkOpacityLight: 0.22,     // Opacità linee su tema chiaro (0.0 - 1.0)
  
  // Animazione Idle Dinamica (moto orbitale fluido dei cluster)
  dynamicIdleSpeed: 0.95,     // Frequenza oscillazione idle
  dynamicIdleForce: 1.30,     // Forza spinta di galleggiamento orbitale idle
  dynamicOrbitalSwirl: 0.90   // Forza di rotazione orbitale costante
};

// ====== DEFAULT PHYSICS SETTINGS ======
const DEFAULT_PHYSICS = {
  repulsion: 220,
  linkDistance: 130,
  gravity: 0.008,
  friction: 0.85,
  showAllLabels: true,
  dynamicIdle: false,
  hideOrphans: false,
  linkByTags: true,
  linkByHeadings: false
};

// ====== STOP WORDS (Italian & English) ======
const STOP_WORDS = new Set([
  // Articoli italiani
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una',
  // Preposizioni italiane
  'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell',
  'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all',
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'dall',
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell',
  'col', 'coi', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'sull',
  // Pronomi e aggettivi italiani
  'io', 'tu', 'lui', 'lei', 'noi', 'voi', 'loro', 'egli', 'ella', 'esso', 'essa', 'essi', 'esse',
  'mi', 'ti', 'si', 'ci', 'vi', 'me', 'te', 'se', 'ce', 've',
  'mio', 'mia', 'miei', 'mie', 'tuo', 'tua', 'tuoi', 'tue',
  'suo', 'sua', 'suoi', 'sue', 'nostro', 'nostra', 'nostri', 'nostre',
  'vostro', 'vostra', 'vostri', 'vostre',
  'questo', 'questa', 'questi', 'queste', 'quest',
  'quello', 'quella', 'quelli', 'quelle', 'quell', 'quel',
  'che', 'chi', 'cui', 'quale', 'quali', 'quanto', 'quanta', 'quanti', 'quante',
  // Congiunzioni, particelle e avverbi italiani
  'e', 'ed', 'o', 'od', 'ma', 'se', 'però', 'come', 'quando', 'dove',
  'perché', 'poiché', 'anche', 'pure', 'non', 'nè', 'neanche', 'nemmeno',
  'più', 'meno', 'molto', 'poco', 'tanto', 'troppo', 'tutto', 'tutti', 'tutta', 'tutte',
  'già', 'ancora', 'ora', 'poi', 'solo', 'sempre', 'mai', 'così',
  // Verbi ausiliari e comuni italiani
  'essere', 'avere', 'fare', 'stato', 'stata', 'stati', 'state',
  'sono', 'sei', 'siamo', 'siete', 'era', 'erano', 'ero', 'eri', 'eravamo', 'eravate',
  'ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno', 'aveva', 'avevano',
  'fa', 'fanno', 'fatto', 'fatta', 'fatti', 'fatte',

  // English articles
  'the', 'a', 'an',
  // English prepositions
  'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'under', 'through', 'between',
  // English pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what',
  // English conjunctions & adverbs
  'and', 'or', 'but', 'if', 'because', 'as', 'until', 'while', 'where', 'when', 'how',
  'not', 'no', 'nor', 'too', 'very', 'just', 'so', 'then', 'there', 'here',
  'also', 'only', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
  // English common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',

  // Termini generici di documentazione, codice e template (per evitare cluster artificiali di README, licenze, indici, ecc.)
  'readme', 'license', 'licence', 'licenza', 'copying', 'index', 'summary',
  'sommario', 'indice', 'table', 'contents', 'overview', 'panoramica',
  'introduction', 'introduzione', 'intro', 'notes', 'appunti', 'note',
  'document', 'documento', 'progetto', 'project', 'capitolo', 'chapter',
  'lezione', 'lesson', 'lezioni', 'lessons', 'esercizio', 'esercizi',
  'exercise', 'exercises', 'lab', 'laboratorio', 'homework', 'compiti',
  'todo', 'changelog', 'version', 'versione', 'author', 'autore', 'autori',
  'date', 'data', 'title', 'titolo', 'code', 'codice', 'file', 'files',
  'description', 'descrizione', 'esempio', 'esempi', 'example', 'examples',
  'test', 'testing', 'setup', 'install', 'installation', 'build', 'guide',
  'icon_license', 'standard', 'definition', 'definizione'
]);

// ====== FOLDER PALETTE (Brutalist, vibrant and harmonious) ======
const FOLDER_PALETTE = [
  '#3b82f6', // Blue (Root)
  '#10b981', // Emerald
  '#8b5cf6', // Violet
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#a855f7', // Purple
  '#e11d48', // Rose
  '#84cc16', // Lime
  '#6366f1'  // Indigo
];

function getFolderColor(folderRel, folderList) {
  if (!folderRel || folderRel === '.' || folderRel === '') {
    return FOLDER_PALETTE[0];
  }
  let index = folderList.indexOf(folderRel);
  if (index === -1) {
    folderList.push(folderRel);
    index = folderList.length - 1;
  }
  return FOLDER_PALETTE[(index + 1) % FOLDER_PALETTE.length];
}

// ====== KEYWORD & TAG EXTRACTION ======
function cleanMarkdownText(str) {
  if (!str) return '';
  return str
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // [text](url) -> text
    .replace(/\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]/g, '$1') // [[target|alias]] -> target
    .replace(/[`*_~#<>]/g, ' ')
    .trim();
}

function extractHeadingKeywords(markdownContent) {
  const keywords = new Set();
  if (!markdownContent || typeof markdownContent !== 'string') return keywords;

  // H1 and H2 lines: lines starting with # or ##
  const headingRegex = /^(#{1,2})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(markdownContent)) !== null) {
    const rawHeading = match[2];
    const cleaned = cleanMarkdownText(rawHeading);
    // Tokenize Unicode words
    const words = cleaned.match(/[\p{L}\p{N}]+/gu) || [];
    for (const w of words) {
      const lower = w.toLowerCase().trim();
      if (lower.length >= 3 && !STOP_WORDS.has(lower) && isNaN(Number(lower))) {
        keywords.add(lower);
      }
    }
  }
  return keywords;
}

function extractWikilinksAndTags(markdownContent) {
  const tags = new Set();
  if (!markdownContent || typeof markdownContent !== 'string') return tags;

  // Matches [[tag]] or [[target|alias]]
  const linkRegex = /\[\[\s*([^\]\|\n]+)(?:\|[^\]\n]+)?\s*\]\]/g;
  let match;
  while ((match = linkRegex.exec(markdownContent)) !== null) {
    const raw = match[1].trim();
    if (raw) {
      tags.add(raw);
    }
  }
  return tags;
}

// ====== SCAN RECURSIVELY ======
function scanMarkdownFilesRecursively(dir, rootDir, result = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore .mark, .git, etc.
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanMarkdownFilesRecursively(fullPath, rootDir, result);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const relPath = path.relative(rootDir, fullPath);
        const folder = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
        result.push({
          fullPath,
          relPath,
          fileName: entry.name,
          baseName: path.basename(entry.name, path.extname(entry.name)),
          folder
        });
      }
    }
  } catch (err) {
    console.warn('[ConceptMap] Error scanning folder:', dir, err);
  }
  return result;
}

// ====== BUILD CONCEPT GRAPH ======
function buildConceptGraph(folderPath, existingData = null) {
  const files = scanMarkdownFilesRecursively(folderPath, folderPath);

  // Extract folder hierarchy
  const uniqueFolders = Array.from(new Set(files.map(f => f.folder).filter(Boolean))).sort();

  // Create node data
  const existingNodesMap = new Map();
  if (existingData && Array.isArray(existingData.nodes)) {
    for (const n of existingData.nodes) {
      existingNodesMap.set(n.id, n);
    }
  }

  const nodes = [];
  const fileNodesByBaseName = new Map();
  const fileNodesByRelPath = new Map();

  for (const file of files) {
    let content = '';
    try {
      content = fs.readFileSync(file.fullPath, 'utf-8');
    } catch (_) {}

    const tags = Array.from(extractWikilinksAndTags(content));
    const headingKeywords = Array.from(extractHeadingKeywords(content));
    const color = getFolderColor(file.folder, uniqueFolders);

    // Apply any node overrides (deleted tags / headings from this specific node)
    const nodeOverride = (existingData && existingData.nodeOverrides) ? existingData.nodeOverrides[file.relPath] : null;
    let activeTags = tags;
    let activeHeadingKeywords = headingKeywords;
    if (nodeOverride) {
      if (Array.isArray(nodeOverride.deletedTags) && nodeOverride.deletedTags.length > 0) {
        const delSet = new Set(nodeOverride.deletedTags.map(t => t.toLowerCase().trim()));
        activeTags = activeTags.filter(t => !delSet.has(t.toLowerCase().trim()));
      }
      if (Array.isArray(nodeOverride.deletedHeadings) && nodeOverride.deletedHeadings.length > 0) {
        const delSet = new Set(nodeOverride.deletedHeadings.map(h => h.toLowerCase().trim()));
        activeHeadingKeywords = activeHeadingKeywords.filter(h => !delSet.has(h.toLowerCase().trim()));
      }
    }

    const existing = existingNodesMap.get(file.relPath);

    let initX = null, initY = null;
    if (existing && typeof existing.x === 'number' && typeof existing.y === 'number') {
      initX = existing.x;
      initY = existing.y;
    } else {
      const folderIdx = Math.max(0, uniqueFolders.indexOf(file.folder));
      const totalFolders = Math.max(1, uniqueFolders.length);
      const angle = (folderIdx / totalFolders) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const baseDist = Math.min(420, 100 + Math.sqrt(files.length) * 28);
      const jitter = (Math.random() - 0.5) * 80;
      initX = Math.cos(angle) * (baseDist + jitter);
      initY = Math.sin(angle) * (baseDist + jitter);
    }

    const node = {
      id: file.relPath,
      name: file.baseName,
      fullName: file.fileName,
      path: file.fullPath,
      relPath: file.relPath,
      folder: file.folder || '.',
      folderName: file.folder ? path.basename(file.folder) : (path.basename(folderPath) || 'Root'),
      color: color,
      tags: activeTags,
      headingKeywords: activeHeadingKeywords,
      rawTags: tags,
      rawHeadingKeywords: headingKeywords,
      degree: 0,
      x: initX,
      y: initY,
      vx: 0,
      vy: 0,
      radius: 7
    };

    nodes.push(node);
    fileNodesByBaseName.set(file.baseName.toLowerCase(), node);
    fileNodesByRelPath.set(file.relPath.toLowerCase(), node);
  }

  // Frequency of heading keywords across files to prevent ubiquitous words from creating hairballs
  const headingDocCount = new Map();
  for (const node of nodes) {
    for (const k of node.headingKeywords) {
      const lower = k.toLowerCase();
      headingDocCount.set(lower, (headingDocCount.get(lower) || 0) + 1);
    }
  }
  // Max document threshold: if a heading keyword appears in > 18% of files (or > 4 files if N >= 8),
  // it is too generic to be an informative link and is omitted from automatic pairwise linking.
  const maxKwDocThreshold = Math.max(2, Math.min(4, Math.floor(nodes.length * 0.18)));

  // Frequency of abstract tags (tags that do not correspond to an existing file node in the vault)
  const tagDocCount = new Map();
  for (const node of nodes) {
    for (const t of node.tags) {
      const lower = t.toLowerCase();
      if (!fileNodesByBaseName.has(lower) && !fileNodesByRelPath.has(lower)) {
        tagDocCount.set(lower, (tagDocCount.get(lower) || 0) + 1);
      }
    }
  }

  const deletedLinks = Array.isArray(existingData?.deletedLinks) ? existingData.deletedLinks : [];
  const deletedSet = new Set(deletedLinks);
  const customLinks = Array.isArray(existingData?.customLinks) ? existingData.customLinks : [];

  // Compute connections between all pairs
  const links = [];
  const linkKeySet = new Set();

  for (let i = 0; i < nodes.length; i++) {
    const nodeA = nodes[i];
    const tagsA = new Set(nodeA.tags.map(t => t.toLowerCase()));
    const kwA = new Set(nodeA.headingKeywords.map(k => k.toLowerCase()));

    for (let j = i + 1; j < nodes.length; j++) {
      const nodeB = nodes[j];
      const tagsB = new Set(nodeB.tags.map(t => t.toLowerCase()));
      const kwB = new Set(nodeB.headingKeywords.map(k => k.toLowerCase()));

      const linkKey = nodeA.id < nodeB.id ? `${nodeA.id}<-->${nodeB.id}` : `${nodeB.id}<-->${nodeA.id}`;
      if (deletedSet.has(linkKey)) continue;

      const reasons = [];

      // 1. Direct wikilinks: does A link to B or B link to A?
      const aLinksToB = nodeA.tags.some(t => {
        const lower = t.toLowerCase();
        return lower === nodeB.name.toLowerCase() ||
               lower === nodeB.fullName.toLowerCase() ||
               lower === nodeB.relPath.toLowerCase();
      });

      const bLinksToA = nodeB.tags.some(t => {
        const lower = t.toLowerCase();
        return lower === nodeA.name.toLowerCase() ||
               lower === nodeA.fullName.toLowerCase() ||
               lower === nodeA.relPath.toLowerCase();
      });

      if (aLinksToB || bLinksToA) {
        reasons.push({
          type: 'direct_link',
          label: aLinksToB ? `[[${nodeB.name}]]` : `[[${nodeA.name}]]`
        });
      }

      // 2. Shared concept tags: tags that both files have
      // IMPORTANT: In Obsidian, when notes link to [[Topic]] and Topic.md exists,
      // each note connects to Topic.md (star topology). We must NOT generate
      // complete mesh cliques between all notes referencing Topic.md.
      const sharedTags = [];
      for (const t of tagsA) {
        if (tagsB.has(t)) {
          const lower = t.toLowerCase();
          // If this tag corresponds to an actual file in the vault, they already connect to it!
          if (fileNodesByBaseName.has(lower) || fileNodesByRelPath.has(lower)) {
            continue;
          }
          if (t !== nodeA.name.toLowerCase() && t !== nodeB.name.toLowerCase()) {
            const count = tagDocCount.get(lower) || 0;
            if (count <= 3) {
              sharedTags.push(t);
            }
          }
        }
      }
      if (sharedTags.length > 0) {
        reasons.push({
          type: 'tag',
          label: sharedTags.map(st => `[[${st}]]`).join(', ')
        });
      }

      // 3. Shared heading keywords (H1 & H2)
      const sharedKeywords = [];
      for (const k of kwA) {
        if (kwB.has(k)) {
          const docCount = headingDocCount.get(k) || 0;
          if (docCount <= maxKwDocThreshold) {
            sharedKeywords.push(k);
          }
        }
      }
      if (sharedKeywords.length > 0) {
        reasons.push({
          type: 'heading',
          label: sharedKeywords.map(sk => `#${sk}`).join(', ')
        });
      }

      if (reasons.length > 0) {
        if (!linkKeySet.has(linkKey)) {
          linkKeySet.add(linkKey);

          nodeA.degree++;
          nodeB.degree++;

          links.push({
            source: nodeA.id,
            target: nodeB.id,
            sourceNode: nodeA,
            targetNode: nodeB,
            reasons: reasons,
            weight: (reasons.some(r => r.type === 'direct_link') ? 3 : 0) +
                    (sharedTags.length * 2) +
                    (sharedKeywords.length * 1)
          });
        }
      }
    }
  }

  // 4. Custom user-created links
  for (const cl of customLinks) {
    const key = cl.source < cl.target ? `${cl.source}<-->${cl.target}` : `${cl.target}<-->${cl.source}`;
    if (deletedSet.has(key)) continue;
    if (linkKeySet.has(key)) continue;

    const nA = fileNodesByRelPath.get(cl.source.toLowerCase()) || nodes.find(n => n.id === cl.source);
    const nB = fileNodesByRelPath.get(cl.target.toLowerCase()) || nodes.find(n => n.id === cl.target);
    if (nA && nB) {
      linkKeySet.add(key);
      nA.degree++;
      nB.degree++;
      links.push({
        source: nA.id,
        target: nB.id,
        sourceNode: nA,
        targetNode: nB,
        reasons: [{ type: 'manual', label: '' }],
        isManual: true,
        weight: 3
      });
    }
  }

  // Adjust node radius based on connection degree (più compatti ed eleganti)
  for (const node of nodes) {
    node.radius = Math.min(
      GRAPH_CONFIG.nodeMaxRadius,
      Math.max(GRAPH_CONFIG.nodeMinRadius, GRAPH_CONFIG.nodeMinRadius + Math.sqrt(node.degree) * GRAPH_CONFIG.nodeDegreeFactor)
    );
  }

  const physics = existingData && existingData.physics ? { ...DEFAULT_PHYSICS, ...existingData.physics } : { ...DEFAULT_PHYSICS };

  return {
    project: 'Mark Concept Graph',
    version: '1.0',
    folderPath,
    lastUpdated: new Date().toISOString(),
    physics,
    nodes,
    links: links.map(l => ({
      source: l.source,
      target: l.target,
      reasons: l.reasons,
      weight: l.weight,
      isManual: !!l.isManual
    })),
    deletedLinks: Array.from(deletedSet),
    customLinks: customLinks,
    nodeOverrides: (existingData && typeof existingData.nodeOverrides === 'object') ? existingData.nodeOverrides : {},
    folders: [
      { path: '.', name: path.basename(folderPath) || 'Root', color: FOLDER_PALETTE[0] },
      ...uniqueFolders.map(f => ({
        path: f,
        name: path.basename(f),
        color: getFolderColor(f, uniqueFolders)
      }))
    ]
  };
}

function getLinkKey(source, target) {
  const s = String(source || '');
  const t = String(target || '');
  return s < t ? `${s}<-->${t}` : `${t}<-->${s}`;
}

// ====== 2D FORCE PHYSICS & CANVAS SIMULATION ======
class ConceptGraphSimulation {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;

    this.nodes = [];
    this.allLinks = [];
    this.links = [];
    this.nodeMap = new Map();
    this.folders = [];
    this.hiddenNodeIds = new Set();
    this.selectedNodeIds = new Set();
    this.deletedLinkKeys = new Set();
    this.customLinks = [];
    this.nodeOverrides = {};
    this.depthFilter = null; // { focusNodeId, focusNodeName, depth, visibleNodeIds: Set }
    this.physics = { ...DEFAULT_PHYSICS };

    // Camera transform
    this.transformX = 0;
    this.transformY = 0;
    this.scale = 1.0;

    // Interaction state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.draggedNode = null;
    this.hoveredNode = null;
    this.hoveredEdge = null;
    this.activeSearchQuery = '';
    this.matchedNodeIds = new Set();

    // Loop & Alpha cooling control
    this.rafId = null;
    this.isRunning = false;
    this.alpha = 1.0;
    this.alphaMin = 0.003;
    this.alphaDecay = 0.02;

    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    if (typeof window !== 'undefined' && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.canvas);
    }

    this.setupEvents();
  }

  setData(graphData) {
    if (!graphData) return;
    this.physics = { ...this.physics, ...(graphData.physics || {}) };
    this.folders = graphData.folders || [];
    this.deletedLinkKeys = new Set(graphData.deletedLinks || []);
    this.customLinks = Array.isArray(graphData.customLinks) ? [...graphData.customLinks] : [];
    this.nodeOverrides = (graphData && typeof graphData.nodeOverrides === 'object') ? JSON.parse(JSON.stringify(graphData.nodeOverrides)) : {};

    this.nodes = (graphData.nodes || []).map(n => ({
      ...n,
      vx: 0,
      vy: 0
    }));

    this.nodeMap.clear();
    for (const node of this.nodes) {
      this.nodeMap.set(node.id, node);
    }

    this.allLinks = (graphData.links || []).map(l => {
      const src = this.nodeMap.get(l.source);
      const tgt = this.nodeMap.get(l.target);
      return {
        ...l,
        sourceNode: src,
        targetNode: tgt
      };
    }).filter(l => l.sourceNode && l.targetNode);

    this.updateActiveLinks();

    // Initial center if fresh
    if (this.nodes.length > 0) {
      let cx = 0, cy = 0;
      for (const n of this.nodes) { cx += n.x; cy += n.y; }
      cx /= this.nodes.length;
      cy /= this.nodes.length;
      const width = this.canvas.clientWidth || 800;
      const height = this.canvas.clientHeight || 600;
      this.transformX = width / 2 - cx * this.scale;
      this.transformY = height / 2 - cy * this.scale;
    }

    this.wake();
  }

  updateActiveLinks() {
    const linkByTags = this.physics.linkByTags !== false;
    const linkByHeadings = this.physics.linkByHeadings !== false;

    this.links = [];
    for (const l of this.allLinks) {
      const key = getLinkKey(l.source, l.target);
      if (this.deletedLinkKeys.has(key)) continue;

      if (l.isManual) {
        this.links.push(l);
        continue;
      }

      const activeReasons = (l.reasons || []).filter(r => {
        if (r.type === 'tag') return linkByTags;
        if (r.type === 'heading') return linkByHeadings;
        if (r.type === 'direct_link') return true;
        if (r.type === 'manual') return true;
        return true;
      });

      if (activeReasons.length > 0) {
        l.activeReasons = activeReasons;
        this.links.push(l);
      }
    }

    this.recalculateDegrees();

    if (this.depthFilter) {
      this.filterByDepth(this.depthFilter.focusNodeId, this.depthFilter.depth);
    }
  }

  recalculateDegrees() {
    for (const n of this.nodes) {
      n.degree = 0;
    }
    for (const l of this.links) {
      if (l.sourceNode && l.targetNode) {
        l.sourceNode.degree++;
        l.targetNode.degree++;
      }
    }
    for (const n of this.nodes) {
      n.radius = Math.min(
        GRAPH_CONFIG.nodeMaxRadius,
        Math.max(GRAPH_CONFIG.nodeMinRadius, GRAPH_CONFIG.nodeMinRadius + Math.sqrt(n.degree) * GRAPH_CONFIG.nodeDegreeFactor)
      );
    }
  }

  deleteLink(edge) {
    if (!edge) return;
    const key = getLinkKey(edge.source, edge.target);
    this.deletedLinkKeys.add(key);

    this.allLinks = this.allLinks.filter(l => getLinkKey(l.source, l.target) !== key);
    this.links = this.links.filter(l => getLinkKey(l.source, l.target) !== key);
    this.customLinks = this.customLinks.filter(l => getLinkKey(l.source, l.target) !== key);

    if (this.hoveredEdge && getLinkKey(this.hoveredEdge.source, this.hoveredEdge.target) === key) {
      this.hoveredEdge = null;
      if (typeof this.options.onEdgeHover === 'function') {
        this.options.onEdgeHover(null);
      }
    }

    this.recalculateDegrees();
    this.wake(0.5);

    if (typeof this.options.onGraphDataChange === 'function') {
      this.options.onGraphDataChange();
    }
  }

  connectSelectedNodes() {
    const selectedArray = Array.from(this.selectedNodeIds);
    if (selectedArray.length < 2) return;

    for (let i = 0; i < selectedArray.length; i++) {
      for (let j = i + 1; j < selectedArray.length; j++) {
        const idA = selectedArray[i];
        const idB = selectedArray[j];
        const key = getLinkKey(idA, idB);

        this.deletedLinkKeys.delete(key);

        const exists = this.links.some(l => getLinkKey(l.source, l.target) === key);
        if (!exists) {
          const nodeA = this.nodeMap.get(idA);
          const nodeB = this.nodeMap.get(idB);
          if (nodeA && nodeB) {
            const customLink = {
              source: idA,
              target: idB,
              sourceNode: nodeA,
              targetNode: nodeB,
              reasons: [{ type: 'manual', label: '' }],
              isManual: true,
              weight: 3
            };
            this.allLinks.push(customLink);
            this.links.push(customLink);
            this.customLinks.push({ source: idA, target: idB });
          }
        }
      }
    }

    this.selectedNodeIds.clear();
    this.recalculateDegrees();
    this.wake(0.6);

    if (typeof this.options.onSelectionChange === 'function') {
      this.options.onSelectionChange([]);
    }
    if (typeof this.options.onGraphDataChange === 'function') {
      this.options.onGraphDataChange();
    }
  }

  removeNodeTag(nodeId, tag) {
    if (!nodeId || !tag) return;
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const tagLower = tag.toLowerCase().trim();
    if (!this.nodeOverrides[nodeId]) {
      this.nodeOverrides[nodeId] = { deletedTags: [], deletedHeadings: [] };
    }
    if (!Array.isArray(this.nodeOverrides[nodeId].deletedTags)) {
      this.nodeOverrides[nodeId].deletedTags = [];
    }
    if (!this.nodeOverrides[nodeId].deletedTags.includes(tagLower)) {
      this.nodeOverrides[nodeId].deletedTags.push(tagLower);
    }

    // Remove from node.tags
    node.tags = (node.tags || []).filter(t => t.toLowerCase().trim() !== tagLower);

    // Update allLinks: remove tag reasons or direct links matching this tag
    this.allLinks = this.allLinks.filter(l => {
      const isSrc = l.source === nodeId;
      const isTgt = l.target === nodeId;
      if (!isSrc && !isTgt) return true;
      if (l.isManual) return true;

      l.reasons = (l.reasons || []).filter(r => {
        if (r.type === 'tag') {
          return r.label.toLowerCase().trim() !== tagLower;
        }
        if (r.type === 'direct_link') {
          const clean = r.label.replace(/^\[\[|\]\]$/g, '').toLowerCase().trim();
          return clean !== tagLower;
        }
        return true;
      });

      return l.reasons.length > 0;
    });

    this.updateActiveLinks();
    this.wake(0.4);

    if (typeof this.options.onGraphDataChange === 'function') {
      this.options.onGraphDataChange();
    }
  }

  removeNodeHeading(nodeId, heading) {
    if (!nodeId || !heading) return;
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const headingLower = heading.toLowerCase().trim();
    if (!this.nodeOverrides[nodeId]) {
      this.nodeOverrides[nodeId] = { deletedTags: [], deletedHeadings: [] };
    }
    if (!Array.isArray(this.nodeOverrides[nodeId].deletedHeadings)) {
      this.nodeOverrides[nodeId].deletedHeadings = [];
    }
    if (!this.nodeOverrides[nodeId].deletedHeadings.includes(headingLower)) {
      this.nodeOverrides[nodeId].deletedHeadings.push(headingLower);
    }

    // Remove from node.headingKeywords
    node.headingKeywords = (node.headingKeywords || []).filter(k => k.toLowerCase().trim() !== headingLower);

    // Update allLinks: remove heading reasons matching this heading
    this.allLinks = this.allLinks.filter(l => {
      const isSrc = l.source === nodeId;
      const isTgt = l.target === nodeId;
      if (!isSrc && !isTgt) return true;
      if (l.isManual) return true;

      l.reasons = (l.reasons || []).filter(r => {
        if (r.type === 'heading') {
          return r.label.toLowerCase().trim() !== headingLower;
        }
        return true;
      });

      return l.reasons.length > 0;
    });

    this.updateActiveLinks();
    this.wake(0.4);

    if (typeof this.options.onGraphDataChange === 'function') {
      this.options.onGraphDataChange();
    }
  }

  isNodeVisible(node) {
    if (!node) return false;
    if (this.hiddenNodeIds.has(node.id)) return false;
    if (this.depthFilter && !this.depthFilter.visibleNodeIds.has(node.id)) return false;
    if (this.physics.hideOrphans && node.degree === 0) return false;
    return true;
  }

  filterByDepth(focusNodeId, depth = 1) {
    if (!focusNodeId || depth <= 0) {
      this.depthFilter = null;
      this.wake(0.35);
      if (typeof this.options.onFilterChange === 'function') {
        this.options.onFilterChange(this.depthFilter, this.hiddenNodeIds);
      }
      return;
    }

    const focusNode = this.nodeMap.get(focusNodeId);
    if (!focusNode) return;

    const visibleNodeIds = new Set([focusNodeId]);
    let currentLevel = new Set([focusNodeId]);

    for (let d = 1; d <= depth; d++) {
      const nextLevel = new Set();
      for (const nodeId of currentLevel) {
        for (const link of this.links) {
          const sId = link.sourceNode?.id;
          const tId = link.targetNode?.id;
          if (!sId || !tId) continue;
          if (this.hiddenNodeIds.has(sId) || this.hiddenNodeIds.has(tId)) continue;

          if (sId === nodeId && !visibleNodeIds.has(tId)) {
            nextLevel.add(tId);
            visibleNodeIds.add(tId);
          } else if (tId === nodeId && !visibleNodeIds.has(sId)) {
            nextLevel.add(sId);
            visibleNodeIds.add(sId);
          }
        }
      }
      currentLevel = nextLevel;
      if (currentLevel.size === 0) break;
    }

    this.depthFilter = {
      focusNodeId,
      focusNodeName: focusNode.name,
      depth,
      visibleNodeIds
    };

    this.wake(0.45);
    if (typeof this.options.onFilterChange === 'function') {
      this.options.onFilterChange(this.depthFilter, this.hiddenNodeIds);
    }
  }

  hideNode(nodeId) {
    if (!nodeId) return;
    this.hiddenNodeIds.add(nodeId);
    if (this.depthFilter && this.depthFilter.focusNodeId === nodeId) {
      this.depthFilter = null;
    } else if (this.depthFilter) {
      this.filterByDepth(this.depthFilter.focusNodeId, this.depthFilter.depth);
    }
    this.wake(0.35);
    if (typeof this.options.onFilterChange === 'function') {
      this.options.onFilterChange(this.depthFilter, this.hiddenNodeIds);
    }
  }

  resetNodeVisibility() {
    this.hiddenNodeIds.clear();
    this.depthFilter = null;
    this.wake(0.45);
    if (typeof this.options.onFilterChange === 'function') {
      this.options.onFilterChange(this.depthFilter, this.hiddenNodeIds);
    }
  }

  setupEvents() {
    const c = this.canvas;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 20; // lines
      else if (e.deltaMode === 2) dy *= 300; // pages

      // Clamp delta to prevent sudden huge jumps
      dy = Math.max(-50, Math.min(50, dy));

      // Continuous smooth exponential zoom factor (pinpoint controllable on trackpad & mouse)
      const zoomIntensity = 0.0028;
      const zoomFactor = Math.exp(-dy * zoomIntensity);

      const minScale = 0.12;
      const maxScale = 4.2;
      const newScale = Math.min(maxScale, Math.max(minScale, this.scale * zoomFactor));

      if (Math.abs(newScale - this.scale) > 0.0001) {
        this.transformX = mouseX - (mouseX - this.transformX) * (newScale / this.scale);
        this.transformY = mouseY - (mouseY - this.transformY) * (newScale / this.scale);
        this.scale = newScale;
        this.wake(0.25);
      }
    }, { passive: false });

    let clickStartX = 0;
    let clickStartY = 0;
    let clickStartTime = 0;

    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      clickStartX = mouseX;
      clickStartY = mouseY;
      clickStartTime = Date.now();

      const worldPos = this.screenToWorld(mouseX, mouseY);
      const hitNode = this.hitTestNode(worldPos.x, worldPos.y);

      if (hitNode) {
        this.draggedNode = hitNode;
        c.style.cursor = 'grabbing';
      } else {
        this.isPanning = true;
        this.panStartX = mouseX - this.transformX;
        this.panStartY = mouseY - this.transformY;
        c.style.cursor = 'grabbing';
      }
      this.wake();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.canvas.offsetParent) return;
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.draggedNode) {
        const worldPos = this.screenToWorld(mouseX, mouseY);
        this.draggedNode.x = worldPos.x;
        this.draggedNode.y = worldPos.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        this.wake();
        return;
      }

      if (this.isPanning) {
        this.transformX = mouseX - this.panStartX;
        this.transformY = mouseY - this.panStartY;
        this.wake();
        return;
      }

      // Hover detection
      if (mouseX >= 0 && mouseX <= rect.width && mouseY >= 0 && mouseY <= rect.height) {
        const worldPos = this.screenToWorld(mouseX, mouseY);
        const hitNode = this.hitTestNode(worldPos.x, worldPos.y);
        const hitEdge = hitNode ? null : this.hitTestEdge(worldPos.x, worldPos.y);

        let changed = false;
        if (hitNode !== this.hoveredNode) {
          this.hoveredNode = hitNode;
          changed = true;
          if (typeof this.options.onNodeHover === 'function') {
            this.options.onNodeHover(hitNode, e.clientX, e.clientY);
          }
        }
        if (hitEdge !== this.hoveredEdge) {
          this.hoveredEdge = hitEdge;
          changed = true;
          if (typeof this.options.onEdgeHover === 'function') {
            this.options.onEdgeHover(hitEdge, e.clientX, e.clientY);
          }
        }

        if (hitNode) {
          c.style.cursor = 'pointer';
        } else if (hitEdge) {
          c.style.cursor = 'pointer';
        } else {
          c.style.cursor = 'grab';
        }

        if (changed) this.wake();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const dist = Math.hypot(mouseX - clickStartX, mouseY - clickStartY);
      const elapsed = Date.now() - clickStartTime;

      if (this.draggedNode && dist < 10 && elapsed < 500) {
        if (e.shiftKey) {
          // Shift + Click: toggle multi-selection
          if (this.selectedNodeIds.has(this.draggedNode.id)) {
            this.selectedNodeIds.delete(this.draggedNode.id);
          } else {
            this.selectedNodeIds.add(this.draggedNode.id);
          }
          this.wake(0.2);
          if (typeof this.options.onSelectionChange === 'function') {
            this.options.onSelectionChange(Array.from(this.selectedNodeIds));
          }
        } else {
          if (this.selectedNodeIds.size > 0) {
            this.selectedNodeIds.clear();
            if (typeof this.options.onSelectionChange === 'function') {
              this.options.onSelectionChange([]);
            }
          }
          // Clicked node!
          if (typeof this.options.onNodeClick === 'function') {
            this.options.onNodeClick(this.draggedNode);
          }
        }
      }

      this.draggedNode = null;
      this.isPanning = false;
      c.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    });

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const worldPos = this.screenToWorld(mouseX, mouseY);
      const hitNode = this.hitTestNode(worldPos.x, worldPos.y);
      const hitEdge = hitNode ? null : this.hitTestEdge(worldPos.x, worldPos.y);
      if (typeof this.options.onContextMenu === 'function') {
        this.options.onContextMenu(hitNode, hitEdge, e);
      }
    });

    c.addEventListener('dblclick', (e) => {
      const rect = c.getBoundingClientRect();
      const worldPos = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const hitNode = this.hitTestNode(worldPos.x, worldPos.y);
      if (hitNode && typeof this.options.onNodeDoubleClick === 'function') {
        this.options.onNodeDoubleClick(hitNode);
      }
    });

    c.addEventListener('mouseleave', () => {
      if (this.hoveredNode || this.hoveredEdge) {
        this.hoveredNode = null;
        this.hoveredEdge = null;
        if (typeof this.options.onNodeHover === 'function') this.options.onNodeHover(null);
        if (typeof this.options.onEdgeHover === 'function') this.options.onEdgeHover(null);
        this.wake();
      }
    });
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.transformX) / this.scale,
      y: (sy - this.transformY) / this.scale
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.scale + this.transformX,
      y: wy * this.scale + this.transformY
    };
  }

  hitTestNode(wx, wy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (!this.isNodeVisible(n)) continue;
      const dist = Math.hypot(wx - n.x, wy - n.y);
      if (dist <= n.radius + 4) {
        return n;
      }
    }
    return null;
  }

  hitTestEdge(wx, wy) {
    const threshold = 6 / this.scale;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const link = this.links[i];
      const p1 = link.sourceNode;
      const p2 = link.targetNode;
      if (!p1 || !p2) continue;
      if (!this.isNodeVisible(p1) || !this.isNodeVisible(p2)) continue;

      const d = distToSegment({ x: wx, y: wy }, p1, p2);
      if (d <= threshold) {
        return link;
      }
    }
    return null;
  }

  setSearchQuery(query) {
    this.activeSearchQuery = (query || '').trim().toLowerCase();
    this.matchedNodeIds.clear();

    if (this.activeSearchQuery) {
      for (const n of this.nodes) {
        const matchesName = n.name.toLowerCase().includes(this.activeSearchQuery);
        const matchesTag = n.tags.some(t => t.toLowerCase().includes(this.activeSearchQuery));
        const matchesKw = n.headingKeywords.some(k => k.toLowerCase().includes(this.activeSearchQuery));
        if (matchesName || matchesTag || matchesKw) {
          this.matchedNodeIds.add(n.id);
        }
      }
    }
    this.wake();
  }

  fitToView() {
    const visibleNodes = this.nodes.filter(n => this.isNodeVisible(n));
    if (visibleNodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const padding = 80;
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;

    const graphWidth = Math.max(maxX - minX + padding * 2, 100);
    const graphHeight = Math.max(maxY - minY + padding * 2, 100);

    const scaleX = width / graphWidth;
    const scaleY = height / graphHeight;
    this.scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.8);

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    this.transformX = width / 2 - midX * this.scale;
    this.transformY = height / 2 - midY * this.scale;

    this.wake();
  }

  wake(targetAlpha = 0.45) {
    this.alpha = Math.max(this.alpha, targetAlpha);
    if (!this.isRunning) {
      this.isRunning = true;
      this.loop();
    }
  }

  step() {
    const nodes = this.nodes;
    const links = this.links;
    const count = nodes.length;
    if (count === 0) return 0;

    const repulsion = this.physics.repulsion || 220;
    const linkDist = this.physics.linkDistance || 130;
    const gravity = (this.physics.gravity !== undefined ? this.physics.gravity : 0.008);
    const friction = this.physics.friction || 0.85;

    const isSettled = (this.alpha < this.alphaMin);

    if (!isSettled) {
      // 1. Coulomb repulsion (ammorbidita con + 150)
      const repConst = repulsion * 75;
      for (let i = 0; i < count; i++) {
        const n1 = nodes[i];
        if (!this.isNodeVisible(n1)) continue;
        for (let j = i + 1; j < count; j++) {
          const n2 = nodes[j];
          if (!this.isNodeVisible(n2)) continue;
          let dx = n2.x - n1.x;
          let dy = n2.y - n1.y;
          let dist = Math.hypot(dx, dy);
          if (dist === 0) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            dist = Math.hypot(dx, dy);
          }

          // Softened repulsion: non fionda i nodi attraverso lo schermo
          const rawForce = repConst / (dist * dist + 150);
          const force = Math.min(rawForce, 28) * this.alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          n1.vx -= fx;
          n1.vy -= fy;
          n2.vx += fx;
          n2.vy += fy;
        }
      }

      // 2. Hooke spring attraction along edges (scalata per il grado dei nodi)
      for (const link of links) {
        const s = link.sourceNode;
        const t = link.targetNode;
        if (!s || !t) continue;
        if (!this.isNodeVisible(s) || !this.isNodeVisible(t)) continue;

        let dx = t.x - s.x;
        let dy = t.y - s.y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) dist = 0.1;

        const displacement = dist - linkDist;
        // Grado combinato: evita che nodi con molti collegamenti vengano schiacciati in un punto nero
        const degreeDamp = Math.sqrt(Math.max(1, Math.min(s.degree, t.degree)));
        const strength = (0.035 / degreeDamp) * this.alpha;
        const force = Math.max(-14, Math.min(14, displacement * strength));

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }

      // 3. Center gravity pull & velocity integration with speed capping
      const maxSpeed = 7.5;
      for (const n of nodes) {
        if (!this.isNodeVisible(n)) continue;
        if (n === this.draggedNode) continue;

        n.vx -= n.x * (gravity * 0.15) * this.alpha;
        n.vy -= n.y * (gravity * 0.15) * this.alpha;

        n.vx *= friction;
        n.vy *= friction;

        const speed = Math.hypot(n.vx, n.vy);
        if (speed > maxSpeed) {
          n.vx = (n.vx / speed) * maxSpeed;
          n.vy = (n.vy / speed) * maxSpeed;
        }

        n.x += n.vx;
        n.y += n.vy;
      }

      // Annealing decay progressivo
      this.alpha *= (1 - this.alphaDecay);
    }

    // 4. Dynamic Idle Orbital Floating Motion (moto orbitale e oscillazione fluida dei cluster)
    if (this.physics.dynamicIdle) {
      const t = performance.now() * 0.001 * GRAPH_CONFIG.dynamicIdleSpeed;
      const count = nodes.length;

      // Mantiene una costante e dolce vitalità alla rete di molle per un moto fluido e coeso
      if (this.alpha < 0.04) {
        this.alpha = 0.04;
      }

      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        if (!this.isNodeVisible(n)) continue;
        if (n === this.draggedNode) continue;

        const seed = (n.seed !== undefined) ? n.seed : (n.seed = i * 2.3999632297);
        const dist = Math.hypot(n.x, n.y) + 80;

        // Spinta orbitale tangenziale attorno al baricentro
        const tangentX = (-n.y / dist) * GRAPH_CONFIG.dynamicOrbitalSwirl * 0.75;
        const tangentY = (n.x / dist) * GRAPH_CONFIG.dynamicOrbitalSwirl * 0.75;

        // Galleggiamento armonico a multifrequenza (respiro organico dei nodi)
        const waveX = Math.cos(t * 1.1 + seed) * (GRAPH_CONFIG.dynamicIdleForce * 0.7) +
                      Math.sin(t * 0.5 + seed * 1.6) * (GRAPH_CONFIG.dynamicIdleForce * 0.4);
        const waveY = Math.sin(t * 0.95 + seed * 1.3) * (GRAPH_CONFIG.dynamicIdleForce * 0.7) +
                      Math.cos(t * 0.6 + seed * 0.8) * (GRAPH_CONFIG.dynamicIdleForce * 0.4);

        n.vx += tangentX * 0.35 + waveX * 0.18;
        n.vy += tangentY * 0.35 + waveY * 0.18;
      }
    }

    return this.alpha;
  }

  toggleDynamicIdle() {
    this.physics.dynamicIdle = !this.physics.dynamicIdle;
    if (this.physics.dynamicIdle) {
      this.wake(0.01);
    }
    return this.physics.dynamicIdle;
  }

  resize() {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    c.width = Math.round(rect.width * this.dpr);
    c.height = Math.round(rect.height * this.dpr);

    this.wake(0.35);
  }

  loop() {
    if (!this.isRunning) return;

    this.step();
    this.render();

    // Se l'alpha è scesa sotto il minimo e non c'è dragging/pan/dynamicIdle, la simulazione si ferma in idle
    if (this.alpha <= this.alphaMin && !this.draggedNode && !this.isPanning && !this.physics.dynamicIdle) {
      this.isRunning = false;
      this.rafId = null;
      return;
    }

    this.rafId = requestAnimationFrame(() => this.loop());
  }

  render() {
    const c = this.canvas;
    const ctx = this.ctx;
    const width = c.clientWidth;
    const height = c.clientHeight;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Dark mode check
    const isDark = document.body.classList.contains('dark');
    const bgColor = isDark ? '#141414' : '#f7f7f8';
    const textColor = isDark ? '#e2e8f0' : '#1e293b';
    const defaultNodeColor = isDark ? '#94a3b8' : '#64748b';
    const highlightBlue = isDark ? '#60a5fa' : '#2563eb';

    // Clear background (solid plain color)
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(this.transformX, this.transformY);
    ctx.scale(this.scale, this.scale);

    // Determine neighbor set if hovering a node
    const connectedNodeIds = new Set();
    if (this.hoveredNode && this.isNodeVisible(this.hoveredNode)) {
      connectedNodeIds.add(this.hoveredNode.id);
      for (const link of this.links) {
        if (!this.isNodeVisible(link.sourceNode) || !this.isNodeVisible(link.targetNode)) continue;
        if (link.sourceNode === this.hoveredNode) connectedNodeIds.add(link.targetNode.id);
        if (link.targetNode === this.hoveredNode) connectedNodeIds.add(link.sourceNode.id);
      }
    }

    const hasFilter = this.matchedNodeIds.size > 0;

    // 1. Draw Edges
    for (const link of this.links) {
      const s = link.sourceNode;
      const t = link.targetNode;
      if (!s || !t) continue;
      if (!this.isNodeVisible(s) || !this.isNodeVisible(t)) continue;

      const isHovered = (this.hoveredEdge === link);
      const isConnectedToHovered = this.hoveredNode && (s === this.hoveredNode || t === this.hoveredNode);
      const isFilteredOut = hasFilter && (!this.matchedNodeIds.has(s.id) || !this.matchedNodeIds.has(t.id));

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);

      // Collegamenti sempre continui e diretti (non tratteggiati)
      if (GRAPH_CONFIG.linkDashed) {
        ctx.setLineDash([3 / this.scale, 3 / this.scale]);
      } else {
        ctx.setLineDash([]);
      }

      if (isHovered || isConnectedToHovered) {
        ctx.strokeStyle = highlightBlue;
        ctx.lineWidth = (GRAPH_CONFIG.linkWidthHover + 0.4) / this.scale;
        ctx.globalAlpha = 1.0;
      } else if (this.hoveredNode || isFilteredOut) {
        ctx.strokeStyle = isDark ? '#4b5563' : '#cbd5e1';
        ctx.lineWidth = 1.0 / this.scale;
        ctx.globalAlpha = 0.08;
      } else {
        const baseOpacity = isDark ? GRAPH_CONFIG.linkOpacityDark : GRAPH_CONFIG.linkOpacityLight;
        ctx.strokeStyle = isDark ? `rgba(255, 255, 255, ${baseOpacity})` : `rgba(0, 0, 0, ${baseOpacity})`;
        ctx.lineWidth = GRAPH_CONFIG.linkWidthNormal / this.scale;
        ctx.globalAlpha = 0.85;
      }

      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // 2. Draw Nodes
    for (const node of this.nodes) {
      if (!this.isNodeVisible(node)) continue;
      const isHovered = (this.hoveredNode === node);
      const isConnected = connectedNodeIds.has(node.id);
      const isMatched = !hasFilter || this.matchedNodeIds.has(node.id);

      let alpha = 1.0;
      if (this.hoveredNode) {
        alpha = (isHovered || isConnected) ? 1.0 : 0.16;
      } else if (hasFilter) {
        alpha = isMatched ? 1.0 : 0.15;
      }
      ctx.globalAlpha = alpha;

      // Micro-animazione fluida sul raggio del nodo (espansione progressiva)
      const targetRadius = isHovered ? node.radius * 1.35 : (isConnected ? node.radius * 1.15 : node.radius);
      if (!node.animRadius) node.animRadius = node.radius;
      node.animRadius += (targetRadius - node.animRadius) * 0.35;
      const r = node.animRadius;

      // Cerchio nodo - colore uniforme neutro, o blu vibrante se in hover o collegato
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = (isHovered || isConnected || (hasFilter && isMatched)) ? highlightBlue : defaultNodeColor;
      ctx.fill();

      // Selection ring if selected via Shift+Click
      if (this.selectedNodeIds.has(node.id)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4 / this.scale, 0, Math.PI * 2);
        ctx.lineWidth = 2.2 / this.scale;
        ctx.strokeStyle = highlightBlue;
        ctx.setLineDash([4 / this.scale, 2.5 / this.scale]);
        ctx.stroke();
        ctx.restore();
      }

      // Accent ring solo su nodo hovered (senza bolla opaca)
      if (isHovered) {
        ctx.lineWidth = 1.8 / this.scale;
        ctx.strokeStyle = isDark ? '#ffffff' : '#1d4ed8';
        ctx.stroke();
      } else if (GRAPH_CONFIG.drawNodeBorder) {
        ctx.lineWidth = 1.0 / this.scale;
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.25)';
        ctx.stroke();
      }

      // Node Label (evidenziata in blu per nodo hovered e nodi collegati)
      const shouldShowLabel = this.physics.showAllLabels || isHovered || isConnected || (hasFilter && isMatched) || this.scale > 1.2;
      if (shouldShowLabel) {
        ctx.font = `${isHovered || isConnected ? '600 ' : '400 '}${Math.round(11 / Math.max(0.7, Math.min(this.scale, 1.4)))}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Text subtle shadow for clarity
        ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(node.name, node.x, node.y + r + 3 / this.scale + 0.5);
        ctx.fillStyle = (isHovered || isConnected || (hasFilter && isMatched)) ? highlightBlue : textColor;
        ctx.fillText(node.name, node.x, node.y + r + 3 / this.scale);
      }
    }

    ctx.restore();
    ctx.restore();
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.isRunning = false;
  }
}

// Distance point to segment helper
function distToSegment(p, v, w) {
  const l2 = Math.hypot(v.x - w.x, v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

// ====== MODULE EXPORT ======
module.exports = {
  GRAPH_CONFIG,
  DEFAULT_PHYSICS,
  STOP_WORDS,
  FOLDER_PALETTE,
  getFolderColor,
  extractHeadingKeywords,
  extractWikilinksAndTags,
  scanMarkdownFilesRecursively,
  buildConceptGraph,
  ConceptGraphSimulation
};
