import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "/Users/libo/Work/gem5-lab";
const SKILL_DIR = "/Users/libo/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.22227/skills/presentations";
const TMP_DIR = path.join(workspaceDir, ".artifacts/presentation/build");
const FINAL_PPTX = path.join(workspaceDir, "outputs/presentations/agent-ruby-modeling-optimization-one-page-v3.pptx");
const RUNTIME_PYTHON = "/Users/libo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href);

await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });

const W = 1280, H = 720;
const C = {
  bg: "#F6F9FD", white: "#FFFFFF", navy: "#153FC3", blue: "#1859F4",
  sky: "#78B5FF", pale: "#EAF3FF", pale2: "#F1F6FC", ink: "#18243A",
  body: "#394962", line: "#BDD6FF", green: "#00A542", greenPale: "#E7F9ED",
  orange: "#FF6500", orangePale: "#FFF0E6", gray: "#71839E", red: "#E53935"
};
const font = "Arial Unicode MS";
const p = Presentation.create({ slideSize: { width: W, height: H } });
const s = p.slides.add();
s.background.fill = C.bg;

function box(x,y,w,h,fill=C.white,stroke=C.line,r=10,sw=1.5) {
  return s.shapes.add({ geometry:"roundRect", position:{left:x,top:y,width:w,height:h}, fill, line:{style:"solid",fill:stroke,width:sw}, borderRadius:r });
}
function text(x,y,w,h,value,size=18,color=C.body,bold=false,align="left") {
  const sh=s.shapes.add({geometry:"textbox",position:{left:x,top:y,width:w,height:h},fill:"none",line:{fill:"none",width:0}});
  sh.text=value;
  sh.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:"middle",autoFit:"shrinkText",wrap:true};
  return sh;
}
function line(x,y,w,h,color=C.line,width=2,dash="solid") {
  return s.shapes.add({geometry:"line",position:{left:x,top:y,width:w,height:h},fill:"none",line:{style:dash,fill:color,width}});
}
function pill(x,y,w,label,fill,stroke,color) {
  const sh=box(x,y,w,28,fill,stroke,8,1.2); sh.text=label;
  sh.text.style={typeface:font,fontSize:13,bold:true,color,alignment:"center",verticalAlignment:"middle",autoFit:"shrinkText"}; return sh;
}
function sectionTitle(x,y,w,label) {
  text(x,y,w,30,label,22,C.navy,true);
  line(x,y+34,w,0,C.line,1.3);
}
function step(x,y,w,h,num,label,sub,accent=C.blue) {
  const sh=box(x,y,w,h,C.white,accent,9,1.6);
  const c=s.shapes.add({geometry:"ellipse",position:{left:x+12,top:y+13,width:34,height:34},fill:accent,line:{fill:accent,width:0}});
  c.text=String(num); c.text.style={typeface:font,fontSize:14,bold:true,color:C.white,alignment:"center",verticalAlignment:"middle"};
  text(x+54,y+9,w-64,24,label,16,C.ink,true);
  text(x+54,y+31,w-64,h-36,sub,12,C.body,false);
  return sh;
}
function arrow(a,b) { s.shapes.connect(a,b,{kind:"straight",fromSide:"right",toSide:"left",line:{style:"solid",fill:C.blue,width:2},tail:{type:"triangle",width:"sm",length:"sm"}}); }

// Header
text(42,18,1196,45,"Agent 自动化遍历 Ruby Modeling 性能优化",34,C.navy,true);
line(34,70,1210,0,C.navy,3);
text(52,80,930,42,"固定硬件边界 → 自动生成候选配置 → GKB / lmbench 验证 → 学习迭代 → 收敛固化",17,C.body,false);
pill(1008,86,104,"非侵入式",C.pale,C.sky,C.navy);
pill(1122,86,110,"自动收敛",C.greenPale,"#56D783",C.green);

// Left: controlled input
box(34,137,268,420,C.white,C.sky,11,1.6);
sectionTitle(54,151,228,"① 受控配置输入");
text(54,194,228,42,"人工确认项与 Agent 搜索空间严格分离",15,C.body,false);

const fixed=box(54,244,228,72,C.pale2,"#A9BDD8",8,1.2);
pill(66,255,74,"FIXED",C.white,"#8CA2C0",C.gray);
text(148,250,122,26,"硬件 Modeling",15,C.ink,true);
text(66,280,204,25,"拓扑、协议、时钟、安全边界",12,C.body,false);

const domains=[
  ["P-core", "性能核专属 Ruby 参数", C.blue, C.pale],
  ["E-core", "能效核专属 Ruby 参数", C.green, C.greenPale],
  ["Shared", "L3 / SNF / Network 共享参数", C.orange, C.orangePale]
];
domains.forEach((d,i)=>{
  const yy=330+i*58;
  box(54,yy,228,48,d[3],d[2],8,1.2);
  pill(64,yy+10,66,d[0],C.white,d[2],d[2]);
  text(138,yy+5,132,38,d[1],12,C.ink,true);
});
text(54,510,228,32,"YAML：manual-confirmed / search-space / baseline",12,C.gray,false);

// Center: optimization loop
box(320,137,606,420,C.white,C.sky,11,1.6);
sectionTitle(340,151,566,"② Loop Agent 闭环优化");
pill(740,153,74,"GKB",C.pale,C.sky,C.navy);
pill(822,153,84,"lmbench",C.greenPale,"#56D783",C.green);
text(340,191,566,26,"同一流程适配单核 / 多核；按 core_scope 选择 P-core、E-core、Shared 或 Mixed",14,C.body,false);

const st1=step(340,235,166,78,1,"生成候选","基于历史最优与禁区\n批量采样 Ruby 配置");
const st2=step(540,235,166,78,2,"门禁检查","约束合法性 + Smoke\n失败即记录并学习",C.orange);
const st3=step(740,235,166,78,3,"性能测试","运行测试矩阵\n采集性能与仿真成本",C.green);
arrow(st1,st2); arrow(st2,st3);

const st4=step(740,347,166,78,4,"指标解析","Score / HW 误差 /\n稳定性 / 资源代价",C.green);
const st5=step(540,347,166,78,5,"模型更新","更新参数重要度\n探索有效区、规避禁区",C.blue);
const st6=step(340,347,166,78,6,"收敛判断","收益、预算、连续无改善\n满足条件后自动停止",C.orange);
s.shapes.connect(st4,st5,{kind:"straight",fromSide:"left",toSide:"right",line:{style:"solid",fill:C.blue,width:2},tail:{type:"triangle",width:"sm",length:"sm"}});
s.shapes.connect(st5,st6,{kind:"straight",fromSide:"left",toSide:"right",line:{style:"solid",fill:C.blue,width:2},tail:{type:"triangle",width:"sm",length:"sm"}});
s.shapes.connect(st3,st4,{kind:"straight",fromSide:"bottom",toSide:"top",line:{style:"solid",fill:C.green,width:2},tail:{type:"triangle",width:"sm",length:"sm"}});
pill(354,445,142,"未收敛：下一轮",C.pale,C.sky,C.navy);
line(505,459,164,0,C.blue,1.5,"dashed");
pill(678,445,214,"已收敛：完整验证 + 重复测试",C.greenPale,"#56D783",C.green);
text(350,491,546,40,"输出：最终 Ruby 配置 + 最优参数组合 + 失败禁区 + 完整可追溯实验记录",14,C.ink,true,"center");

// Right: observable output
box(944,137,300,420,C.white,C.sky,11,1.6);
sectionTitle(964,151,260,"③ Dashboard 实时观测");
text(964,194,260,30,"Agent 只输出标准事件；服务统一校验、存储与展示",14,C.body,false);

const ev=box(964,236,72,55,C.orangePale,C.orange,8,1.2); ev.text="JSON\n事件"; ev.text.style={typeface:font,fontSize:13,bold:true,color:C.orange,alignment:"center",verticalAlignment:"middle"};
const db=box(1057,236,72,55,C.pale,C.blue,8,1.2); db.text="SQLite\n+ API"; db.text.style={typeface:font,fontSize:13,bold:true,color:C.navy,alignment:"center",verticalAlignment:"middle"};
const ui=box(1150,236,74,55,C.greenPale,C.green,8,1.2); ui.text="实时\nDashboard"; ui.text.style={typeface:font,fontSize:13,bold:true,color:C.green,alignment:"center",verticalAlignment:"middle"};
arrow(ev,db); arrow(db,ui);

const metrics=[
  ["当前阶段", "测试 / 学习 / 验证", C.blue],
  ["优化趋势", "总体 + Case 梯度", C.green],
  ["遍历覆盖", "P / E / Shared 参数域", C.orange],
  ["运行状态", "构建、Trial、失败原因", C.gray]
];
metrics.forEach((m,i)=>{
  const yy=314+i*45;
  const dot=s.shapes.add({geometry:"ellipse",position:{left:966,top:yy+8,width:22,height:22},fill:m[2],line:{fill:m[2],width:0}});
  dot.text=String(i+1); dot.text.style={typeface:font,fontSize:10,bold:true,color:C.white,alignment:"center",verticalAlignment:"middle"};
  text(998,yy,92,36,m[0],14,C.ink,true);
  text(1091,yy,129,36,m[1],12,C.body,false);
  if(i<3) line(998,yy+39,222,0,"#DDE8F7",1);
});
pill(964,505,260,"最终 Champion 配置可直接固化",C.navy,C.navy,C.white);

// Bottom conclusion band
const band=box(34,578,1210,112,"#1F49DF","#1F49DF",10,0);
text(64,594,128,33,"方案价值",23,C.white,true);
text(194,590,1018,40,"在不修改 gem5 主工程的前提下，把 Ruby 配置探索从“人工试参”升级为可约束、可追溯、会收敛的 Agent 自动优化闭环。",18,C.white,true);
text(194,632,1018,38,"D9300 P-core / E-core 独立建模 ｜ GKB / lmbench 统一接入 ｜ CI/CD 并行执行 ｜ Dashboard 实时呈现 ｜ 达到收敛条件自动停止",14,"#DCE7FF",false);

s.speakerNotes.textFrame.setText("内容依据 gem5-lab 当前非侵入式 Loop Agent 方案整理；视觉风格参考既有 OpenNPUX 架构与 Modeling 路线材料。所有流程节点均为可编辑 PowerPoint 原生形状。参考文件：/Users/libo/Work/gem5/ppt_out/opennpux-npu-pipe-roadmap.pptx");

const stagingDir = path.join(workspaceDir, ".codex-finalizer");
await fs.mkdir(stagingDir,{recursive:true});
const candidatePath=path.join(stagingDir,"agent-ruby-modeling-candidate.pptx");
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const requirements={explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[]};
const result=await finalizePresentation({
  ...requirements, workspaceDir, candidatePath, finalPath:FINAL_PPTX,
  pythonExecutable:RUNTIME_PYTHON,
  integrityValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath:path.join(SKILL_DIR,"container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs:["--expected-slide-size-emu","12192000,6858000","--validate-heading-fit"],
  requiredNativeTableOwnerSlides:[], fontPolicy:{basis:"design",families:[font]},
  verifyArtifactToolImport:true,
  receiptPath:path.join(stagingDir,"agent-ruby-modeling-v3.validation.json")
});
console.log(JSON.stringify(result,null,2));
