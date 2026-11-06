const test = require('node:test'), assert = require('node:assert/strict');
const {sections, matchingTopics} = require('./library-core.js').notes;

test('theme reading preserves overlapping references and exposes every ungrouped note', () => {
  const summary = {topics: [{title:'A'}, {title:'B'}, {title:'C'}, {title:'D'}], groups: [
    {title:'One', detail:'Original explanation', topic_indices:[1,0,1,-1,4,'2',null]},
    {title:'Two', topic_indices:[1,2]}
  ]};
  const before = structuredClone(summary), groups = sections(summary);
  assert.deepEqual(groups.map(g => g.indices), [[1,0],[1,2],[3]]);
  assert.equal(groups[0].detail, 'Original explanation');
  assert.equal(groups[2].kind, 'ungrouped');
  assert.deepEqual([...new Set(groups.flatMap(g => g.indices))].sort(), [0,1,2,3]);
  assert.deepEqual(summary, before);
});

test('legacy notes use explicit chapter names without inventing semantic connections', () => {
  const groups = sections({topics: [
    {title:'wait', chapter:'Synchronization'}, {title:'wait'},
    {title:'notify', chapter:'Synchronization'}, {title:'wait', chapter:'Scheduling'}
  ]});
  assert.deepEqual(groups.map(g => [g.kind,g.indices]), [['chapter',[0,2]],['chapter',[3]],['ungrouped',[1]]]);
  assert.equal(groups[0].detail, '');
  assert.deepEqual(sections({topics:[{title:'A'},{title:'B'}]})[0].indices, [0,1]);
});

test('missing, empty or malformed grouping never hides available notes or invents references', () => {
  assert.deepEqual(sections(), []);
  assert.deepEqual(sections({topics:[],groups:null}), []);
  const groups = sections({topics:[{title:'A'}],groups:[null,{title:' '},{title:'Overview',detail:'Saved text',topic_indices:[999]}]});
  assert.equal(groups[0].detail, 'Saved text');
  assert.deepEqual(groups[0].indices, []);
  assert.deepEqual(groups[1].indices, [0]);
});

test('search finds body text and bilingual names while returning original topic indexes', () => {
  const topics = [{title:'互斥锁',detail:'Mutex prevents concurrent updates'},null,{title:'等待',chapter:'同步',detail:'Check the condition with WHILE; x <= 1.'}];
  assert.deepEqual(matchingTopics(topics,'  condition while  '), [2]);
  assert.deepEqual(matchingTopics(topics,'mutex'), [0]);
  assert.deepEqual(matchingTopics(topics,'同步'), [2]);
  assert.deepEqual(matchingTopics(topics,'<='), [2]);
  assert.deepEqual(matchingTopics(topics,'unavailable'), []);
  assert.deepEqual(matchingTopics(topics,''), [0,2]);
});
