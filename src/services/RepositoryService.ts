/**
 * Puerto de publicación de alto nivel.
 *
 * La implementación actual conserva su diálogo imperativo y se inyectará desde
 * `main.ts` cuando llegue su corte. El controlador no necesita conocer invoke,
 * fingerprints ni detalles del transporte.
 */
export interface RepositoryService {
  publishDocument(path: string): Promise<void>;
}

export function createRepositoryService(
  publishDocument: (path: string) => Promise<void>,
): RepositoryService {
  return { publishDocument };
}
