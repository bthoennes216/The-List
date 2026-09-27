// Run with: node tests/household-sync.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,"..","household.js"),"utf8")
  .replace('const HOUSEHOLD_SUPABASE_URL = "";','const HOUSEHOLD_SUPABASE_URL = "https://test.example";')
  .replace('const HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY = "";','const HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY = "public-test-key";');
const phone = {home:{},family:{},projects:[{id:"kitchen",name:"Kitchen",tasks:[{id:"paint",text:"Paint cabinets"}],materials:[]}],
  shopping:[],tools:[],maintenance:[],calendar:[],aiChats:{general:[{role:"user",content:"Hello"}]}};
const shared = {home:{},family:{},projects:[{id:"bathroom",name:"Bathroom",tasks:[],materials:[]}],
  shopping:[],tools:[],maintenance:[],calendar:[],aiChats:{bathroom:[{role:"user",content:"Shower"}]}};
let stored = JSON.stringify(phone),savedCloud,reloaded=false,preserved=false;
let savedPhotoPath;
const elements = {
  householdReviewPanel:{hidden:true},householdStatus:{textContent:""},
  householdReviewSummary:{textContent:""},householdConflictChoice:{value:"local"}
};
const client = {
  auth:{onAuthStateChange:() => {}},
  from:() => ({select:() => ({eq:() => ({single:async () =>
    ({data:{revision:2,snapshot:shared}})})})}),
  rpc:async (name,args) => {assert.equal(name,"list_save_snapshot");savedCloud = args;return {error:null};},
  storage:{from:() => ({
    upload:async path => {savedPhotoPath = path;return {error:null};},
    download:async () => ({data:new Blob(["image"],{type:"image/jpeg"}),error:null})
  })}
};
const context = vm.createContext({
  window:{supabase:{createClient:() => client}},document:{getElementById:id => elements[id]},
  localStorage:{getItem:() => stored,setItem:(_,value) => {stored=value;}},
  location:{reload:() => {reloaded=true;}},confirm:() => true,
  STORAGE_KEY:"theListDataV2",defaultData:{...phone,projects:[],aiChats:{}},
  parseStoredData:JSON.parse,serializeStoredData:JSON.stringify,
  hasRecoveryContent:() => true,saveRecoverySnapshot:async () => {preserved=true;return true;},
  validateBackup:raw => raw.data,structuredClone,JSON,Map,Set,Date,Promise,
  crypto:require("node:crypto").webcrypto,fetch,Blob,
  FileReader:class {
    readAsDataURL(){this.result="data:image/jpeg;base64,aW1hZ2U=";this.onload();}
  }
});
vm.runInContext(source,context);

(async () => {
  const combined = context.householdMerge(phone,shared,"local");
  assert.equal(combined.projects.map(project => project.name).join(","),"Bathroom,Kitchen");
  assert.equal(Object.keys(combined.aiChats).length,2);
  const overlapping = {...shared,projects:[{id:"kitchen",name:"Old kitchen",tasks:[{id:"sink",text:"Replace sink"}],materials:[]}]};
  const chosen = context.householdMerge(phone,overlapping,"local");
  assert.equal(chosen.projects[0].name,"Kitchen");
  assert.equal(chosen.projects[0].tasks.length,2,"unique tasks survive edits to the same project");
  const originalPhoto = "data:image/jpeg;base64,aW1hZ2U=";
  const withPhoto = {...phone,projects:[{...phone.projects[0],roomPhotos:[originalPhoto,originalPhoto]}]};
  const packed = await context.householdPreparePhotos(withPhoto,"a1234567-1234-1234-1234-123456789abc");
  assert.match(savedPhotoPath,/^[0-9a-f-]{36}\/[0-9a-f]{64}\.jpg$/);
  assert.equal(packed.projects[0].roomPhotos[0],packed.projects[0].roomPhotos[1]);
  assert.ok(packed.projects[0].roomPhotos[0].startsWith("the-list-cloud-photo:v1:"));
  const unpacked = await context.householdExpandPhotos(packed);
  assert.equal(unpacked.projects[0].roomPhotos[0],originalPhoto);
  vm.runInContext("householdCurrent={id:'house-id',name:'Home'}",context);
  await context.householdReview();
  assert.equal(elements.householdReviewPanel.hidden,false);
  assert.equal(JSON.parse(stored).projects.length,1,"review must not replace phone data");
  await context.householdApplyReview();
  assert.equal(savedCloud.p_revision,2,"save must require the reviewed revision");
  assert.equal(savedCloud.p_snapshot.projects.length,2);
  assert.equal(preserved,true,"prior phone data must be preserved before replacement");
  assert.equal(JSON.parse(stored).projects.length,2);
  assert.equal(reloaded,true);
  console.log("Two-phone review, merge, revision check, and local preservation passed.");
})().catch(error => {console.error(error);process.exitCode = 1;});
