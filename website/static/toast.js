(function () {
  const ICONS = { success: "✓", error: "!", warning: "!", info: "i" };

  function ensureContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      document.body.appendChild(c);
    }
    return c;
  }

  function show(message, options) {
    const opts = options || {};
    const type = opts.type || "info";
    const duration = typeof opts.duration === "number" ? opts.duration : 4500;

    const container = ensureContainer();
    const el = document.createElement("div");
    el.className = "toast-item toast-" + type;
    el.setAttribute("role", type === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = ICONS[type] || "i";

    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = String(message == null ? "" : message);

    const close = document.createElement("button");
    close.className = "toast-close";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = "&times;";

    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(close);
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    let timeoutId = null;
    const dismiss = () => {
      if (timeoutId) clearTimeout(timeoutId);
      el.classList.remove("show");
      el.classList.add("hide");
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    };

    close.addEventListener("click", dismiss);
    if (duration > 0) timeoutId = setTimeout(dismiss, duration);

    return { dismiss };
  }

  window.showToast = show;
  window.toast = {
    success: (m, o) => show(m, Object.assign({ type: "success" }, o || {})),
    error: (m, o) => show(m, Object.assign({ type: "error" }, o || {})),
    warning: (m, o) => show(m, Object.assign({ type: "warning" }, o || {})),
    info: (m, o) => show(m, Object.assign({ type: "info" }, o || {})),
  };
})();
