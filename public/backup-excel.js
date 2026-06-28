(function () {
  const BACKUP_BUTTON_TEXT = new Set([
    "backup db",
    "download full backup",
    "backup excel",
    "download excel backup",
  ]);
  const ADMIN_SESSION_KEY = "garmentworks_admin_session";
  const EXCEL_CELL_LIMIT = 30000;

  function isAdminPortal() {
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return false;
    try {
      const session = JSON.parse(window.localStorage.getItem(ADMIN_SESSION_KEY) || "null");
      return session?.portal === "admin" || session?.role === "Admin";
    } catch (error) {
      return false;
    }
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeSheetName(name, usedNames) {
    const base = String(name || "Sheet")
      .replace(/[\[\]\*\/\\\?\:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 28) || "Sheet";
    let sheetName = base;
    let index = 2;
    while (usedNames.has(sheetName.toLowerCase())) {
      sheetName = `${base.slice(0, 25)} ${index}`.slice(0, 31);
      index += 1;
    }
    usedNames.add(sheetName.toLowerCase());
    return sheetName;
  }

  function normalizeName(name) {
    return String(name || "Data")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "Data";
  }

  function valueForReport(value) {
    if (value == null) return "";
    if (typeof value === "string" && value.startsWith("data:image/")) {
      return "[image data included in Raw_LocalStorage sheet]";
    }
    if (typeof value === "object") {
      const text = JSON.stringify(value);
      return text.length > 900 ? `${text.slice(0, 900)}...` : text;
    }
    return value;
  }

  function flattenRow(row, prefix = "", output = {}) {
    if (row == null || typeof row !== "object") {
      output[prefix || "value"] = valueForReport(row);
      return output;
    }
    Object.entries(row).forEach(([key, value]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value) && !String(value).startsWith?.("data:image/")) {
        flattenRow(value, nextKey, output);
      } else {
        output[nextKey] = valueForReport(value);
      }
    });
    return output;
  }

  function rowsFromArray(arrayValue) {
    return arrayValue.map((item) => flattenRow(item));
  }

  function addParsedTables(value, prefix, sheets) {
    if (Array.isArray(value)) {
      sheets.push({ name: normalizeName(prefix), rows: rowsFromArray(value) });
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      const childPrefix = prefix ? `${prefix}_${key}` : key;
      if (Array.isArray(child)) {
        sheets.push({ name: normalizeName(childPrefix), rows: rowsFromArray(child) });
      } else if (child && typeof child === "object") {
        addParsedTables(child, childPrefix, sheets);
      }
    });
  }

  function localStorageRows() {
    const rows = [];
    const store = window.localStorage;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      const value = store.getItem(key) || "";
      let parsedType = "string";
      try {
        const parsed = JSON.parse(value);
        parsedType = Array.isArray(parsed) ? "array" : typeof parsed;
      } catch (error) {
        parsedType = "string";
      }
      const chunkCount = Math.max(1, Math.ceil(value.length / EXCEL_CELL_LIMIT));
      for (let chunk = 0; chunk < chunkCount; chunk += 1) {
        rows.push({
          key,
          type: parsedType,
          total_characters: value.length,
          chunk_number: chunk + 1,
          total_chunks: chunkCount,
          chunk_text: value.slice(chunk * EXCEL_CELL_LIMIT, (chunk + 1) * EXCEL_CELL_LIMIT),
        });
      }
    }
    return rows;
  }

  function getAllBackupSheets() {
    const parsedSheets = [];
    const metaRows = [
      { field: "Backup Type", value: "Full Excel Backup" },
      { field: "Created At", value: new Date().toLocaleString() },
      { field: "App URL", value: location.href },
      { field: "LocalStorage Keys", value: window.localStorage.length },
      { field: "Restore Note", value: "Raw_LocalStorage sheet contains complete chunked data for restore/audit." },
    ];

    const store = window.localStorage;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      const value = store.getItem(key) || "";
      try {
        const parsed = JSON.parse(value);
        addParsedTables(parsed, key, parsedSheets);
      } catch (error) {
        // Non-JSON values are still backed up in Raw_LocalStorage.
      }
    }

    return [
      { name: "Backup_Info", rows: metaRows },
      ...parsedSheets.filter((sheet) => sheet.rows.length),
      { name: "Raw_LocalStorage", rows: localStorageRows() },
    ];
  }

  function cellXml(value) {
    const isNumber = typeof value === "number" && Number.isFinite(value);
    return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
  }

  function sheetXml(sheet, usedNames) {
    const rows = sheet.rows || [];
    const columns = Array.from(
      rows.reduce((set, row) => {
        Object.keys(row || {}).forEach((key) => set.add(key));
        return set;
      }, new Set())
    );
    if (!columns.length) columns.push("value");
    const header = `<Row>${columns.map(cellXml).join("")}</Row>`;
    const body = rows
      .map((row) => `<Row>${columns.map((column) => cellXml(row?.[column] ?? "")).join("")}</Row>`)
      .join("");
    return `<Worksheet ss:Name="${xmlEscape(safeSheetName(sheet.name, usedNames))}"><Table>${header}${body}</Table></Worksheet>`;
  }

  function buildExcelXml() {
    const usedNames = new Set();
    const sheets = getAllBackupSheets();
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>GarmentWorks Full Backup</Title>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
 </Styles>
 ${sheets.map((sheet) => sheetXml(sheet, usedNames)).join("")}
</Workbook>`;
  }

  function fileDate() {
    const now = new Date();
    const pad = (number) => String(number).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  }

  function downloadExcelBackup() {
    if (!isAdminPortal()) {
      showBackupToast("Backup sirf admin login ke liye allowed hai");
      return;
    }
    try {
      const xml = buildExcelXml();
      const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `garmentworks-full-backup-${fileDate()}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      showBackupToast("Excel backup download ho gaya");
    } catch (error) {
      console.error("Excel backup failed", error);
      showBackupToast("Excel backup error: data read nahi hua");
    }
  }

  function showBackupToast(message) {
    const oldToast = document.querySelector(".excel-backup-toast");
    if (oldToast) oldToast.remove();
    const toast = document.createElement("div");
    toast.className = "excel-backup-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function isBackupControl(element) {
    const button = element?.closest?.("button,a");
    if (!button) return null;
    const text = (button.innerText || button.textContent || button.title || "").trim().toLowerCase();
    return BACKUP_BUTTON_TEXT.has(text) ? button : null;
  }

  function relabelBackupButtons() {
    if (!isAdminPortal()) return;
    document.querySelectorAll("button,a").forEach((button) => {
      const text = (button.innerText || button.textContent || "").trim().toLowerCase();
      if (text === "backup db") button.textContent = "Backup Excel";
      if (text === "download full backup") button.textContent = "Download Excel Backup";
      if (isBackupControl(button) && button.dataset.excelBackupBound !== "true") {
        button.dataset.excelBackupBound = "true";
        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            downloadExcelBackup();
          },
          true
        );
      }
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!isAdminPortal()) return;
      const button = isBackupControl(event.target);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      downloadExcelBackup();
    },
    true
  );

  const observer = new MutationObserver(relabelBackupButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  relabelBackupButtons();
  window.GarmentWorksExcelBackup = { download: downloadExcelBackup };
})();
