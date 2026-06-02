const MOBILE_SELECT_MAX_WIDTH = 820;

let isInstalled = false;
let activeBackdrop: HTMLDivElement | null = null;

const isMobileSelectViewport = () => {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth <= MOBILE_SELECT_MAX_WIDTH ||
    window.matchMedia?.("(pointer: coarse)").matches
  );
};

const closeMobileSelect = () => {
  activeBackdrop?.remove();
  activeBackdrop = null;
};

const getSelectTitle = (select: HTMLSelectElement) => {
  const explicitLabel =
    select.getAttribute("aria-label") || select.getAttribute("title");
  if (explicitLabel) return explicitLabel;

  const id = select.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  const row = select.closest(".setting-dialog-new-title, li, div");
  const text = row?.textContent?.replace(select.textContent || "", "").trim();
  return text || "请选择";
};

const commitSelectValue = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const openMobileSelect = (select: HTMLSelectElement) => {
  closeMobileSelect();

  const backdrop = document.createElement("div");
  backdrop.className = "mobile-select-backdrop";
  backdrop.addEventListener("click", closeMobileSelect);

  const sheet = document.createElement("div");
  sheet.className = "mobile-select-sheet";
  sheet.setAttribute("role", "listbox");
  sheet.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "mobile-select-header";

  const title = document.createElement("div");
  title.className = "mobile-select-title";
  title.textContent = getSelectTitle(select);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "mobile-select-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", closeMobileSelect);

  header.append(title, closeButton);
  sheet.appendChild(header);

  const list = document.createElement("div");
  list.className = "mobile-select-options";

  Array.from(select.options).forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className =
      "mobile-select-option" +
      (option.value === select.value ? " mobile-select-option-active" : "");
    item.disabled = option.disabled;
    item.textContent = option.textContent || option.value;
    item.setAttribute("role", "option");
    item.setAttribute(
      "aria-selected",
      option.value === select.value ? "true" : "false"
    );
    item.addEventListener("click", () => {
      commitSelectValue(select, option.value);
      closeMobileSelect();
    });
    list.appendChild(item);
  });

  sheet.appendChild(list);
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;
};

const findSelect = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  const select = target.closest("select");
  if (!(select instanceof HTMLSelectElement)) return null;
  if (select.disabled || select.multiple) return null;
  return select;
};

const handleSelectPointer = (event: Event) => {
  if (!isMobileSelectViewport()) return;
  const select = findSelect(event.target);
  if (!select) return;

  event.preventDefault();
  event.stopPropagation();
  openMobileSelect(select);
};

const handleSelectClick = (event: Event) => {
  if (!isMobileSelectViewport()) return;
  const select = findSelect(event.target);
  if (!select) return;

  event.preventDefault();
  event.stopPropagation();
};

export const installMobileSelectEnhancer = () => {
  if (isInstalled || typeof document === "undefined") return;
  isInstalled = true;

  document.addEventListener("pointerdown", handleSelectPointer, true);
  document.addEventListener("click", handleSelectClick, true);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeMobileSelect();
    },
    true
  );
};
