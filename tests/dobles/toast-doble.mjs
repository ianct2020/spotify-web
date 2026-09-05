// Doble de `ui/toast.js`: en vez de pintar, apunta. Los avisos son parte de lo
// que se prueba —la regla es que nada quede en silencio—, así que el test los
// mira igual que mira las escrituras.
export function showToast(message, type = 'info') {
  globalThis.__DOBLE.toasts.push({ message, type });
}
