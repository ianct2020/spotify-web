// Marquee: activa el scroll horizontal en loop para elementos cuyo contenido
// no entra en el ancho visible. Se usa envolviendo el texto en:
//   <span class="marquee-wrap"><span class="marquee-text">Título largo</span></span>
// y llamando activateMarquee(container) después de renderizar.
// Solo agrega la clase .marquee (y por ende la animación) si scrollWidth > clientWidth.

export function activateMarquee(root) {
  const scope = root || document;
  scope.querySelectorAll('.marquee-wrap').forEach(wrap => {
    const text = wrap.querySelector('.marquee-text');
    if (!text) return;
    // Medimos dos veces con requestAnimationFrame para asegurar layout listo
    requestAnimationFrame(() => {
      const overflows = text.scrollWidth > wrap.clientWidth + 2;
      if (overflows) {
        wrap.classList.add('marquee');
        // Le decimos al keyframe cuánto es el "100% del container" en px
        wrap.style.setProperty('--marquee-container', wrap.clientWidth + 'px');
      } else {
        wrap.classList.remove('marquee');
      }
    });
  });
}

// Wrappea un texto plano dado el string
export function marqueeSpan(text, extraClass = '') {
  return `<span class="marquee-wrap ${extraClass}"><span class="marquee-text">${text}</span></span>`;
}
