// Run with: node tests/storage-startup.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
// Execute the actual startup code and storage functions without mounting the UI.
const startup = script.slice(0,script.indexOf("let currentCalendarDate"));
const storage = script.slice(script.indexOf("function serializeStoredData("),
  script.indexOf("/* =========================================================\n   BACKUP / RESTORE"));

function boot(saved){
  let stored = saved;
  let writes = 0;
  const alerts = [];
  const context = vm.createContext({
    localStorage:{getItem:() => stored,setItem:(key,value) => {stored = value;writes++;}},
    structuredClone,alert:message => alerts.push(message),console:{error:() => {}}
  });
  let error;
  try{vm.runInContext(startup + "\n" + storage,context);}
  catch(caught){error = caught;}
  return {context,alerts,error,get stored(){return stored;},get writes(){return writes;}};
}

const photo = "data:image/jpeg;base64," + "a".repeat(800000);
const previous = {
  home:{},family:{note:"Saved"},projects:[{name:"Kitchen",aiImage:photo}],
  aiChats:{general:[{role:"assistant",content:"Plan",images:[photo]}]},
  shopping:[],tools:[],maintenance:[],calendar:[]
};
const legacy = JSON.stringify(previous);
const first = boot(legacy);
assert.equal(first.error,undefined);
assert.equal(first.writes,0,"opening an older save must never rewrite it");
assert.equal(first.stored,legacy);
assert.equal(vm.runInContext("data.projects[0].name",first.context),"Kitchen");
assert.equal(vm.runInContext("data.aiChats.general[0].images[0]",first.context),photo);

// Saving an actual project update converts to the compact format; both views keep the image.
vm.runInContext("data.projects[0].tasks.push({text:'Paint'}); saveData()",first.context);
assert.equal(first.stored.split(photo).length-1,1);
const reopened = boot(first.stored);
assert.equal(reopened.error,undefined);
assert.equal(reopened.writes,0,"opening a compact save must not rewrite it");
assert.equal(vm.runInContext("data.projects[0].tasks[0].text",reopened.context),"Paint");
assert.equal(vm.runInContext("data.projects[0].aiImage",reopened.context),photo);
assert.equal(vm.runInContext("data.aiChats.general[0].images[0]",reopened.context),photo);

const broken = boot("{invalid json");
assert.ok(broken.error,"an unreadable save must stop startup");
assert.equal(broken.writes,0,"an unreadable save must be left untouched");
assert.equal(broken.stored,"{invalid json");
assert.equal(broken.alerts.length,1);

console.log("Storage startup and recovery checks passed.");
