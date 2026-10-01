// Run with: node tests/project-notes.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
const startup = script.slice(0,script.indexOf("let currentCalendarDate"));
const storage = script.slice(script.indexOf("function serializeStoredData("),
  script.indexOf("/* =========================================================\n   BACKUP / RESTORE"));
const notes = script.slice(script.indexOf("function renderProjectDiscussionNotes("),
  script.indexOf("function saveProjectNotes("));
const escape = script.slice(script.indexOf("function escapeHTML("),
  script.indexOf("function escapeAttribute("));
const escapeAttr = script.slice(script.indexOf("function escapeAttribute("),
  script.indexOf("function ",script.indexOf("function escapeAttribute(") + 1));
const original = JSON.stringify({
  home:{},family:{note:"Old family reminder"},
  projects:[{id:"kitchen",name:"Kitchen",notes:"Paint: forest green"}],
  shopping:[],tools:[],maintenance:[],calendar:[]
});
let stored = original;
const elements = {
  newProjectNote:{value:"Measure the <window> before ordering"},
  projectNoteStatus:{textContent:""},
  projectDiscussionNotes:{innerHTML:""}
};
const context = vm.createContext({
  localStorage:{getItem:() => stored,setItem:(_,value) => {stored = value;}},
  document:{getElementById:id => elements[id]},
  window:{accountNoteAuthor:() => "Brandon"},
  crypto:{randomUUID:() => "note-id"},
  Date,console,structuredClone
});
vm.runInContext(`${startup}\n${storage}\ndata = loadData(); ensureProjectStatuses();\n${escape}\n${escapeAttr}\n${notes}`,context);
assert.equal(stored,original,"loading old projects should not rewrite their data");
vm.runInContext("addProjectDiscussionNote('kitchen')",context);
assert.equal(elements.newProjectNote.value,"");
assert.match(elements.projectDiscussionNotes.innerHTML,/Brandon/);
assert.match(elements.projectDiscussionNotes.innerHTML,/&lt;window&gt;/);
assert.doesNotMatch(elements.projectDiscussionNotes.innerHTML,/<window>/);
const saved = JSON.parse(stored);
assert.equal(saved.projects[0].notes,"Paint: forest green","records stay separate from conversation notes");
assert.equal(saved.projects[0].discussionNotes[0].text,"Measure the <window> before ordering");
assert.equal(saved.family.note,"Old family reminder","old household notes remain in backups");
console.log("Project notes remain separate, escape input, and survive storage.");
