export function qs<T extends Element>(root: ParentNode, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: { id?: string; className?: string; text?: string },
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts?.id) el.id = opts.id;
  if (opts?.className) el.className = opts.className;
  if (opts?.text !== undefined) el.textContent = opts.text;
  return el;
}

export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function createButton(
  label: string,
  onClick: () => void,
  opts?: { id?: string; className?: string; disabled?: boolean },
): HTMLButtonElement {
  const btn = createEl("button", { id: opts?.id, className: opts?.className, text: label });
  btn.disabled = !!opts?.disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

export function createSelect(
  options: Array<{ value: string; label: string }>,
  opts?: { id?: string; value?: string },
): HTMLSelectElement {
  const sel = createEl("select", { id: opts?.id }) as HTMLSelectElement;
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    sel.appendChild(option);
  }
  if (opts?.value !== undefined) sel.value = opts.value;
  return sel;
}

export function createInput(
  placeholder: string,
  opts?: { id?: string; value?: string; maxLength?: number },
): HTMLInputElement {
  const inp = createEl("input", { id: opts?.id }) as HTMLInputElement;
  inp.placeholder = placeholder;
  if (opts?.value !== undefined) inp.value = opts.value;
  if (opts?.maxLength !== undefined) inp.maxLength = opts.maxLength;
  return inp;
}

export function createSwatch(color: string): HTMLSpanElement {
  const s = createEl("span", { className: "swatch" });
  s.style.background = color;
  s.style.display = "inline-block";
  s.style.width = "12px";
  s.style.height = "12px";
  s.style.border = "1px solid #333";
  s.style.verticalAlign = "middle";
  return s;
}
