import assert from "node:assert/strict";
import { clearSession, loadSession, saveSession } from "../src/session.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const storage = memoryStorage();
const snapshot = {
  active: 1,
  tabs: [
    {
      path: null,
      name: "Notas",
      dirty: true,
      content: "# Borrador",
      anchor: 2,
      head: 2,
      scrollTop: 18,
    },
  ],
};

saveSession(snapshot, storage);
assert.deepEqual(loadSession(storage), { ...snapshot, version: 1 });
clearSession(storage);
assert.equal(loadSession(storage), null);

storage.setItem("unfold:session", JSON.stringify({ version: 99, tabs: [] }));
assert.equal(loadSession(storage), null, "se ignoran formatos de sesión desconocidos");
console.log("4 de 4 pruebas de sesión correctas");
