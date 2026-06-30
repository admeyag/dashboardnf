// Lightweight CSV parser + NF data utilities
export type NFRow = {
  warehouse_id: string;
  item_code: string;
  product_sku: string;
  rack_name: string;
  bin_name: string;
  status: string;
  username: string;
  picklist_id: string;
  remark: string; // cleaned
  date: Date;
  source: "raw" | "true" | "false";
};

const RAW_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQxepi2PWJaJSrTSxtkZnR9ZwGozn5VPPy6jFTkDtny-pt-71JaT49g1GYf9Iw4GM_VsHa82PiXizQm/pub?gid=1332096635&single=true&output=csv";
const TRUE_NF_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQxepi2PWJaJSrTSxtkZnR9ZwGozn5VPPy6jFTkDtny-pt-71JaT49g1GYf9Iw4GM_VsHa82PiXizQm/pub?gid=936706140&single=true&output=csv";
const FALSE_NF_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQxepi2PWJaJSrTSxtkZnR9ZwGozn5VPPy6jFTkDtny-pt-71JaT49g1GYf9Iw4GM_VsHa82PiXizQm/pub?gid=592980095&single=true&output=csv";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
        // skip
      } else cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// "02-May-2026 04:17 AM"
function parseRawNFDate(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})-(\w{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, d, mon, y, hh, mm, ap] = m;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === mon.toLowerCase());
  if (mi < 0) return null;
  let h = parseInt(hh, 10) % 12;
  if (ap.toUpperCase() === "PM") h += 12;
  return new Date(parseInt(y, 10), mi, parseInt(d, 10), h, parseInt(mm, 10));
}

// "2-5-2026, 4:11 AM"  (D-M-YYYY)
function parseSheetNFDate(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (ap.toUpperCase() === "PM") h += 12;
  return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), h, parseInt(mm, 10));
}

export function normalizeRemark(r: string): string {
  const s = (r || "").trim().toLowerCase();
  if (!s) return "Unspecified";
  if (s.includes("false")) return "False NF";
  if (s.includes("actual")) return "True NF";
  if (s.includes("true")) return "True NF";
  if (s.includes("inv team") || s.includes("inventory team")) return "Inventory Team Recovery";
  if (s.includes("refill")) return "Refilling Issue";
  if (s.includes("misplace")) return "Misplace SKU - Correction Done";
  if (s.includes("out of system") || s.includes("out by system")) return "Out By System";
  if (s.includes("re-rack") || s.includes("rerack") || s.includes("re rack")) return "Re-Racking";
  if (s.includes("bin missing")) return "Bin Missing";
  if (s.includes("damage")) return "Damage";
  return r.trim();
}

function colIdx(header: string[], ...names: string[]): number {
  for (const n of names) {
    const i = header.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function parseRawCSV(text: string, source: NFRow["source"] = "raw"): NFRow[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const i = {
    wh: colIdx(header, "warehouse_id"),
    item: colIdx(header, "item_code"),
    sku: colIdx(header, "product_sku"),
    rack: colIdx(header, "rack_name"),
    bin: colIdx(header, "bin_name"),
    status: colIdx(header, "status"),
    user: colIdx(header, "username"),
    pick: colIdx(header, "picklist_id"),
    remarkClean: colIdx(header, "Remark (Clean)"),
    remark: colIdx(header, "Remark"),
    dt: colIdx(header, "nf_time", "NF DateTime", "NF Time"),
    dtAlt: colIdx(header, "NF DateTime"),
  };
  const out: NFRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;
    const itemCode = (row[i.item] || "").trim();
    if (!itemCode) continue; // skip blank/formula-only rows
    const rawDt = (row[i.dt] || "") || (i.dtAlt >= 0 ? row[i.dtAlt] : "");
    const d = parseSheetNFDate(rawDt) || parseRawNFDate(rawDt);
    if (!d) continue;
    const remarkRaw =
      (i.remarkClean >= 0 ? row[i.remarkClean] : "") || (i.remark >= 0 ? row[i.remark] : "");
    out.push({
      warehouse_id: row[i.wh] || "",
      item_code: row[i.item] || "",
      product_sku: row[i.sku] || "",
      rack_name: row[i.rack] || "",
      bin_name: row[i.bin] || "",
      status: row[i.status] || "",
      username: (row[i.user] || "").trim(),
      picklist_id: row[i.pick] || "",
      remark: normalizeRemark(remarkRaw),
      date: d,
      source,
    });
  }
  return out;
}

function parseSheetCSV(text: string, forcedRemark: string, source: NFRow["source"]): NFRow[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const i = {
    wh: colIdx(header, "warehouse_id"),
    item: colIdx(header, "item_code"),
    sku: colIdx(header, "product_sku"),
    rack: colIdx(header, "rack_name"),
    bin: colIdx(header, "bin_name"),
    status: colIdx(header, "status"),
    user: colIdx(header, "username"),
    pick: colIdx(header, "picklist_id"),
    dt: colIdx(header, "nf_time", "NF DateTime", "NF Time"),
  };
  const out: NFRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;
    const itemCode = (row[i.item] || "").trim();
    if (!itemCode) continue;
    const rawDt = row[i.dt] || "";
    // Keep rows even when date is unparseable (Sheets ######## overflow);
    // sentinel epoch-0 means "undated" — date filter & trend skip these.
    const d = parseSheetNFDate(rawDt) || parseRawNFDate(rawDt) || new Date(0);
    out.push({
      warehouse_id: row[i.wh] || "",
      item_code: itemCode,
      product_sku: row[i.sku] || "",
      rack_name: row[i.rack] || "",
      bin_name: row[i.bin] || "",
      status: row[i.status] || "",
      username: (row[i.user] || "").trim(),
      picklist_id: row[i.pick] || "",
      remark: forcedRemark,
      date: d,
      source,
    });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function loadNFData(): Promise<NFRow[]> {
  // All three buckets come from the published Google Sheet tabs.
  // Raw Data drives the "Total NF Logged" count and detail rows;
  // True NF / False NF drive their respective counters.
  const [rawText, trueText, falseText] = await Promise.all([
    fetchText(RAW_URL).catch(() => ""),
    fetchText(TRUE_NF_URL).catch(() => ""),
    fetchText(FALSE_NF_URL).catch(() => ""),
  ]);

  const rawRows = parseRawCSV(rawText, "raw");
  const trueRowsAll = parseSheetCSV(trueText, "True NF", "true");
  // Dedupe True NF by item_code — keep first occurrence only.
  const seen = new Set<string>();
  const trueRows: NFRow[] = [];
  for (const r of trueRowsAll) {
    const k = (r.item_code || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    trueRows.push(r);
  }
  const falseRows = parseSheetCSV(falseText, "False NF", "false");

  return [...rawRows, ...trueRows, ...falseRows].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );

}

export const REMARK_COLORS: Record<string, string> = {
  "False NF": "var(--chart-4)",
  "True NF": "var(--chart-2)",
  "Inventory Team Recovery": "var(--chart-1)",
  "Refilling Issue": "var(--chart-3)",
  "Misplace SKU - Correction Done": "var(--chart-5)",
  "Out By System": "var(--chart-1)",
  "Re-Racking": "var(--chart-3)",
  "Bin Missing": "var(--chart-4)",
  "Damage": "var(--chart-4)",
  "Unspecified": "var(--muted-foreground)",
};

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Group rack_name into a coarse "location bucket" for impact charts.
export function rackBucket(rack: string): string {
  const s = (rack || "").toUpperCase().trim();
  if (!s) return "Other";
  if (s.startsWith("HDR-A")) return "HDR-A";
  if (s.startsWith("HDR-B")) return "HDR-B";
  if (s.startsWith("HDR-C")) return "HDR-C";
  if (s.startsWith("HDR")) return "HDR-Other";
  if (s.startsWith("PLT") || s.includes("PALLET") || s.includes("PALETTE")) return "Palette Level";
  if (s.startsWith("Z0") || s.startsWith("Z1") || s.startsWith("Z2")) return "Zone " + s.slice(0, 2);
  return "Other";
}

// Severity bucket from rack — used in "Impact Location" overview chart.
export function severityBucket(rack: string): "High" | "Medium" | "Low" | "Very Low" {
  const b = rackBucket(rack);
  if (b === "HDR-A" || b === "HDR-B") return "High";
  if (b === "HDR-C" || b === "HDR-Other") return "Medium";
  if (b === "Palette Level") return "Low";
  return "Very Low";
}

