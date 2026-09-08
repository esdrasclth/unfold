import assert from 'node:assert/strict';
globalThis.window = {};
const {FileWatcher} = await import('../src/watcher.ts');
const callbacks = new Map();
const stopped = [];
const events = [];
let disk = 'same';
let read = async () => disk;
let current = 'same';
const watcher = new FileWatcher({currentContent: () => current, isDirty: () => true,
 onReload: value => events.push(['reload', value]), onConflict: value => events.push(['conflict', value]),
 onRemoved: () => events.push(['removed'])},
 {enabled: true, read: path => read(path), watch: async (path, callback) => {
 callbacks.set(path, callback); return () => stopped.push(path);
 }});
const flush = () => new Promise(resolve => setImmediate(resolve));
await watcher.watch('a');
assert.deepEqual(events, []);
watcher.noteSelfWrite('self');
disk = 'self'; callbacks.get('a')(); await flush();
assert.deepEqual(events, []);
disk = 'external'; callbacks.get('a')(); await flush();
assert.deepEqual(events, [['conflict', 'external']]);
events.length = 0;
let finish;
read = () => new Promise(resolve => {finish = resolve;});
callbacks.get('a')();
read = async () => 'same';
await watcher.watch('b');
finish('stale'); await flush();
assert.deepEqual(events, []);
assert.deepEqual(stopped, ['a']);
callbacks.get('a')(); await flush();
assert.deepEqual(events, []);
watcher.close();
assert.deepEqual(stopped, ['a', 'b']);
let resolveWatch;
let staleStopped = false;
const slow = new FileWatcher({currentContent: () => '', isDirty: () => false,
 onReload: () => assert.fail('stale reload'), onConflict: () => {}, onRemoved: () => {}},
 {enabled: true, read: async () => '', watch: () => new Promise(resolve => {resolveWatch = resolve;})});
const waiting = slow.watch('slow');
slow.close();
resolveWatch(() => {staleStopped = true;});
await waiting;
assert.equal(staleStopped, true);
console.log('8 de 8 pruebas de vigilancia correctas');
