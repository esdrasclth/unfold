import { render } from "preact";

function ExperimentalMount() {
  return <span data-preact-experimental="true">Preact listo</span>;
}

const root = document.querySelector<HTMLElement>("#preact-experiment");
if (root) render(<ExperimentalMount />, root);
