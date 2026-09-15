import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-full-parameter-table-merged.xlsx";
const output = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-full-parameter-table-agent-ready.xlsx";
const previewPath = "/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-parameters-agent-preview.png";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const main = workbook.worksheets.getItem("Ruby Parameters");
const consolidated = workbook.worksheets.getItem("CHI Consolidated");

const blank = value => value === null || value === undefined || value === "";
const text = value => blank(value) ? "" : String(value);

const plumbingPattern = /^(type|system|children|eventq_index|in_port|out_port|request_port|response_port|pio|interrupt|ruby_system|clk_domain|clock_domain|voltage_domain|power_state|version|machine_type|sequencer|cache|mandatory_queue|mandatoryqueue|upstream_destinations|downstream_destinations|ext_links|int_links|routers|netifs)$/i;
const noTunePattern = /^(type|system|children|eventq_index|in_port|out_port|request_port|response_port|pio|interrupt|ruby_system|clk_domain|clock_domain|voltage_domain|power_state|version|cluster_id|machine_type|addr_ranges|upstream_destinations|downstream_destinations|cache|sequencer|replacement_policy)$/i;
const tunePattern = /(latency|size$|buffer_size|assoc|banks?$|number_of_.*tbe|max_outstanding|transitions_per_cycle|max_dequeue_rate|bandwidth|flit|vcs?_per|buffers_per|routing_algorithm|adaptive_routing|prefetch|num_streams|threshold|channel_size|data_width|link_width|router_latency|link_latency|resourceStalls|policy_type|allocation|dealloc|enable_DCT|enable_DMT)/i;
const constrainedPattern = /(routing|topology|num_rows|mesh|policy|enable_|prefetch|resourceStalls|assoc|size$|banks?$|block_size|data_width|link_width|channel_size)/i;

function flags(domain, category, param, path, existingSearch = "") {
  const physicalDomain = /缓存|控制器|网络|内存|协议/.test(domain) || /控制器|缓存|队列|网络|路由|链路|接口|预取/.test(category);
  const modeling = physicalDomain && !plumbingPattern.test(param) ? "是" : "否";
  const d9300Status = modeling === "是" ? "待D9300确认" : "不适用";
  let loop = "否";
  if (existingSearch === "是") loop = "是";
  else if (existingSearch === "谨慎") loop = "受约束";
  else if (tunePattern.test(param) && !noTunePattern.test(param) && modeling === "是") loop = constrainedPattern.test(param) ? "受约束" : "是";
  return { modeling, d9300Status, loop };
}

function inferUnit(param, desc, values) {
  const p = param.toLowerCase();
  const d = desc.toLowerCase();
  const valueText = values.join(" ").toLowerCase();
  if (/latency|threshold_cy|recycle|delay/.test(p) || /周期/.test(d)) return "cycle";
  if (/frequency|clock$/.test(p) || /ghz|mhz/.test(valueText)) return "Hz";
  if (/bandwidth_factor/.test(p)) return "factor";
  if (/width_bits|bit_width/.test(p)) return "bit";
  if (/size$|block_size|channel_size|flit_size|data_width/.test(p) || /字节/.test(d)) return "byte";
  if (/assoc/.test(p)) return "ways";
  if (/percent|percentage|thresh_perc/.test(p)) return "%";
  if (/latency|time|timeout/.test(p) && /ns|us|ms/.test(valueText)) return "time";
  if (/^(true|false)( true| false)*$/.test(valueText.trim())) return "bool";
  if (/number_of_.*tbe|buffer_size|max_outstanding|queue|entries|num_|count|banks?$|transitions_per_cycle|max_dequeue_rate/.test(p)) return "count";
  if (/policy|algorithm|type|mode|randomization|state/.test(p)) return "enum";
  return "value";
}

function searchGuidance(param, unit, loop) {
  if (loop === "否") return { range: "不进入性能搜索", constraint: "保持配置文件当前值" };
  const p = param.toLowerCase();
  if (unit === "bool") return { range: "false / true", constraint: "必须通过正确性与稳定性门禁" };
  if (/assoc/.test(p)) return { range: "1 / 2 / 4 / 8 / 16", constraint: "容量、组数和 cache line 必须可整除" };
  if (/buffer_size/.test(p)) return { range: "0 / 16 / 32 / 64 / 128 / 256", constraint: "0 表示无限时需单独标记；不得造成协议死锁" };
  if (/latency|recycle|delay/.test(p)) return { range: "0–20 cycle", constraint: "非负；按所在时钟域换算并满足D9300时序边界" };
  if (/number_of_.*tbe|max_outstanding/.test(p)) return { range: "4 / 8 / 16 / 32 / 64 / 128 / 256", constraint: "正整数；同时检查队列容量与死锁阈值" };
  if (/transitions_per_cycle|max_dequeue_rate/.test(p)) return { range: "1 / 2 / 4 / 8 / 16 / 32", constraint: "正整数；不得超过D9300端口与流水吞吐" };
  if (/size$|banks?$|width|bandwidth|flit|vcs?_per/.test(p)) return { range: "由D9300约束文件给定离散候选", constraint: "容量、位宽、bank、VC和拓扑需联合合法" };
  if (/routing|policy|prefetch|enable_/.test(p)) return { range: "使用白名单离散枚举", constraint: "按协议、拓扑和功能支持矩阵过滤" };
  return { range: "以当前值为中心的小范围离散搜索", constraint: "需通过约束检查、Smoke Test和正确性门禁" };
}

const existingUsed = main.getUsedRange().values;
const existingEnd = existingUsed.length;
const addedHeaders = ["D9300 Modeling", "D9300确认状态", "Loop Agent"];
main.getRange("R5:T5").values = [addedHeaders];

const existingFlags = [];
for (let r = 5; r < existingEnd; r++) {
  const row = existingUsed[r] ?? [];
  if (!text(row[4])) continue;
  const f = flags(text(row[0]), text(row[1]), text(row[4]), text(row[5]), text(row[11]));
  existingFlags.push({ row: r, values: [f.modeling, f.d9300Status, f.loop] });
}
for (const item of existingFlags) main.getRangeByIndexes(item.row, 17, 1, 3).values = [item.values];

const chiValues = consolidated.getUsedRange().values;
const componentLabels = ["L1D", "L1I", "L2", "L3 / HNF", "RNI", "SNF", "Network"];
const domainFor = category => /网络|路由|链路|接口/.test(category) ? "网络" : /缓存|替换|预取/.test(category) ? "缓存" : /控制器|队列|Sequencer/.test(category) ? "控制器" : /时钟|电源/.test(category) ? "系统" : "CHI";
const stageFor = category => ({
  "控制器": "控制器", "缓存存储体": "缓存", "消息缓冲与队列": "队列", "Sequencer": "Sequencer",
  "预取器": "预取", "替换策略": "替换", "网络全局": "全局", "路由器": "路由器",
  "网络链路": "链路", "网络接口": "接口", "时钟与电压": "时钟", "电源状态": "电源",
})[category] ?? "其他";

const newRows = [];
for (let r = 6; r < chiValues.length; r++) {
  const row = chiValues[r] ?? [];
  const category = text(row[0]);
  const param = text(row[1]);
  if (!param) continue;
  const desc = text(row[2]);
  const covered = text(row[4]);
  const consistency = text(row[5]);
  const componentValues = row.slice(6, 13).map(text);
  const current = componentLabels.map((label, i) => componentValues[i] ? `${label}=${componentValues[i]}` : "").filter(Boolean).join("；");
  const nodePath = text(row[14]);
  const domain = domainFor(category);
  const unit = inferUnit(param, desc, componentValues.filter(Boolean));
  const f = flags(domain, category, param, nodePath);
  const guide = searchGuidance(param, unit, f.loop);
  const noteParts = [`CHI组件: ${covered}`, `取值一致性: ${consistency}`];
  if (f.modeling === "是") noteParts.push("D9300硬件建模项，当前值尚未在修正值列签核");
  else noteParts.push("仿真实现、对象连接或运行支撑项");
  newRows.push([
    domain,
    stageFor(category),
    `CHI / ${category}`,
    covered,
    param,
    nodePath,
    current,
    unit,
    "",
    "",
    "运行期",
    f.loop === "是" ? "是" : f.loop === "受约束" ? "谨慎" : "否",
    guide.range,
    guide.constraint,
    desc || `CHI ${category} 配置参数`,
    noteParts.join("；"),
    `用户配置明细: ${covered}`,
    f.modeling,
    f.d9300Status,
    f.loop,
  ]);
}

const startRowIndex = existingEnd;
main.getRangeByIndexes(startRowIndex, 0, newRows.length, 20).values = newRows;
const finalEnd = startRowIndex + newRows.length;

for (const table of main.tables.items) table.delete();
const newTable = main.tables.add(`A5:T${finalEnd}`, true, "RubyParameterTable");
newTable.style = "TableStyleMedium2";
main.getRange("A2:T2").unmerge();
main.getRange("A3:T3").unmerge();
main.getRange("A2:T2").merge();
main.getRange("A3:T3").merge();
main.getRange("A2").values = [["Ruby memory configuration parameters"]];
main.getRange("A3").values = [["Scope: MESI_Two_Level and CHI components. D9300 modeling fields identify hardware-facing parameters; Loop Agent fields identify searchable parameters."]];
main.getRange("R5:T5").format.fill = "#17365D";
main.getRange("R5:T5").format.font = { bold: true, color: "#FFFFFF" };
main.getRange(`R6:T${finalEnd}`).format.verticalAlignment = "top";
main.getRange(`R6:T${finalEnd}`).format.wrapText = true;
[18, 20, 16].forEach((width, i) => main.getRangeByIndexes(0, 17 + i, finalEnd, 1).format.columnWidth = width);
main.getRange(`R6:R${finalEnd}`).conditionalFormats.add("containsText", { text: "是", format: { fill: "#DDEBF7", font: { color: "#1F4E78", bold: true } } });
main.getRange(`S6:S${finalEnd}`).conditionalFormats.add("containsText", { text: "待D9300确认", format: { fill: "#FFF2CC", font: { color: "#7F6000", bold: true } } });
main.getRange(`T6:T${finalEnd}`).conditionalFormats.add("containsText", { text: "是", format: { fill: "#E2F0D9", font: { color: "#375623", bold: true } } });
main.getRange(`T6:T${finalEnd}`).conditionalFormats.add("containsText", { text: "受约束", format: { fill: "#FFF2CC", font: { color: "#7F6000", bold: true } } });
main.freezePanes.freezeRows(5);
main.freezePanes.freezeColumns(5);

workbook.recalculate();
console.log((await workbook.inspect({ kind: "region", sheetId: "Ruby Parameters", range: "A1:T14", include: "values,formulas", maxChars: 22000 })).ndjson);
console.log((await workbook.inspect({ kind: "region", sheetId: "Ruby Parameters", range: `A${existingEnd}:T${Math.min(finalEnd, existingEnd + 12)}`, include: "values,formulas", maxChars: 30000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" })).ndjson);
const preview = await workbook.render({ sheetName: "Ruby Parameters", range: `A1:T${Math.min(finalEnd, 28)}`, scale: 0.72 });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(output);

const counts = { modeling: 0, loopYes: 0, loopConstrained: 0, loopNo: 0 };
for (let r = 5; r < finalEnd; r++) {
  const vals = main.getRangeByIndexes(r, 17, 1, 3).values[0];
  if (vals[0] === "是") counts.modeling++;
  if (vals[2] === "是") counts.loopYes++;
  else if (vals[2] === "受约束") counts.loopConstrained++;
  else counts.loopNo++;
}
console.log(JSON.stringify({ originalParameterRows: existingEnd - 5, chiRowsAdded: newRows.length, finalParameterRows: finalEnd - 5, ...counts, output, previewPath }));
