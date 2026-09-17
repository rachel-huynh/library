// Two SVG views of the same topic tree:
//
//   radialMindmap  - the taxonomy, drawn outward from the library at the centre.
//   connectionGraph - the same topics on a ring, with chords where they share
//                     vocabulary, which is what shows the library as one body
//                     of knowledge rather than a set of unrelated folders.
//
// Layouts are computed, not simulated: the same data always draws the same
// picture, which matters when you are looking for changes over time.

import { t, pick } from './i18n.js';
import { buildTopicTree } from './db.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const topicName = (topic) => pick(topic.name_en, topic.name_vi);
const polar = (cx, cy, radius, degrees) => {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
};

/** Node radius grows with the square root of the count, so area reads as volume. */
const nodeRadius = (count) => (count ? Math.min(26, 7 + Math.sqrt(count) * 2.6) : 5);

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ==========================================================================
// Radial mindmap
// ==========================================================================

export function radialMindmap(topics, countsById, { onSelect } = {}) {
  const roots = buildTopicTree(topics);
  if (!roots.length) return null;

  const W = 1080;
  const H = 820;
  const cx = W / 2;
  const cy = H / 2;
  const R1 = 165; // domains
  const R2 = 288; // subtopics

  const total = (id) => Number(countsById.get(id)?.total_count ?? 0);

  const edges = [];
  const nodes = [];

  // A domain's share of the circle is proportional to how many subtopics it has.
  // Equal slices would crush a six-child branch into the same wedge as a
  // childless one, and the labels collide.
  const weightOf = (domain) => Math.max(1, (domain.children ?? []).length);
  const totalWeight = roots.reduce((sum, domain) => sum + weightOf(domain), 0);

  let cursor = 0;
  roots.forEach((domain) => {
    const span = (360 * weightOf(domain)) / totalWeight;
    const angle = cursor + span / 2;
    cursor += span;

    const [dx, dy] = polar(cx, cy, R1, angle);
    const count = total(domain.id);
    nodes.push({ topic: domain, x: dx, y: dy, count, level: 1, angle });
    edges.push({ x1: cx, y1: cy, x2: dx, y2: dy, weight: count });

    const children = domain.children ?? [];
    if (!children.length) return;

    const usable = span * 0.82;
    const step = children.length > 1 ? usable / (children.length - 1) : 0;
    const start = angle - (children.length > 1 ? usable / 2 : 0);

    children.forEach((child, childIndex) => {
      const childAngle = start + childIndex * step;
      // Alternate the ring so neighbouring labels never sit on the same line.
      const radius = R2 + (childIndex % 2 ? 46 : 0);
      const [x, y] = polar(cx, cy, radius, childAngle);
      const childCount = total(child.id);
      nodes.push({ topic: child, x, y, count: childCount, level: 2, angle: childAngle, radius });
      edges.push({ x1: dx, y1: dy, x2: x, y2: y, weight: childCount });
    });
  });

  const svg = svgEl('svg', {
    class: 'mindmap',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': t('dash.mindmapAria', { count: nodes.length }),
  });

  // Edges first, so nodes sit on top.
  const edgeLayer = svgEl('g', { class: 'mm-edges' });
  for (const edge of edges) {
    const mx = (edge.x1 + edge.x2) / 2;
    const my = (edge.y1 + edge.y2) / 2;
    // Bow each link slightly away from the centre so siblings stay separable.
    const bow = 0.12;
    const qx = mx + (my - cy) * bow;
    const qy = my - (mx - cx) * bow;
    edgeLayer.append(
      svgEl('path', {
        d: `M ${edge.x1} ${edge.y1} Q ${qx} ${qy} ${edge.x2} ${edge.y2}`,
        class: edge.weight ? 'mm-edge' : 'mm-edge empty',
      })
    );
  }
  svg.append(edgeLayer);

  // Centre
  svg.append(
    svgEl('circle', { cx, cy, r: 34, class: 'mm-hub' }),
    svgEl('text', { x: cx, y: cy + 4, class: 'mm-hub-label', 'text-anchor': 'middle' }, t('app.name').split(' ')[0])
  );

  for (const node of nodes) {
    const radius = nodeRadius(node.count);
    const onRight = node.angle <= 180;
    const labelGap = radius + 8;
    const [lx, ly] = polar(cx, cy, (node.radius ?? (node.level === 1 ? R1 : R2)) + labelGap, node.angle);

    const group = svgEl('g', {
      class: `mm-node level-${node.level}${node.count ? '' : ' empty'}`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${topicName(node.topic)}: ${node.count}`,
      onClick: () => onSelect?.(node.topic.id),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(node.topic.id);
        }
      },
    });

    group.append(
      svgEl('circle', {
        cx: node.x,
        cy: node.y,
        r: radius,
        class: 'mm-dot',
        style: node.topic.color ? `--node-color:${node.topic.color}` : null,
      }),
      node.count ? svgEl('text', { x: node.x, y: node.y + 4, class: 'mm-count', 'text-anchor': 'middle' }, node.count) : null,
      svgEl(
        'text',
        {
          x: lx,
          y: ly + 4,
          class: 'mm-label',
          'text-anchor': onRight ? 'start' : 'end',
        },
        truncate(topicName(node.topic), node.level === 1 ? 26 : 22)
      )
    );
    group.append(svgEl('title', {}, `${topicName(node.topic)} - ${node.count} ${t('common.results')}`));
    svg.append(group);
  }

  return svg;
}

// ==========================================================================
// Connection graph
// ==========================================================================

export function connectionGraph(topics, countsById, links, { onSelect } = {}) {
  const total = (id) => Number(countsById.get(id)?.total_count ?? 0);

  // Only topics that actually hold something can share vocabulary.
  const present = topics.filter((topic) => total(topic.id) > 0);
  if (present.length < 2) return null;

  const byId = new Map(present.map((topic) => [topic.id, topic]));
  const usable = links.filter((link) => byId.has(link.source) && byId.has(link.target));

  const W = 900;
  const H = 700;
  const cx = W / 2;
  const cy = H / 2;
  const R = 268;

  // Heaviest-connected topics first, so strongly linked areas sit together.
  const degree = new Map(present.map((topic) => [topic.id, 0]));
  for (const link of usable) {
    const weight = link.shared + link.relations * 2;
    degree.set(link.source, (degree.get(link.source) ?? 0) + weight);
    degree.set(link.target, (degree.get(link.target) ?? 0) + weight);
  }
  const ordered = [...present].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  const position = new Map();
  ordered.forEach((topic, index) => {
    const angle = (index * 360) / ordered.length;
    const [x, y] = polar(cx, cy, R, angle);
    position.set(topic.id, { x, y, angle });
  });

  const svg = svgEl('svg', {
    class: 'mindmap graph',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': t('dash.graphAria', { nodes: ordered.length, edges: usable.length }),
  });

  const maxWeight = Math.max(1, ...usable.map((link) => link.shared + link.relations * 2));

  const edgeLayer = svgEl('g', { class: 'mm-edges' });
  for (const link of usable) {
    const a = position.get(link.source);
    const b = position.get(link.target);
    const weight = link.shared + link.relations * 2;
    // Pull the curve toward the middle: chords through the centre read as one body.
    const qx = cx + (a.x + b.x - 2 * cx) * 0.18;
    const qy = cy + (a.y + b.y - 2 * cy) * 0.18;
    const path = svgEl('path', {
      d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`,
      class: `mm-chord${link.relations ? ' explicit' : ''}`,
      'stroke-width': (1 + (weight / maxWeight) * 5).toFixed(2),
      'stroke-opacity': (0.2 + (weight / maxWeight) * 0.5).toFixed(2),
    });
    path.append(
      svgEl('title', {}, `${topicName(byId.get(link.source))} ↔ ${topicName(byId.get(link.target))}\n` +
        `${link.shared} ${t('dash.sharedTerms')}${link.terms?.length ? `: ${link.terms.slice(0, 6).join(', ')}` : ''}` +
        (link.relations ? `\n${link.relations} ${t('item.related')}` : ''))
    );
    edgeLayer.append(path);
  }
  svg.append(edgeLayer);

  for (const topic of ordered) {
    const { x, y, angle } = position.get(topic.id);
    const count = total(topic.id);
    const radius = nodeRadius(count);
    const onRight = angle <= 180;
    const [lx, ly] = polar(cx, cy, R + radius + 8, angle);

    const group = svgEl('g', {
      class: 'mm-node level-1',
      tabindex: '0',
      role: 'button',
      'aria-label': `${topicName(topic)}: ${count}`,
      onClick: () => onSelect?.(topic.id),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(topic.id);
        }
      },
    });
    group.append(
      svgEl('circle', { cx: x, cy: y, r: radius, class: 'mm-dot', style: topic.color ? `--node-color:${topic.color}` : null }),
      svgEl('text', { x, y: y + 4, class: 'mm-count', 'text-anchor': 'middle' }, count),
      svgEl('text', { x: lx, y: ly + 4, class: 'mm-label', 'text-anchor': onRight ? 'start' : 'end' }, truncate(topicName(topic), 22))
    );
    svg.append(group);
  }

  return svg;
}
