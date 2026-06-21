function ensureContainer() {
  let c = document.querySelector('.toast-container');
  if (!c) {
    c = document.createElement('div');
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  text.style.flex = '1';
  toast.appendChild(text);

  const dismiss = () => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  };

  if (type === 'error') {
    toast.style.cursor = 'pointer';
    toast.style.userSelect = 'text';
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'margin-left:12px;font-size:18px;cursor:pointer;opacity:0.8';
    closeBtn.onclick = dismiss;
    toast.appendChild(closeBtn);
  } else {
    setTimeout(dismiss, duration);
  }

  container.appendChild(toast);
}

export { showToast };
