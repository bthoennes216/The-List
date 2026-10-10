/* Portable ChatGPT project import. No account connection or AI request required. */
(function(root){
  'use strict';
  const MAX_BYTES = 1024 * 1024;
  const text = (value, max=12000) => {
    if(value == null) return '';
    if(!['string','number'].includes(typeof value)) throw new Error('Project fields must contain text or numbers.');
    const result = String(value).trim();
    if(result.length > max) throw new Error('A project field is too long. Split this into smaller projects.');
    return result;
  };
  const rows = value => {
    if(value == null) return [];
    if(!Array.isArray(value) || value.length > 300) throw new Error('Project lists must be arrays with at most 300 items.');
    return value;
  };
  const object = value => {
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each project item must be an object.');
    return value;
  };
  const money = value => {
    if(value == null || value === '') return 0;
    if(!['string','number'].includes(typeof value)) throw new Error('Costs must be nonnegative numbers.');
    const n = Number(value);
    if(!Number.isFinite(n) || n < 0 || n > 100000000) throw new Error('Costs must be nonnegative numbers.');
    return n;
  };
  const date = value => {
    const s = text(value,10);
    if(s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s)) throw new Error('Task dates must use YYYY-MM-DD.');
    return s;
  };
  function parseProject(raw){
    if(typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('Choose a project JSON file smaller than 1 MB.');
    const clean = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1');
    let input;
    try{input = JSON.parse(clean);}catch{throw new Error('This is not project JSON. Use Copy export prompt, ask ChatGPT for the project file, then import its JSON response.');}
    object(input);
    if(input.format && input.format !== 'the-list-project') throw new Error('This file is not a The List project export.');
    if(input.version != null && input.version !== 1) throw new Error('This project uses an unsupported export version. Request version 1.');
    if(input.projects) throw new Error('This is a whole-app backup. Use Restore a backup in More instead.');
    const p = object(input.project || input);
    const name = text(p.name || p.projectName,100);
    if(!name) throw new Error('The project needs a name.');
    const steps = rows(p.buildSteps).map((row,i) => {
      object(row);
      const title=text(row.title,500), instructions=text(row.instructions);
      if(!title && !instructions) throw new Error('Each build step needs a title or instructions.');
      return {step:i+1,title:title || `Step ${i+1}`,instructions,safety:text(row.safety)};
    });
    const tasks = rows(p.tasks || p.projectTasks || steps).map(row => {
      if(typeof row === 'string') row={text:row};
      object(row);
      const label=text(row.text || row.title,4000);
      if(!label) throw new Error('Each task needs text or a title.');
      const description=text(row.description,4000);
      return {text:label + (description ? ` — ${description}` : ''),done:false,dueDate:date(row.dueDate),source:'chatgptImport'};
    });
    const materials = rows(p.materials).map(row => {
      if(typeof row === 'string') row={name:row};
      object(row);
      const name=text(row.name || row.item,500);
      if(!name) throw new Error('Each material needs a name.');
      return {name,quantity:[text(row.quantity,500),text(row.specification,1000),text(row.notes,2000)].filter(Boolean).join(' — '),estimatedCost:money(row.estimatedCost),source:'chatgptImport'};
    });
    const tools = rows(p.tools || p.toolsNeeded).map(row => {
      if(typeof row === 'string') row={tool:row};
      object(row);
      const tool=text(row.tool || row.name,500);
      if(!tool) throw new Error('Each tool needs a name.');
      return {tool,reason:text(row.reason,2000),required:row.required !== false};
    });
    const cutList = rows(p.cutList).map(row => {
      object(row);
      const piece=text(row.piece,500);
      if(!piece) throw new Error('Each cut needs a piece name.');
      return {piece,quantity:text(row.quantity,500),dimensions:text(row.dimensions,1000),material:text(row.material,500),notes:text(row.notes,2000)};
    });
    const measurementsNeeded=rows(p.measurementsNeeded).map(row=>{
      if(typeof row === 'string') row={name:row};
      object(row);
      const name=text(row.name,500);
      if(!name) throw new Error('Each measurement needs a name.');
      return {name,whyNeeded:text(row.whyNeeded,2000)};
    });
    const description=text(p.description || p.summary);
    const notes=text(p.notes,30000);
    const warnings=rows(p.warnings).map(row=>text(row,4000));
    return {name,category:text(p.category,100) || 'Home',description,notes,tasks,materials,budget:money(p.budget),
      aiPlan:{projectName:name,summary:description,toolsNeeded:tools,toolsAlreadyHave:[],cutList,buildSteps:steps,
        measurementsNeeded,warnings,materials:materials.map(m=>({item:m.name,quantity:m.quantity})),shoppingList:[]}};
  }
  const example={format:'the-list-project',version:1,project:{name:'Project name',description:'Summary and confirmed measurements',category:'Home',budget:0,notes:'Assumptions and details',tasks:[{text:'Task',dueDate:''}],materials:[{name:'Material',quantity:'Amount and unit',estimatedCost:0}],tools:[{tool:'Tool',required:true,reason:'Why needed'}],cutList:[{piece:'Part',quantity:'1',dimensions:'Confirmed size, or To confirm',material:'Material',notes:''}],buildSteps:[{title:'Step title',instructions:'Instructions',safety:''}],measurementsNeeded:[{name:'Measurement to confirm',whyNeeded:'Reason'}],warnings:[]}};
  function exportPrompt(){
    return 'Convert the project we created in this conversation into a downloadable JSON file for The List app. Return ONLY valid JSON matching this version 1 structure, or provide the JSON in a single json code block if a file is unavailable. Preserve confirmed dimensions and quantities; mark unknowns as To confirm. estimatedCost means the total line cost, not unit price, in USD; use 0 when unknown and state that in notes. budget is the estimated total in USD, not money already spent. Include no invented dates, images, or account information. Keep each list below 300 items. Replace all example values and use empty arrays for sections that do not apply.\n\n'+JSON.stringify(example,null,2);
  }
  root.TheListProjectImport={parseProject,exportPrompt,MAX_BYTES};
  if(typeof module !== 'undefined' && module.exports) module.exports=root.TheListProjectImport;
})(typeof window !== 'undefined' ? window : globalThis);

if(typeof document !== 'undefined'){
  let importDraft=null,importBusy=false,importRead=0;
  const field=id=>document.getElementById(id);
  window.openProjectImport=function(){
    if(importBusy) return;
    importDraft=null;importRead++;
    field('projectImportText').value='';field('projectImportFile').value='';
    field('projectImportPreview').innerHTML='';field('projectImportSave').hidden=true;
    field('projectImportStatus').textContent='';field('projectImportDialog').showModal();
  };
  window.closeProjectImport=function(){if(!importBusy){importRead++;field('projectImportDialog').close();}};
  field('projectImportDialog').addEventListener('cancel',event=>{if(importBusy) event.preventDefault();else importRead++;});
  window.copyProjectExportPrompt=async function(){
    const prompt=TheListProjectImport.exportPrompt();
    try{await navigator.clipboard.writeText(prompt);field('projectImportStatus').textContent='Prompt copied. Paste it into the ChatGPT conversation where you planned the project.';}
    catch{field('projectImportPrompt').hidden=false;field('projectImportPrompt').value=prompt;field('projectImportPrompt').select();field('projectImportStatus').textContent='Select and copy the export prompt below.';}
  };
  window.invalidateProjectImport=function(){
    if(importBusy) return;
    importRead++;importDraft=null;field('projectImportPreview').innerHTML='';field('projectImportSave').hidden=true;
  };
  window.readProjectImportFile=async function(input){
    invalidateProjectImport();const token=importRead,file=input.files[0];if(!file)return;
    try{
      if(file.size>TheListProjectImport.MAX_BYTES)throw new Error('Choose a project JSON file smaller than 1 MB.');
      const raw=await file.text();if(token!==importRead)return;
      field('projectImportText').value=raw;previewProjectImport();
    }catch(error){if(token===importRead)field('projectImportStatus').textContent=error.message;}
  };
  window.previewProjectImport=function(){
    invalidateProjectImport();
    try{
      importDraft=TheListProjectImport.parseProject(field('projectImportText').value);
      const p=importDraft,plan=p.aiPlan;
      const list=(title,items)=>items.length?`<details><summary>${title} (${items.length})</summary><ul>${items.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul></details>`:'';
      field('projectImportPreview').innerHTML=`<h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.description)}</p><p>${escapeHTML(p.category)} · ${p.budget?`Estimated budget: $${p.budget.toFixed(2)}`:'Budget not provided'}</p>`+
        list('Tasks',p.tasks.map(t=>t.text+(t.dueDate?` · Due ${t.dueDate}`:'')))+
        list('Materials',p.materials.map(m=>`${m.name}: ${m.quantity || 'Amount to confirm'}${m.estimatedCost?` · $${m.estimatedCost.toFixed(2)}`:''}`))+
        list('Tools',plan.toolsNeeded.map(t=>`${t.tool}${data.tools.some(owned=>toolKey(owned.name)===toolKey(t.tool))?' · Have tool':' · Check inventory'}`))+
        list('Cut list',plan.cutList.map(c=>`${c.quantity} × ${c.piece}: ${c.dimensions} (${c.material}) ${c.notes}`))+
        list('Build instructions',plan.buildSteps.map(s=>`${s.title}: ${s.instructions}${s.safety?' — '+s.safety:''}`))+
        list('Measurements to check',plan.measurementsNeeded.map(m=>`${m.name}: ${m.whyNeeded}`))+
        list('Before you begin',plan.warnings)+(p.notes?`<details><summary>Notes</summary><p style="white-space:pre-wrap">${escapeHTML(p.notes)}</p></details>`:'');
      const duplicate=data.projects.some(old=>toolKey(old.name)===toolKey(p.name));
      field('projectImportStatus').textContent=duplicate?'A project with this name already exists. Saving creates a separate new project.':'Review the details. Saving creates a new project; you can add materials to Shopping and attach pictures or PDFs afterward.';
      field('projectImportSave').hidden=false;
    }catch(error){field('projectImportStatus').textContent=error.message;}
  };
  window.saveImportedProject=async function(){
    if(!importDraft || importBusy)return;
    importBusy=true;
    const controls=Array.from(field('projectImportDialog').querySelectorAll('button,input,textarea'));
    controls.forEach(control=>control.disabled=true);
    const project={...importDraft,id:`project-${crypto.randomUUID()}`,status:'planned',startedAt:'',completedAt:'',records:[],roomPhotos:[],aiImage:'',importedFrom:'ChatGPT',importedAt:new Date().toISOString()};
    const next=JSON.parse(JSON.stringify(data));
    next.projects.push(project);
    try{
      await persistLocalSnapshot(next);
      data=next;importDraft=null;
      if(typeof window.queueCloudSync==='function')window.queueCloudSync();
      field('projectImportDialog').close();
      setProjectFilter('all');openProject(project.id);
    }catch(error){field('projectImportStatus').textContent='Could not save this project. Your existing projects have not changed. Please try again.';}
    finally{importBusy=false;controls.forEach(control=>control.disabled=false);}
  };
}
