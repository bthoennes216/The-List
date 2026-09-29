// Run with: node tests/project-budget-tools.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const script = html.split("<script>",2)[1].split("</script>",1)[0];
const budgetTools = script.slice(script.indexOf("function projectEstimatedMaterials("),
  script.indexOf("function deleteMaterial("));
const escape = script.slice(script.indexOf("function escapeHTML("),
  script.indexOf("/* =========================================================\n   AI CHAT AND CHATGPT HANDOFF"));
const project = {id:"kitchen",name:"Kitchen",budget:500,materials:[{name:"Wood",estimatedCost:125}],
  tasks:[],expenses:[{id:"e1",description:"Wood",amount:80,date:"9/28/2026"}],
  aiPlan:{toolsNeeded:[{tool:"Drill",required:true},{tool:"Saw",required:false}],
    toolsAlreadyHave:["Hammer"]}};
const data = {projects:[project],tools:[{name:"Hammer"}],shopping:[],home:{location:"Palm Coast, Florida"}};
const fields = {
  projectToolList:{innerHTML:""},projectDetail:{dataset:{projectId:"kitchen"}},
  projectExpenseDescription:{value:"Screws"},projectExpenseAmount:{value:"20.25"},
  projectBudgetStatus:{textContent:""},budgetEstimateStatus:{textContent:"",previousElementSibling:{disabled:false}}
};
const budgetBody = {innerHTML:""};
let saved = 0;
const context = vm.createContext({
  data,document:{getElementById:id => fields[id],querySelector:() => budgetBody},
  crypto:{randomUUID:() => "uuid"},Date,JSON,Map,Number,String,Math,
  confirm:() => true,saveData:() => saved++,renderToolsToBuy:() => {},
  addTool:name => {data.tools.push({name});return true;},
  toolKey:name => String(name || "").trim().replace(/\s+/g," ").toLowerCase(),
  fetch:async () => ({ok:true,json:async () => ({ok:true,reply:'{"low":300,"high":500,"assumptions":"DIY materials and missing tools"}'})}),
  AI_BACKEND_URL:"https://example.invalid/"
});
vm.runInContext(`${escape}\n${budgetTools}`,context);

assert.match(context.renderProjectToolRows(project),/I have this/);
assert.doesNotMatch(context.renderProjectToolRows(project),/Hammer.*I have this/s);
context.addProjectToolToShopping("kitchen",0);
assert.equal(data.shopping.length,1);
assert.match(context.renderProjectToolRows(project),/On shopping list/);
context.addProjectToolToInventory("kitchen",0);
assert.equal(data.tools.length,2);
assert.doesNotMatch(context.renderProjectToolRows(project).split("Saw")[0],/Add to Shopping/);

assert.match(context.renderProjectBudget(project),/\$80\.00/);
assert.match(context.renderProjectBudget(project),/\$420\.00/);
context.addProjectExpense("kitchen");
assert.equal(project.expenses[1].amount,20.25);
assert.match(context.renderProjectBudget(project),/\$100\.25/);
assert.match(context.renderProjectBudget(project),/\$399\.75/);

(async () => {
  await context.estimateProjectBudget("kitchen");
  assert.equal(project.costEstimate.low,300);
  assert.equal(project.costEstimate.high,500);
  assert.match(context.renderProjectBudget(project),/\$299\.75/);
  assert.ok(saved >= 3);
  console.log("Project tool actions respect inventory; budget tracks expenses and Sage's range.");
})().catch(error => {console.error(error);process.exitCode = 1;});
