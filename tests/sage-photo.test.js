// Run with: node tests/sage-photo.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
const storage = script.slice(script.indexOf("function serializeStoredData("),
  script.indexOf("/* =========================================================\n   BACKUP / RESTORE"));
const sending = script.slice(script.indexOf("async function sendAIChat(){"),
  script.indexOf("let sageReview = null;"));
const memory = script.slice(script.indexOf("function sageRoomPhoto("),
  script.indexOf("function renderChatInline("));
const original = "data:image/jpeg;base64," + "a".repeat(50000);
const concept = "data:image/jpeg;base64," + "b".repeat(60000);
const input = {value:"Reimagine this bathroom with a walk-in shower",disabled:false};
const sendButton = {disabled:false};
const status = {textContent:""};
const box = {innerHTML:"",classList:{remove:() => {}},insertAdjacentHTML:() => {}};
const project = {id:"bathroom",name:"Bathroom",roomPhotos:[]};
const data = {projects:[project],aiChats:{bathroom:[]},sageActiveThread:"bathroom"};
let saved = "";
let receivedPhoto = false;
let renders = 0;
const context = vm.createContext({
  data,STORAGE_KEY:"theListDataV2",STORED_IMAGE_PREFIX:"the-list-image-ref:v1:",
  STORED_IMAGE_POOL:"theListImagePoolV1",Map,JSON,
  localStorage:{setItem:(key,value) => {saved = value;}},
  document:{getElementById:id => ({aiMessageInput:input,aiChatStatus:status,
    aiMessages:box,aiSendButton:sendButton})[id]},
  aiBusy:false,aiImageBusy:false,aiPlanningBusy:false,
  aiThreadKey:() => "bathroom",selectedAIProject:() => project,
  aiThread:() => data.aiChats.bathroom,
  sageDesignContext:messages => messages.filter(message => message.role === "user")
    .map(message => message.content).join("; "),
  renderAIMessage:() => "",scrollToSageLatest:() => {},
  requestProjectImage:async (prompt,photos) => {
    receivedPhoto = photos.length === 1 && photos[0] === original &&
      prompt.includes("walk-in shower");
    return concept;
  },
  fetch:async () => ({blob:async () => ({})}),
  photoToJpeg:async () => concept,
  removeSagePhoto:() => {vm.runInContext("sagePendingPhoto = null",context);},
  renderAIChat:() => {renders++;}
});
vm.runInContext(`let sagePendingPhoto = {key:"bathroom",image:${JSON.stringify(original)}};
  ${storage}\n${memory}\n${sending}`,context);

// Unit harness omits browser IndexedDB; persistence is exercised by image-storage.browser.js.
context.storeLocalImages = async () => {};

(async () => {
  await vm.runInContext("sendSagePhoto()",context);
  assert.equal(receivedPhoto,true,"the image service must get the homeowner's photo");
  assert.equal(data.aiChats.bathroom.length,2);
  assert.equal(data.aiChats.bathroom[0].images[0],original);
  assert.equal(data.aiChats.bathroom[1].images[0],concept);
  assert.equal(project.roomPhotos[0],original);
  assert.equal(input.value,"");
  assert.equal(sendButton.disabled,false);
  assert.equal(renders,1);
  assert.equal(saved.split(original).length-1,1,"photo shared by chat and project is stored once");
  const reopened = vm.runInContext("parseStoredData",context)(saved);
  assert.equal(reopened.projects[0].roomPhotos[0],original);
  assert.equal(reopened.aiChats.bathroom[1].images[0],concept);
  input.value = "Show the same bathroom with green cabinets";
  await vm.runInContext("sendAIChat()",context);
  assert.equal(data.aiChats.bathroom.length,4);
  assert.equal(data.aiChats.bathroom[2].images,undefined,
    "follow-up messages reuse the earlier photo without attaching it again");
  assert.equal(project.roomPhotos.length,1);
  assert.equal(saved.split(original).length-1,1);
  assert.equal(vm.runInContext("sageRoomPhoto()",context),original);
  assert.equal(vm.runInContext("sageVisualRequest('Show me my kitchen cabinets green')",context),true);
  assert.equal(vm.runInContext("sageVisualRequest('What tools do I need?')",context),false);
  assert.ok(vm.runInContext("sageChatHistory(data.aiChats.bathroom,true)[0].content",context)
    .includes("room photo is saved"));
  console.log("Sage photo generation, project storage, and reload checks passed.");
})().catch(error => {console.error(error);process.exitCode = 1;});
