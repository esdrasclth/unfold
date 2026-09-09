import assert from 'node:assert/strict';
globalThis.window = {};
const {openFile, pathIsInside, saveFile, saveFileAs} = await import('../src/files.ts');
function handle(name, id) {
  const writes = [];
  return { name, id, writes, getFile: async () => ({text: async () => id}),
    isSameEntry: async other => other.id === id,
    createWritable: async () => ({write: async content => writes.push(content), close: async () => {}}) };
}
const first = handle('notas.md', 'one');
const second = handle('notas.md', 'two');
window.showOpenFilePicker = async () => [first];
const a = await openFile();
window.showOpenFilePicker = async () => [second];
const b = await openFile();
assert.notEqual(a.path, b.path);
await saveFile(a.path, 'first changed');
await saveFile(b.path, 'second changed');
assert.deepEqual(first.writes, ['first changed']);
assert.deepEqual(second.writes, ['second changed']);
window.showOpenFilePicker = async () => [first];
assert.equal((await openFile()).path, a.path);
const fresh = handle('nuevo.md', 'three');
window.showSaveFilePicker = async () => fresh;
const target = await saveFile(null, 'draft');
assert.ok(target);
assert.deepEqual(fresh.writes, ['draft']);
assert.deepEqual(second.writes, ['second changed']);
window.showSaveFilePicker = async () => { throw new DOMException('cancel', 'AbortError'); };
assert.equal(await saveFileAs('cancelled'), null);
window.showOpenFilePicker = window.showSaveFilePicker;
assert.equal(await openFile(), null);
window.showSaveFilePicker = async () => { throw new Error('permission denied'); };
await assert.rejects(saveFileAs('failed'), /permission denied/);
assert.equal(pathIsInside('C:\\repos\\notas', 'C:\\repos\\notas\\docs\\nueva.md'), true);
assert.equal(pathIsInside('C:\\repos\\notas', 'c:\\REPOS\\NOTAS\\nueva.md'), true);
assert.equal(pathIsInside('C:\\repos\\notas', 'C:\\repos\\notas-privadas\\nueva.md'), false);
assert.equal(pathIsInside('C:\\repos\\notas', 'C:\\repos\\notas\\..\\fuera.md'), false);
assert.equal(pathIsInside('/repos/notas', '/repos/notas/docs/nueva.md'), true);
assert.equal(pathIsInside('/repos/notas', '/repos/otras/nueva.md'), false);
console.log('16 de 16 pruebas de archivos correctas');
