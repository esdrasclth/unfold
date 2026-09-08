import assert from "node:assert/strict";
import { takeWelcome, WELCOME } from "../src/welcome.ts";

function memoryStorage(initial = new Map()) {
  const values = new Map(initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const firstInstall = memoryStorage();
assert.equal(takeWelcome(firstInstall), WELCOME, "la primera instalación muestra la bienvenida");
assert.equal(takeWelcome(firstInstall), "", "la misma versión no vuelve a mostrarla");

const previousVersion = memoryStorage(new Map([["unfold:bienvenida-vista", "0.0.9"]]));
assert.equal(takeWelcome(previousVersion), WELCOME, "una actualización vuelve a mostrarla");
assert.match(WELCOME, /Novedades de la versión \d+\.\d+\.\d+/);

console.log("4 de 4 pruebas de bienvenida correctas");
