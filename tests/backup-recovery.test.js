// Run with: node tests/backup-recovery.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
const storage = script.slice(script.indexOf("function serializeStoredData("),
  script.indexOf("/* =========================================================\n   BACKUP / RESTORE"));
const recovery = script.slice(script.indexOf("let pendingBackup = null;"),
  script.indexOf("/* =========================================================\n   PAGE NAVIGATION"));
const existing = {home:{},family:{},projects:[{name:"Bathroom",tasks:[],materials:[]}],
  shopping:[],tools:[],maintenance:[],calendar:[],aiChats:{bathroom:[{role:"user",content:"Keep the tile"}]}};
const replacement = {...existing,projects:[{name:"Kitchen",tasks:[],materials:[]}]};
let stored = JSON.stringify(existing),reloaded = false;
const records = new Map();
const elements = {
  backupRestoreStatus:{textContent:""},backupPreview:{hidden:true},
  backupSummary:{textContent:""},recoveryCopies:{innerHTML:"",textContent:""}
};
const context = vm.createContext({
  Map,JSON,Date,Promise,localStorage:{getItem:() => stored,setItem:(_,value) => {stored = value;}},
  document:{getElementById:id => elements[id]},location:{reload:() => {reloaded = true;}},
  confirm:() => true,clearTimeout:() => {},
  data:existing,STORAGE_KEY:"theListDataV2",STORED_IMAGE_PREFIX:"the-list-image-ref:v1:",
  STORED_IMAGE_POOL:"theListImagePoolV1"
});
vm.runInContext(`${storage}\n${recovery}`,context);
context.recoveryRecord = async (id,record) => record ? records.set(id,record) : records.get(id);

(async () => {
  assert.equal(vm.runInContext("hasRecoveryContent(JSON.stringify({projects:[],aiChats:{}}))",context),false,
    "an empty startup must never displace a saved recovery copy");
  await context.saveRecoverySnapshot(stored);
  assert.equal(records.get("latest").id,"latest");
  await context.saveRecoverySnapshot(stored);
  assert.equal(records.size,1,"unchanged data should not create another copy");
  context.showBackupPreview(replacement,"Today");
  await context.restoreBackup();
  assert.equal(reloaded,true);
  assert.equal(JSON.parse(stored).projects[0].name,"Kitchen");
  assert.equal(JSON.parse(records.get("before-restore").snapshot).projects[0].name,"Bathroom",
    "the prior project survives an intentional restore");
  await context.previewRecoveryCopy("before-restore");
  assert.equal(vm.runInContext("pendingBackup.projects[0].name",context),"Bathroom");
  assert.match(elements.backupSummary.textContent,/1 projects/);
  console.log("Recovery copies preserve the current project before restore and can be previewed.");
})().catch(error => {console.error(error);process.exitCode = 1;});
