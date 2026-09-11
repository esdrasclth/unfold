import { bootstrap } from "./app/runtime.ts";
import "./styles/app.css";
import "./styles/markdown.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontró el punto de montaje de Unfold");

void bootstrap(app)
  .catch((error) => {
    console.error("No se pudo iniciar Unfold", error);
  })
  .finally(() => {
    // Sólo mostramos la aplicación cuando el primer estado (incluida la
    // restauración de sesión) ya está listo, evitando el parpadeo inicial.
    app.dataset.ready = "true";
  });
