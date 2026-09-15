import fs from "node:fs/promises";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const rows=[];
const add=(domain,stage,cls,component,param,path,value,unit,ghz,phase,search,range,constraint,effect,notes,source)=>rows.push([domain,stage,cls,component,param,path,value,unit,ghz,"",phase,search,range,constraint,effect,notes,source]);
const src={ruby:"src/mem/ruby/system/RubySystem.py",cache:"src/mem/ruby/structures/RubyCache.py",ctrl:"src/mem/ruby/slicc_interface/Controller.py",seq:"src/mem/ruby/system/Sequencer.py",pref:"src/mem/ruby/structures/RubyPrefetcher.py",net:"configs/network/Network.py",netbase:"src/mem/ruby/network/Network.py",simple:"src/mem/ruby/network/simple/SimpleNetwork.py",link:"src/mem/ruby/network/BasicLink.py",garnet:"src/mem/ruby/network/garnet/GarnetNetwork.py",glink:"src/mem/ruby/network/garnet/GarnetLink.py",msg:"src/mem/ruby/network/MessageBuffer.py",mesi:"configs/ruby/MESI_Two_Level.py",rubycfg:"configs/ruby/Ruby.py",dram:"src/mem/DRAMInterface.py"};

add("构建","协议","BuildEnv","Ruby protocol","protocol","Kconfig: PROTOCOL","MESI_Two_Level","enum","","构建期","否","MESI_Two_Level","改变协议必须重建","决定一致性状态机及 vnet 数","当前实施协议",src.mesi);
add("系统","时钟","RubySystem","Ruby","clock","--ruby-clock","2GHz","GHz",2,"运行期","是","1–4GHz",">0","所有 Ruby controller/network 的基准周期","当前 sidecar 默认",src.rubycfg);
add("系统","地址","RubySystem","Ruby","block_size_bytes","--cacheline_size",64,"byte","","运行期","谨慎","32/64/128","2 的幂；全系统一致","一致性块粒度、索引和消息大小","通常跟硬件固定",src.ruby);
add("系统","地址","RubySystem","Ruby","memory_size_bits","ruby.memory_size_bits",48,"bit","","运行期","否","48/52/64","覆盖物理地址宽度","Ruby 地址表示位数","legacy Ruby.py 设置为 48",src.rubycfg);
add("系统","功能","RubySystem","Ruby","randomization","ruby.randomization",false,"bool","","运行期","否","false/true","复现测试通常 false","消息 enqueue 随机延迟","调试/鲁棒性测试使用",src.ruby);
add("系统","功能","RubySystem","Ruby","access_backing_store","--access-backing-store",false,"bool","","运行期","否","false/true","需要 phys_mem","功能存储与 Ruby timing 分离","性能搜索保持 false",src.ruby);
add("系统","统计","RubySystem","Profiler","hot_lines","ruby.hot_lines",false,"bool","","运行期","否","false/true","增加统计开销","热点 cache line 统计","仅分析阶段启用",src.ruby);
add("系统","统计","RubySystem","Profiler","all_instructions","ruby.all_instructions",false,"bool","","运行期","否","false/true","增加统计开销","记录全部指令访问","非性能参数",src.ruby);
add("系统","拓扑","RubySystem","Sequencers","num_of_sequencers","自动生成",2,"count","","派生","否","CPU+DMA 数","由连接数量决定","Sequencer 总数","1 CPU + 1 Gemmini DMA",src.ruby);
add("系统","协议","RubySystem","Virtual networks","number_of_virtual_networks","协议固定",3,"count","","派生","否","3","MESI_Two_Level 固定 3","请求/响应/转发网络隔离","不可作为搜索参数",src.mesi);

for(const [p,path,v,u,s,r,c,e,n] of [
 ["num_cpus","--num-cpus",1,"count","谨慎","1/2/4/8","与 workload/拓扑一致","L1 controller 和 sequencer 数","当前为单核"],
 ["num_l2caches","--num-l2caches",1,"count","是","1/2/4/8","正整数且建议 2 的幂","L2 bank/controller 数","决定地址交织位"],
 ["num_dirs","--num-dirs",1,"count","谨慎","1/2/4","正整数且建议 2 的幂","Directory 和内存通道映射","与内存拓扑联动"],
 ["numa_high_bit","--numa-high-bit",0,"bit","否","0 或地址位","需匹配 directory 数","NUMA directory 映射高位","0 使用 cache line 以上低位"],
 ["interleaving_bits","--interleaving-bits",0,"bit","谨慎","0–4","需匹配通道数","目录/内存/cache 交织","0 表示自动"],
 ["xor_low_bit","--xor-low-bit",20,"bit","谨慎","0/16–24","0 同时关闭 xor high bit","内存通道 hash","硬件校准时调整"],
 ["ports","--ports",4,"transition/cycle","是","1/2/4/8/16","正整数","每周期 SLICC transition 上限","覆盖 controller 类默认 32"],
 ["recycle_latency","--recycle-latency",10,"cycle","是","1–20","非负","controller 输入回收延迟","高敏感度"],
]) add("协议","控制器","Ruby/MESI_Two_Level","Global",p,path,v,u,u==="cycle"?2:"","运行期",s,r,c,e,n,src.rubycfg);

for(const level of ["L1I","L1D","L2"]){
 const l=level.toLowerCase(),vals=level==="L1I"?["32KiB",2]:level==="L1D"?["64KiB",2]:["2MiB",8];
 add("缓存",level,"RubyCache",level,"size",`--${l}_size`,vals[0],"bytes","","运行期","是",level==="L2"?"512KiB–16MiB":"16–256KiB","容量与 assoc/block/bank 可整除","缓存容量","每个 L2 controller 的容量",src.mesi);
 add("缓存",level,"RubyCache",level,"assoc",`--${l}_assoc`,vals[1],"ways","","运行期","是","1/2/4/8/16/32","容量与 sets 合法","组相联度","",src.mesi);
 add("缓存",level,"RubyCache",level,"start_index_bit","自动计算",level==="L2"?"log2(line)+log2(L2 banks)":"log2(line)","bit","","派生","否","派生","不可与 bank 数冲突","cache set 索引起始位","",src.cache);
 add("缓存",level,"RubyCache",level,"replacement_policy",`${level}.replacement_policy`,"TreePLRURP","enum","","运行期","是","LRU/TreePLRU/Random 等","策略必须已编译","替换选择","先固定，后局部搜索",src.cache);
 add("缓存",level,"RubyCache",level,"dataArrayBanks",`${level}.dataArrayBanks`,1,"count","","运行期","是","1/2/4/8","正整数","data array 并行 bank 数","需开启 resourceStalls 才体现冲突",src.cache);
 add("缓存",level,"RubyCache",level,"tagArrayBanks",`${level}.tagArrayBanks`,1,"count","","运行期","是","1/2/4/8","正整数","tag array 并行 bank 数","",src.cache);
 add("缓存",level,"RubyCache",level,"dataAccessLatency",`${level}.dataAccessLatency`,1,"cycle",2,"运行期","是","1–20","非负","data array 访问延迟","不同于 Classic data_latency 实现",src.cache);
 add("缓存",level,"RubyCache",level,"tagAccessLatency",`${level}.tagAccessLatency`,1,"cycle",2,"运行期","是","1–20","非负","tag array 访问延迟","不同于 Classic tag_latency 实现",src.cache);
 add("缓存",level,"RubyCache",level,"resourceStalls",`${level}.resourceStalls`,false,"bool","","运行期","是","false/true","bank 参数需要 true 才产生资源 stall","模拟 tag/data bank 端口冲突","高真实性配置建议 true",src.cache);
}
add("缓存","L1","MESI_Two_Level_L1Cache_Controller","Prefetch","enable_prefetch","L1.enable_prefetch",false,"bool","","运行期","是","false/true","需配置 RubyPrefetcher","控制 L1 预取","当前协议脚本固定 false，sidecar 可覆盖",src.mesi);
for(const [p,v,u,r,e] of [["num_streams",4,"count","1–16","并行 stream 数"],["unit_filter",8,"entry","4–64","unit-stride filter 容量"],["nonunit_filter",8,"entry","4–64","非 unit-stride filter 容量"],["train_misses",4,"count","1–16","触发 stream 训练阈值"],["num_startup_pfs",1,"count","1–8","stream 启动预取数量"],["cross_page",false,"bool","false/true","允许跨页预取"],["page_shift",12,"bit","12/14/16","页号掩码位"]]) add("缓存","L1","RubyPrefetcher","Prefetcher",p,`prefetcher.${p}`,v,u,"","运行期","是",r,"enable_prefetch=true",e,"",src.pref);

for(const [p,path,v,u,search,range,constraint,effect,notes] of [
 ["network","--network","simple","enum","是","simple/garnet","两者模型精度不同","选择网络模型","粗搜先 simple，精调用 garnet"],
 ["topology","--topology","Crossbar","enum","是","Crossbar/Mesh_XY/Mesh_westfirst 等","必须与 controller 数匹配","路由器与链路拓扑",""],
 ["mesh_rows","--mesh-rows",0,"count","谨慎","0/2/4/8","Mesh 时 rows 能整除 router 数","二维拓扑行数","非 Mesh 保持 0"],
 ["link_latency","--link-latency",1,"cycle","是","1–10",">=1","所有链路延迟","拓扑可逐 link 覆盖"],
 ["router_latency","--router-latency",1,"cycle","是","1–8",">=1；主要用于 Garnet","router pipeline 延迟",""],
 ["link_width_bits","--link-width-bits",128,"bit","是","64/128/256/512","8 的倍数","Garnet flit/link 宽度","ni_flit_size=bits/8"],
 ["vcs_per_vnet","--vcs-per-vnet",4,"count","是","1/2/4/8",">=1","每个 vnet 的 VC 数","Garnet only"],
 ["routing_algorithm","--routing-algorithm",0,"enum","是","0/1/2","1=XY 需要 Mesh","0 权重表；1 XY；2 custom","Garnet only"],
 ["garnet_deadlock_threshold","--garnet-deadlock-threshold",50000,"cycle","否","50000–5000000","大于最大合理拥塞时间","死锁检测阈值","门禁参数，不用于性能寻优"],
 ["network_fault_model","--network-fault-model",false,"bool","否","false/true","需 fault_model","启用网络故障模型","可靠性测试使用"],
]) add("网络","全局",p==="network"?"Network":"RubyNetwork","Network",p,path,v,u,u==="cycle"?2:"","运行期",search,range,constraint,effect,notes,src.net);

for(const [p,v,u,s,r,c,e] of [["control_msg_size",8,"byte","谨慎","8–32",">0","控制消息大小"],["data_msg_size",64,"byte","否","=cache line","默认等于 block size","数据消息大小"],["buffer_size",0,"entry","是","0/1–128","0=无限","SimpleNetwork 内部默认 buffer"],["endpoint_bandwidth",1000,"factor","谨慎","100–4000",">0","SimpleNetwork endpoint 带宽因子"],["physical_vnets_channels","[]","vector","是","每 vnet channel 数","长度等于 vnet 数或空","SimpleNetwork 物理通道仿真"],["physical_vnets_bandwidth","[]","vector","是","每 vnet bandwidth factor","需 physical_vnets_channels","覆盖 link bandwidth factor"],["adaptive_routing",false,"bool","是","false/true","Simple/WeightBased","SimpleNetwork 自适应路由"]]) add("网络","SimpleNetwork",p==="adaptive_routing"?"WeightBased":"SimpleNetwork","Simple network",p,`network.${p}`,v,u,"","运行期",s,r,c,e,"仅 network=simple",p==="adaptive_routing"?src.simple:src.simple);

for(const [p,v,u,s,r,c,e] of [["num_rows",0,"count","谨慎","0/2/4/8","二维拓扑约束","Garnet rows"],["ni_flit_size",16,"byte","是","8/16/32/64","=link_width_bits/8","网络接口 flit 大小"],["vcs_per_vnet",4,"count","是","1/2/4/8",">=1","每 vnet VC 数"],["buffers_per_data_vc",4,"flit","是","1/2/4/8/16",">=1","data VC 深度"],["buffers_per_ctrl_vc",1,"flit","是","1/2/4/8",">=1","control VC 深度"],["routing_algorithm",0,"enum","是","0/1/2","拓扑兼容","Garnet 路由算法"],["enable_fault_model",false,"bool","否","false/true","需 fault model","故障仿真"],["garnet_deadlock_threshold",50000,"cycle","否","50000–5000000",">0","网络死锁检测"]]) add("网络","Garnet","GarnetNetwork","Garnet",p,`network.${p}`,v,u,u==="cycle"?2:"","运行期",s,r,c,e,"仅 network=garnet",src.garnet);

for(const [p,v,u,s,r,c,e] of [["latency",1,"cycle","是","1–10",">=1","link pipeline 延迟"],["bandwidth_factor",16,"byte/cycle","是","8/16/32/64",">0；Simple only","链路带宽倍率"],["weight",1,"weight","谨慎","1–10",">=1","最短路由权重"],["supported_vnets","[]","vector","否","all/子集","协议 vnet 合法","链路承载 vnet"],["src_cdc",false,"bool","谨慎","false/true","异步时钟域才开启","源端 CDC"],["dst_cdc",false,"bool","谨慎","false/true","异步时钟域才开启","目的端 CDC"],["src_serdes",false,"bool","谨慎","false/true","宽度不同时开启","源端 SerDes"],["dst_serdes",false,"bool","谨慎","false/true","宽度不同时开启","目的端 SerDes"],["serdes_latency",1,"cycle","是","1–8","启用 SerDes","SerDes 延迟"],["cdc_latency",1,"cycle","是","1–8","启用 CDC","CDC 延迟"]]) add("网络","链路","BasicLink/GarnetLink","Link",p,`link.${p}`,v,u,u==="cycle"?2:"","运行期",s,r,c,e,"通常由 topology 构造",p.includes("cdc")||p.includes("serdes")?src.glink:src.link);

for(const [p,v,u,s,r,c,e] of [["transitions_per_cycle",4,"transition/cycle","是","1/2/4/8/16",">0","SLICC controller 吞吐"],["buffer_size",0,"entry","是","0/1–256","0=无限","controller buffer 上限"],["recycle_latency",10,"cycle","是","1–20","非负","输入 buffer 回收"],["number_of_TBEs",256,"entry","是","16–4096",">0","未完成事务表容量"],["mandatory_queue_latency",1,"cycle","是","0–10","协议可能覆盖","顶层 mandatory queue 附加延迟"],["cluster_id",0,"id","否","拓扑派生","唯一/合法","controller cluster 标识"]]) add("控制器","通用","RubyController","L1/L2/Directory/DMA",p,`controller.${p}`,v,u,u==="cycle"?2:"","运行期",s,r,c,e,"可按 controller 类型分别设置",src.ctrl);
for(const [p,v,u,s,r,c,e] of [["max_outstanding_requests",16,"request","是","4–256",">0","CPU Sequencer outstanding 上限"],["deadlock_threshold",500000,"cycle","否","500000–5000000","高于最长正常事务","CPU request 死锁阈值"],["max_outstanding_requests(DMA)",64,"request","是","16–512",">0","DMA Sequencer outstanding 上限"]]) add("控制器","Sequencer",p.includes("DMA")?"DMASequencer":"RubySequencer",p.includes("DMA")?"Gemmini DMA":"CPU",p,`sequencer.${p.split("(")[0]}`,v,u,u==="cycle"?2:"","运行期",s,r,c,e,"",src.seq);
for(const [p,v,u,s,r,c,e] of [["ordered",false,"bool","谨慎","false/true","协议队列语义决定","消息顺序保证"],["buffer_size",0,"entry","是","0/1–256","0=无限","消息队列容量"],["randomization","ruby_system","enum","否","disabled/enabled/ruby_system","复现保持 disabled/system false","enqueue 随机延迟"],["allow_zero_latency",false,"bool","否","false/true","跨对象队列不应 true","允许零延迟 enqueue"],["max_dequeue_rate",0,"message/cycle","是","0/1–32","0=无限","每周期 dequeue 上限"],["routing_priority",0,"priority","谨慎","0–10","越小优先级越高","网络消费优先级"]]) add("控制器","队列","MessageBuffer","Protocol queues",p,`message_buffer.${p}`,v,u,"","运行期",s,r,c,e,"多数队列由协议脚本创建",src.msg);

const dramRows=[
 ["page_policy","open_adaptive","enum","open/close/open_adaptive/close_adaptive","页策略"],["max_accesses_per_row",16,"access","1–64","单行最大访问数"],["device_size","512MiB","bytes","固定/器件模型","单颗器件容量"],["device_bus_width",8,"bit","4/8/16","器件数据宽度"],["burst_length",8,"beat","8","突发长度"],["device_rowbuffer_size","1KiB","bytes","1–2KiB","单器件 row buffer"],["devices_per_rank",8,"count","4/8/16","每 rank 器件数"],["ranks_per_channel",2,"count","1/2/4","每 channel ranks"],["banks_per_rank",8,"count","8/16/32","每 rank banks"],["bank_groups_per_rank",0,"count","0/4/8","每 rank bank groups"],["tCK","1.25ns","ns","器件规格","DRAM 时钟周期"],["tBURST","5ns","ns","器件规格","burst 传输时间"],["tRCD","13.75ns","ns","器件规格","ACT→READ"],["tRCD_WR","=tRCD","ns","器件规格","ACT→WRITE"],["tCL","13.75ns","ns","器件规格","READ CAS latency"],["tCWL","=tCL","ns","器件规格","WRITE CAS latency"],["tRP","13.75ns","ns","器件规格","PRE→ACT"],["tRAS","35ns","ns","器件规格","ACT→PRE"],["tWR","15ns","ns","器件规格","WRITE recovery"],["tRTP","7.5ns","ns","器件规格","READ→PRE"],["tRFC","260ns","ns","器件规格","refresh cycle"],["tREFI","7.8us","us","器件规格","refresh interval"],["tWTR","7.5ns","ns","器件规格","WRITE→READ"],["tRTW","2.5ns","ns","器件规格","READ→WRITE"],["tCS","2.5ns","ns","器件规格","跨 rank bus delay"],["tRRD","6ns","ns","器件规格","ACT→ACT"],["tRRD_L","0ns","ns","器件规格","同 bank group ACT→ACT"],["tCCD_L","0ns","ns","器件规格","同 bank group CAS→CAS"],["tXAW","30ns","ns","器件规格","activation window"],["activation_limit",4,"count","器件规格","窗口内最大 ACT"],["tXP","6ns","ns","器件规格","退出 power-down"],["tXS","270ns","ns","器件规格","退出 self-refresh"],["enable_dram_powerdown",false,"bool","false/true","DRAM power-down"],["read_buffer_size",32,"request","8–256","read queue 容量"],["write_buffer_size",64,"request","8–256","write queue 容量"],["write_high_thresh_perc",85,"percent","50–95","写队列高水位"],["write_low_thresh_perc",50,"percent","10–80","写队列低水位"],["min_writes_per_switch",16,"request","1–64","读写切换最小 writes"]
];
for(const [p,v,u,r,e] of dramRows) add("内存","DRAM","DDR3_1600_8x8",p.startsWith("t")?"Timing":"Organization/Scheduler",p,`dram.${p}`,v,u,"","运行期",p==="device_size"?"否":"谨慎",r,"保持真实器件时序关系",e,"Ruby directory memory_out_port 连接 DRAM",src.dram);

const headers=["Domain","Stage","Class","Component","Parameter","CLI / Object Path","Current / Default","Unit","GHz","Delay (ns)","Config Phase","Search","Suggested Range","Constraint","Code Function / Impact","Notes","Source"];
const safeRows=rows.map(row=>row.map(value=>typeof value==="string"&&value.startsWith("=")?`'${value}`:value));
const wb=Workbook.create();
const sheet=wb.worksheets.add("Ruby Parameters");
const map=wb.worksheets.add("Classic to Ruby");
sheet.showGridLines=false; map.showGridLines=false;
sheet.getRange("A2:Q2").merge(); sheet.getRange("A2").values=[["Ruby memory configuration parameters"]];
sheet.getRange("A3:Q3").merge(); sheet.getRange("A3").values=[["Scope: MESI_Two_Level, SimpleNetwork/Garnet, sequencers, controllers, message buffers and DDR3_1600_8x8"]];
sheet.getRange("A5:Q5").values=[headers];
sheet.getRangeByIndexes(5,0,safeRows.length,headers.length).values=safeRows;
for(let i=0;i<rows.length;i++) if(rows[i][7]==="cycle"&&typeof rows[i][6]==="number"&&typeof rows[i][8]==="number") sheet.getCell(5+i,9).formulas=[[`=G${6+i}/I${6+i}`]];
const end=5+rows.length;
const table=sheet.tables.add(`A5:Q${end}`,true,"RubyParameterTable"); table.style="TableStyleMedium2";
sheet.freezePanes.freezeRows(5); sheet.freezePanes.freezeColumns(5);
sheet.getRange("A2").format.font={bold:true,size:15,color:"#1F2937"}; sheet.getRange("A3").format.font={italic:true,size:10,color:"#5B6575"};
sheet.getRange("A5:Q5").format.fill="#17365D"; sheet.getRange("A5:Q5").format.font={bold:true,color:"#FFFFFF"};
sheet.getRange(`A6:Q${end}`).format.verticalAlignment="top"; sheet.getRange(`A6:Q${end}`).format.wrapText=false;
const widths=[13,15,28,22,30,30,18,14,10,13,13,11,24,36,42,38,42]; widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,end,1).format.columnWidth=w);
sheet.getRange(`I6:J${end}`).format.numberFormat="0.000";
sheet.getRange(`L6:L${end}`).conditionalFormats.add("containsText",{text:"是",format:{fill:"#E2F0D9",font:{color:"#375623",bold:true}}});
sheet.getRange(`L6:L${end}`).conditionalFormats.add("containsText",{text:"否",format:{fill:"#E7E6E6",font:{color:"#595959"}}});

const mapHeaders=["Classic Component","Classic Parameter","Ruby Replacement","Ruby Parameter","Current Ruby Value","Mapping Notes"];
const mappings=[
 ["L1I Cache","SIZE / assoc","Ruby L1I CacheMemory","l1i_size / l1i_assoc","32KiB / 2","容量和路数直接映射"],
 ["L1I Cache","tag_latency / data_latency","Ruby CacheMemory arrays","tagAccessLatency / dataAccessLatency","1 / 1 cycle","Ruby 还可建模 array banks 和 resource stalls"],
 ["L1D Cache","SIZE / assoc","Ruby L1D CacheMemory","l1d_size / l1d_assoc","64KiB / 2","容量和路数直接映射"],
 ["L1D Cache","MSHR","Ruby controller + Sequencer","number_of_TBEs / max_outstanding_requests","256 / 16","不是一一对应，需要联合校准"],
 ["L2 Cache","SIZE / assoc","Ruby L2 CacheMemory","l2_size / l2_assoc","2MiB / 8","每个 L2 bank 的容量"],
 ["L2/L3/SLC","层级容量","MESI_Two_Level shared L2","num_l2caches + l2_size","1 × 2MiB","MESI_Two_Level 只有两层；L3/SLC 需三层协议或自定义层级"],
 ["CoherentXBar","frontend/forward/response latency","Ruby routers and links","router_latency / link_latency","1 / 1 cycle","Classic 分段延迟改为网络 hop 延迟"],
 ["CoherentXBar","width","Simple bandwidth / Garnet flit","bandwidth_factor / link_width_bits","16 B/cycle / 128 bit","Simple 与 Garnet 单位不同"],
 ["CoherentXBar","snoop_filter_capacity","Ruby coherence state","Protocol controller state","N/A","Ruby 不使用 Classic snoop filter"],
 ["CoherentXBar","max_outstanding_snoops","Ruby TBEs and buffers","number_of_TBEs / buffer_size","256 / unlimited","语义近似但非直接等价"],
 ["Memory bus","bus topology","Ruby network + Directory","network / topology / num_dirs","simple / Crossbar / 1","Ruby 替代总线及 snoop 路径"],
 ["DRAM","组织和时序","Ruby Directory → MemCtrl","DDR3_1600_8x8 parameters","保持器件模型","DRAM 参数本身不因 Ruby 改变"],
 ["Gemmini DMA","L2XBar port","Ruby DMASequencer/controller","max_outstanding_requests(DMA)",64,"DMA 请求进入一致性协议"],
 ];
map.getRange("A2:F2").merge(); map.getRange("A2").values=[["Classic memory to Ruby mapping"]];
map.getRange("A4:F4").values=[mapHeaders]; map.getRangeByIndexes(4,0,mappings.length,6).values=mappings;
const mapEnd=4+mappings.length; const mt=map.tables.add(`A4:F${mapEnd}`,true,"ClassicRubyMap"); mt.style="TableStyleMedium2";
map.freezePanes.freezeRows(4); map.getRange("A2").format.font={bold:true,size:15,color:"#1F2937"}; map.getRange("A4:F4").format.fill="#17365D"; map.getRange("A4:F4").format.font={bold:true,color:"#FFFFFF"};
[24,28,28,36,24,58].forEach((w,i)=>map.getRangeByIndexes(0,i,mapEnd,1).format.columnWidth=w); map.getRange(`A5:F${mapEnd}`).format.wrapText=true; map.getRange(`A5:F${mapEnd}`).format.verticalAlignment="top";
sheet.tabColor="#17365D"; map.tabColor="#4472C4";
wb.recalculate();
const inspect=await wb.inspect({kind:"table",range:`Ruby Parameters!A1:Q15`,include:"values,formulas",tableMaxRows:15,tableMaxCols:17}); console.log(inspect.ndjson);
const errors=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",options:{useRegex:true,maxResults:100},summary:"formula scan"}); console.log(errors.ndjson);
const outDir="/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table"; await fs.mkdir(outDir,{recursive:true});
const preview=await wb.render({sheetName:"Ruby Parameters",range:"A1:Q18",scale:1}); await fs.writeFile(`${outDir}/preview.png`,new Uint8Array(await preview.arrayBuffer()));
const mapPreview=await wb.render({sheetName:"Classic to Ruby",range:`A1:F${mapEnd}`,scale:1}); await fs.writeFile(`${outDir}/mapping-preview.png`,new Uint8Array(await mapPreview.arrayBuffer()));
const xlsx=await SpreadsheetFile.exportXlsx(wb); await xlsx.save(`${outDir}/ruby-full-parameter-table.xlsx`);
