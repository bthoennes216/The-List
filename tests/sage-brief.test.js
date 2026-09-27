// Run with: node tests/sage-brief.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
const storage = script.slice(script.indexOf("function serializeStoredData("),
  script.indexOf("/* =========================================================\n   BACKUP / RESTORE"));
const memory = script.slice(script.indexOf("function sageRoomPhoto("),
  script.indexOf("function renderChatInline("));
const saveBrief = script.slice(script.indexOf("function saveSageBrief("),
  script.indexOf("async function addProjectPhotos("));
const send = script.slice(script.indexOf("async function sendAIChat(){"),
  script.indexOf("async function sendSagePhoto("));
const photoA = "data:image/jpeg;base64," + "a".repeat(200);
const photoB = "data:image/jpeg;base64," + "b".repeat(200);
const project = {id:"kitchen",name:"Kitchen",roomPhotos:[photoA,photoB],tasks:[]};
const data = {projects:[project],aiChats:{kitchen:[]},sageActiveThread:"kitchen"};
const elements = {
  sageBriefChoices:{value:"forest-green cabinets and dark butcher-block counters"},
  sageBriefMeasurements:{value:"Budget $3,000"},
  sageBriefKeep:{value:"Keep the sink and existing layout"},
  sageBriefPhoto:{value:"0"},sageBriefStatus:{textContent:""},
  aiMessageInput:{value:"What should I do first?",disabled:false},
  aiChatStatus:{textContent:""},aiSendButton:{disabled:false},
  aiProjectSelect:{disabled:false},
  aiMessages:{innerHTML:"",classList:{remove(){}},insertAdjacentHTML(){}}
};
let saved,request;
const context = vm.createContext({
  data,STORAGE_KEY:"theListDataV2",STORED_IMAGE_PREFIX:"the-list-image-ref:v1:",
  STORED_IMAGE_POOL:"theListImagePoolV1",Map,JSON,
  localStorage:{setItem:(_,value) => {saved = value;}},
  document:{getElementById:id => elements[id]},
  aiBusy:false,aiImageBusy:false,aiPlanningBusy:false,
  sagePendingPhoto:null,aiThreadKey:() => "kitchen",
  selectedAIProject:() => project,aiThread:() => data.aiChats.kitchen,
  renderAIMessage:() => "",resizeSageInput:() => {},scrollToSageLatest:() => {},
  renderAIChat:() => {},sageSupportsPhotoChat:async () => false,
  AI_BACKEND_URL:"https://example.test",fetch:async (_,options) => {
    request = JSON.parse(options.body);
    return {ok:true,json:async () => ({ok:true,reply:"First measure the cabinet doors."})};
  }
});
vm.runInContext(`${storage}\n${memory}\n${saveBrief}\n${send}`,context);

(async () => {
  vm.runInContext("saveSageBrief('kitchen')",context);
  assert.match(elements.sageBriefStatus.textContent,/Saved/);
  assert.equal(vm.runInContext("sageRoomPhoto([],data.projects[0])",context),photoA);
  assert.equal(vm.runInContext("sageRoomPhoto([{role:'user',images:[data.projects[0].roomPhotos[1]]}],data.projects[0])",context),photoA,
    "selected reference photo remains stable across later chat photos");
  await vm.runInContext("sendAIChat()",context);
  assert.match(request.history[0].content,/forest-green cabinets/);
  assert.match(request.history[0].content,/Keep the sink/);
  assert.match(request.project.sageBrief,/Budget \$3,000/);
  assert.equal(data.aiChats.kitchen.length,2);
  assert.equal(vm.runInContext("parseStoredData",context)(saved).projects[0].sageBrief.photoIndex,0);
  delete project.sageBrief;
  assert.equal(vm.runInContext("sageRoomPhoto([],data.projects[0])",context),photoB,
    "older projects still use their latest project photo");
  console.log("Project brief saves, persists, and reaches Sage with the chosen photo.");
})().catch(error => {console.error(error);process.exitCode = 1;});
