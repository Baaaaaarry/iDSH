import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path="/Users/libo/Work/gem5-lab/outputs/ruby-parameter-table/ruby-full-parameter-table.xlsx";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));
console.log((await wb.inspect({kind:"workbook,sheet,table",maxChars:12000,tableMaxRows:10,tableMaxCols:20})).ndjson);
console.log((await wb.inspect({kind:"region",sheetId:"Ruby Parameters",range:"A1:Z220",maxChars:30000})).ndjson);
const preview=await wb.render({sheetName:"Ruby Parameters",autoCrop:"all",scale:0.7});
await fs.writeFile("/Users/libo/Work/gem5-lab/.artifacts/ruby-parameter-table/updated-before.png",new Uint8Array(await preview.arrayBuffer()));
const names=["l1d","l1i","l2","l3","io_rni","snf","network"];
const extracted={};
for(const name of names) extracted[name]=wb.worksheets.getItem(name).getUsedRange().values;
await fs.writeFile("/Users/libo/Work/gem5-lab/.artifacts/ruby-parameter-table/component-data.json",JSON.stringify(extracted,null,2));
