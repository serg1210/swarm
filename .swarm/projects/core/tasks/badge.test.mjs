import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeSvg } from '../../../../src/badge.mjs';

const width = (svg) => Number(/^<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);

test('counts, title and accessible label', () => {
  const svg = badgeSvg({ tasks: 12, workers: 3 });
  assert.match(svg, /^<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /^<svg[^>]*\srole="img"/);
  assert.match(svg, /^<svg[^>]*\saria-label="swarm: 12 tasks, 3 workers"/);
  assert.match(svg, /<title>swarm: 12 tasks, 3 workers<\/title>/);
  assert.match(svg, /<text[^>]*>swarm<\/text>/);
  assert.match(svg, /<text[^>]*>12 tasks, 3 workers<\/text>/);
  assert.ok(width(svg) > 0);
  assert.match(svg.trim(), /<\/svg>$/);
});

test('singular forms', () => {
  assert.match(badgeSvg({ tasks: 1, workers: 1 }), /<text[^>]*>1 task, 1 worker<\/text>/);
  assert.match(badgeSvg({ tasks: 0, workers: 0 }), /<text[^>]*>0 tasks, 0 workers<\/text>/);
});

test('a longer message makes a wider badge', () => {
  assert.ok(width(badgeSvg({ tasks: 1234567, workers: 1 })) > width(badgeSvg({ tasks: 1, workers: 1 })));
});

test('the label is escaped and nothing external is loaded', () => {
  const svg = badgeSvg({ label: 'a<b&"c">', tasks: 2, workers: 2 });
  assert.ok(!svg.includes('a<b'));
  assert.ok(svg.includes('a&lt;b&amp;'));
  assert.match(svg, /^<svg[^>]*\saria-label="a&lt;b&amp;&quot;c&quot;&gt;: 2 tasks, 2 workers"/);
  assert.ok(!/<script|<image|<foreignObject|href=|url\(/i.test(svg));
});

test('counts must be non-negative integers', () => {
  for (const bad of [-1, 1.5, '3', null, undefined, NaN]) {
    assert.throws(() => badgeSvg({ tasks: bad, workers: 1 }), TypeError);
    assert.throws(() => badgeSvg({ tasks: 1, workers: bad }), TypeError);
  }
});
