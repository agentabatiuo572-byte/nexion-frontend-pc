(() => {
  const text = (el) => (el?.innerText || el?.textContent || "").trim();
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const controls = () => Array.from(document.querySelectorAll("input, textarea, select")).filter(visible);
  const labelText = (el) => {
    const id = el.getAttribute("id") || "";
    const explicit = id ? text(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : "";
    const wrap = text(el.closest("label"));
    const field = text(el.closest(".field"));
    const parent = text(el.parentElement);
    return [
      explicit,
      wrap,
      field,
      parent,
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      el.getAttribute("name"),
      el.value,
    ].filter(Boolean).join(" ");
  };
  const setNativeValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const fillByLabel = (pattern, value) => {
    const re = new RegExp(pattern, "i");
    const el = controls().find((node) => ["INPUT", "TEXTAREA"].includes(node.tagName) && re.test(labelText(node)));
    if (!el) throw new Error(`field not found: ${pattern}`);
    setNativeValue(el, value);
    return { label: labelText(el).slice(0, 140), value };
  };
  const selectByLabel = (pattern, value) => {
    const re = new RegExp(pattern, "i");
    const el = controls().find((node) => node.tagName === "SELECT" && re.test(labelText(node)));
    if (!el) throw new Error(`select not found: ${pattern}`);
    setNativeValue(el, value);
    return { label: labelText(el).slice(0, 140), value };
  };
  const clickExact = (wanted) => {
    const el = Array.from(document.querySelectorAll("button")).find((button) => text(button) === wanted && visible(button));
    if (!el) throw new Error(`button not found: ${wanted}`);
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return { clicked: wanted };
  };
  const clickInRow = (rowText, buttonText) => {
    const candidates = Array.from(document.querySelectorAll("tr, .rw, .task, .sku-card, .l-card, div"))
      .filter((el) => text(el).includes(rowText) && Array.from(el.querySelectorAll("button")).some((button) => text(button) === buttonText))
      .sort((a, b) => text(a).length - text(b).length);
    const row = candidates[0];
    if (!row) throw new Error(`row not found: ${rowText} / ${buttonText}`);
    const button = Array.from(row.querySelectorAll("button")).find((el) => text(el) === buttonText);
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return { row: rowText, clicked: buttonText };
  };
  const clickRow = (rowText) => {
    const row = Array.from(document.querySelectorAll("tr, .rw, .task, .sku-card"))
      .filter((el) => text(el).includes(rowText))
      .sort((a, b) => text(a).length - text(b).length)[0];
    if (!row) throw new Error(`row not found: ${rowText}`);
    row.scrollIntoView({ block: "center", inline: "center" });
    row.click();
    return { row: rowText };
  };
  const fillReason = (value) => {
    const el = controls().find((node) => node.tagName === "TEXTAREA" && /操作理由/i.test(text(node.closest(".field"))))
      || controls().find((node) => node.tagName === "TEXTAREA" && /操作理由|理由|工单|依据|reason|audit/i.test(labelText(node)));
    if (!el) throw new Error("reason textarea not found");
    setNativeValue(el, value);
    return { reason: value };
  };
  const confirmButton = () => Array.from(document.querySelectorAll("button")).reverse()
    .find((button) => /确认执行|确认创建账号/.test(text(button)) && visible(button));
  const assertConfirmDisabled = () => {
    const button = confirmButton();
    if (!button) throw new Error("confirm button not found");
    if (!button.disabled && button.getAttribute("aria-disabled") !== "true") throw new Error(`confirm button should be disabled: ${text(button)}`);
    return { confirm: text(button), disabled: true };
  };
  const assertConfirmEnabled = () => {
    const button = confirmButton();
    if (!button) throw new Error("confirm button not found");
    if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error(`confirm button disabled: ${text(button)}`);
    return { confirm: text(button), disabled: false };
  };
  const submitConfirm = () => {
    const button = confirmButton();
    if (!button) throw new Error("confirm button not found");
    if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error("confirm button disabled before submit");
    button.click();
    return { submitted: text(button) };
  };
  window.__nexionProof = {
    text,
    visible,
    controls,
    labelText,
    setNativeValue,
    fillByLabel,
    selectByLabel,
    clickExact,
    clickInRow,
    clickRow,
    fillReason,
    assertConfirmDisabled,
    assertConfirmEnabled,
    submitConfirm,
    bodyText: () => document.body.innerText,
    persisted: () => JSON.parse(localStorage.getItem("nexion-admin-platform-v1") || '{"state":{}}').state || {},
  };
})();
