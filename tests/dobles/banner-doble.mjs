// Doble de `src/js/ui/degraded-banner.js`: en Node no hay DOM. Cuenta las veces
// que se pidió el cartel, por si un test quiere mirarlo.
export function mostrarBannerDegradadoVista() {
  globalThis.__BANNER = (globalThis.__BANNER || 0) + 1;
}
