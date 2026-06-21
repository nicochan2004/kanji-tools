(() => {
  const PAGE_W_MM = 210;
  const PAGE_H_MM = 297;

  const DEFAULTS = { cols: 6, rows: 9, marginX: 15, marginY: 14, cross: true };

  const colsInput = document.getElementById("colsInput");
  const rowsInput = document.getElementById("rowsInput");
  const marginXInput = document.getElementById("marginXInput");
  const marginYInput = document.getElementById("marginYInput");
  const crossCheck = document.getElementById("crossCheck");
  const printBtn = document.getElementById("printBtn");
  const resetBtn = document.getElementById("resetBtn");
  const previewEl = document.getElementById("preview");

  function clamp(n, min, max) {
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function readSettings() {
    return {
      cols: clamp(parseInt(colsInput.value, 10), 1, 20),
      rows: clamp(parseInt(rowsInput.value, 10), 1, 20),
      marginX: clamp(parseFloat(marginXInput.value), 0, 50),
      marginY: clamp(parseFloat(marginYInput.value), 0, 50),
      cross: crossCheck.checked,
    };
  }

  function buildPage(settings) {
    const availW = PAGE_W_MM - settings.marginX * 2;
    const availH = PAGE_H_MM - settings.marginY * 2;
    const cellSize = Math.min(availW / settings.cols, availH / settings.rows);

    const page = document.createElement("div");
    page.className = "sheet-page";

    const grid = document.createElement("div");
    grid.className = "grid-sheet";
    grid.style.gridTemplateColumns = `repeat(${settings.cols}, ${cellSize}mm)`;
    grid.style.gridTemplateRows = `repeat(${settings.rows}, ${cellSize}mm)`;

    for (let i = 0; i < settings.cols * settings.rows; i++) {
      const cell = document.createElement("div");
      cell.className = settings.cross ? "grid-cell cross" : "grid-cell";
      grid.appendChild(cell);
    }

    page.appendChild(grid);
    return page;
  }

  function render() {
    const settings = readSettings();
    previewEl.innerHTML = "";
    previewEl.appendChild(buildPage(settings));
  }

  let debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 150);
  }

  [colsInput, rowsInput, marginXInput, marginYInput, crossCheck].forEach((el) => {
    el.addEventListener("input", scheduleRender);
  });

  printBtn.addEventListener("click", () => window.print());

  resetBtn.addEventListener("click", () => {
    colsInput.value = DEFAULTS.cols;
    rowsInput.value = DEFAULTS.rows;
    marginXInput.value = DEFAULTS.marginX;
    marginYInput.value = DEFAULTS.marginY;
    crossCheck.checked = DEFAULTS.cross;
    render();
  });

  render();
})();
