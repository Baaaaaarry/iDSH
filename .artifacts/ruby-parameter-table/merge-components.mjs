import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-full-parameter-table.xlsx";
const output = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-full-parameter-table-merged.xlsx";
const previewPath = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/chi-consolidated-preview.png";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const specs = [
  { sheet: "l1d", label: "L1D", header: 0, node: 0, param: 1, value: 2, corrected: 3, desc: 4 },
  { sheet: "l1i", label: "L1I", header: 0, node: 0, param: 1, value: 2, corrected: 3, desc: 4 },
  { sheet: "l2", label: "L2", header: 2, node: 0, param: 1, value: 2, corrected: 3, desc: 4 },
  { sheet: "l3", label: "L3 / HNF", header: 0, node: 0, param: 1, value: 2, desc: 3 },
  { sheet: "io_rni", label: "RNI", header: 2, node: 0, param: 1, value: 2, desc: 3 },
  { sheet: "snf", label: "SNF", header: 0, node: 0, param: 1, value: 2, desc: 3 },
  { sheet: "network", label: "Network", header: 0, node: 0, param: 1, value: 2, desc: 3 },
];

const blank = value => value === null || value === undefined || value === "";
const display = value => {
  if (blank(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function categoryFor(nodeRaw, paramRaw) {
  const node = String(nodeRaw ?? "").toLowerCase();
  const param = String(paramRaw ?? "").toLowerCase();
  if (/\.replacement_policy(?:\.|$)|replacement_policy/.test(node) || /replacement_policy/.test(param)) return "替换策略";
  if (/\.prefetcher(?:\.|$)/.test(node) || /prefetch/.test(node)) return "预取器";
  if (/\.sequencer(?:\.|$)/.test(node) || /sequencer/.test(node)) return "Sequencer";
  if (/\.power_state(?:\.|$)/.test(node) || /power_state/.test(param)) return "电源状态";
  if (/clock_domain|voltage_domain|clk_domain/.test(node) || /clk_domain|clock|voltage/.test(param)) return "时钟与电压";
  if (/\.routers?(?:\.|$)/.test(node) || /router/.test(node)) return "路由器";
  if (/\.netifs?(?:\.|$)|network_interface/.test(node)) return "网络接口";
  if (/\.ext_links?(?:\.|$)|\.int_links?(?:\.|$)|network_links?|credit_links?|\.links?(?:\.|$)/.test(node)) return "网络链路";
  if (/\.network(?:\.|$)/.test(node) && !/queue|buffer/.test(node)) return "网络全局";
  if (/mandatoryqueue|triggerqueue|retrytriggerqueue|repltriggerqueue|prefetchqueue|requesttomemory|responsefrommemory|reqin|reqout|reqrdy|rspin|rspout|snpin|snpout|snprdy|datin|datout|messagebuffer|queue/.test(node)) return "消息缓冲与队列";
  if (/\.cache(?:\.|$)|cachememory|cache_memory/.test(node)) return "缓存存储体";
  if (/\.cntrl(?:\.|$)|controller/.test(node) || /(?:^|\.)(l1d|l1i|l2)$/.test(node)) return "控制器";
  return "其他";
}

const merged = new Map();
let sourceEntries = 0;
for (const spec of specs) {
  const values = workbook.worksheets.getItem(spec.sheet).getUsedRange().values;
  for (let rowIndex = spec.header + 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex] ?? [];
    const node = display(row[spec.node]).trim();
    const param = display(row[spec.param]).trim();
    if (!param) continue;
    sourceEntries++;
    const chosen = spec.corrected !== undefined && !blank(row[spec.corrected]) ? row[spec.corrected] : row[spec.value];
    const value = display(chosen);
    const description = display(row[spec.desc]).trim();
    const category = categoryFor(node, param);
    const key = `${category}\u0000${param}`;
    if (!merged.has(key)) {
      merged.set(key, {
        category, param,
        descriptions: new Set(),
        components: new Map(specs.map(s => [s.label, { values: new Set(), nodes: new Set(), count: 0 }])),
      });
    }
    const item = merged.get(key);
    if (description) item.descriptions.add(description);
    const component = item.components.get(spec.label);
    if (value !== "") component.values.add(value);
    if (node) component.nodes.add(node);
    component.count++;
  }
}

const categoryOrder = ["控制器", "缓存存储体", "消息缓冲与队列", "Sequencer", "预取器", "替换策略", "网络全局", "路由器", "网络链路", "网络接口", "时钟与电压", "电源状态", "其他"];
const ordered = [...merged.values()].sort((a, b) => {
  const ca = categoryOrder.indexOf(a.category), cb = categoryOrder.indexOf(b.category);
  return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb) || a.param.localeCompare(b.param, "en");
});

const rows = ordered.map(item => {
  const present = specs.filter(s => item.components.get(s.label).count > 0);
  const valueSets = present.map(s => [...item.components.get(s.label).values].sort().join(" | "));
  const nonblankValues = valueSets.filter(Boolean);
  const valueState = present.length < 2 ? "单组件" : new Set(nonblankValues).size <= 1 ? "相同" : "不同";
  const nodeText = present.map(s => {
    const nodes = [...item.components.get(s.label).nodes].sort();
    return `${s.label}: ${nodes.join(" | ")}`;
  }).join("；");
  const note = present.length >= 2
    ? (valueState === "不同" ? "跨组件公共参数，当前值存在差异" : "跨组件公共参数")
    : "组件专属参数";
  return [
    item.category,
    item.param,
    [...item.descriptions].join("；"),
    present.length,
    present.map(s => s.label).join(", "),
    valueState,
    ...specs.map(s => [...item.components.get(s.label).values].sort().join(" | ")),
    present.reduce((sum, s) => sum + item.components.get(s.label).count, 0),
    nodeText,
    note,
  ];
});

const commonCount = rows.filter(row => row[3] >= 2).length;
const differingCount = rows.filter(row => row[5] === "不同").length;
const sheet = workbook.worksheets.add("CHI Consolidated");
sheet.showGridLines = false;
sheet.tabColor = "#17365D";
sheet.getRange("A1:P1").merge();
sheet.getRange("A1").values = [["CHI Ruby 全量配置参数汇总"]];
sheet.getRange("A2:P2").merge();
sheet.getRange("A2").values = [["按“参数类别 + 配置项”合并；L1D / L1I / L2 的修正值优先，修正值为空时使用原配置值；7 个原始明细页完整保留"]];
sheet.getRange("A4:B4").values = [["原始有效配置项", sourceEntries]];
sheet.getRange("D4:E4").values = [["合并后参数项", rows.length]];
sheet.getRange("G4:H4").values = [["跨组件公共项", commonCount]];
sheet.getRange("J4:K4").values = [["公共项取值不同", differingCount]];

const headers = ["参数类别", "配置项", "配置项说明", "覆盖组件数", "覆盖组件", "取值一致性", "L1D", "L1I", "L2", "L3 / HNF", "RNI", "SNF", "Network", "原始出现次数", "配置节点（按组件）", "整理说明"];
sheet.getRange("A6:P6").values = [headers];
sheet.getRangeByIndexes(6, 0, rows.length, headers.length).values = rows;
const endRow = 6 + rows.length;
const table = sheet.tables.add(`A6:P${endRow}`, true, "CHIConsolidatedTable");
table.style = "TableStyleMedium2";

sheet.freezePanes.freezeRows(6);
sheet.freezePanes.freezeColumns(2);
sheet.getRange("A1").format.font = { bold: true, size: 16, color: "#FFFFFF" };
sheet.getRange("A1:P1").format.fill = "#17365D";
sheet.getRange("A2").format.font = { italic: true, size: 10, color: "#5B6575" };
sheet.getRange("A4:K4").format.font = { bold: true, color: "#1F2937" };
for (const range of ["A4:B4", "D4:E4", "G4:H4", "J4:K4"]) sheet.getRange(range).format.fill = "#D9EAF7";
sheet.getRange("A6:P6").format.fill = "#17365D";
sheet.getRange("A6:P6").format.font = { bold: true, color: "#FFFFFF" };
sheet.getRange(`A7:P${endRow}`).format.verticalAlignment = "top";
sheet.getRange(`A7:F${endRow}`).format.wrapText = true;
sheet.getRange(`G7:N${endRow}`).format.wrapText = false;
sheet.getRange(`O7:P${endRow}`).format.wrapText = true;
const widths = [18, 30, 48, 13, 24, 15, 22, 22, 22, 22, 22, 22, 22, 15, 62, 34];
widths.forEach((width, index) => sheet.getRangeByIndexes(0, index, endRow, 1).format.columnWidth = width);
sheet.getRange(`D7:D${endRow}`).format.numberFormat = "0";
sheet.getRange(`N7:N${endRow}`).format.numberFormat = "0";
sheet.getRange(`F7:F${endRow}`).conditionalFormats.add("containsText", { text: "不同", format: { fill: "#FCE4D6", font: { color: "#9C0006", bold: true } } });
sheet.getRange(`F7:F${endRow}`).conditionalFormats.add("containsText", { text: "相同", format: { fill: "#E2F0D9", font: { color: "#375623", bold: true } } });
sheet.getRange(`P7:P${endRow}`).conditionalFormats.add("containsText", { text: "公共参数", format: { fill: "#DDEBF7", font: { color: "#1F4E78" } } });

workbook.recalculate();
console.log((await workbook.inspect({ kind: "region", sheetId: "CHI Consolidated", range: `A1:P18`, include: "values,formulas", maxChars: 30000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 200 }, summary: "formula error scan" })).ndjson);
console.log((await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 20000, tableMaxRows: 5, tableMaxCols: 18 })).ndjson);
const preview = await workbook.render({ sheetName: "CHI Consolidated", range: "A1:P28", scale: 0.72 });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(output);
console.log(JSON.stringify({ sourceEntries, mergedItems: rows.length, commonCount, differingCount, output, previewPath }));
