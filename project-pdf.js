/* Local PDF export: project data never leaves this device. */
(function(){
  'use strict';
  const W=816,H=1056,M=48;
  function text(value){return value == null ? '' : String(value);}
  function list(value){return Array.isArray(value) ? value : [];}
  function pdfBlob(pages){
    const chunks=[],offsets=[0];let size=0;
    const put=value=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;chunks.push(bytes);size+=bytes.length;};
    const obj=(id,body)=>{offsets[id]=size;put(`${id} 0 obj\n`);put(body);put('\nendobj\n');};
    put('%PDF-1.4\n');
    obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
    obj(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
    pages.forEach((canvas,i)=>{
      const id=3+i*3;
      const binary=atob(canvas.toDataURL('image/jpeg',.94).split(',')[1]);
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${i} ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
      offsets[id+1]=size;
      put(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      put(bytes);put('\nendstream\nendobj\n');
      const commands=`q 612 0 0 792 0 0 cm /Im${i} Do Q\n`;
      obj(id+2,`<< /Length ${commands.length} >>\nstream\n${commands}endstream`);
    });
    const start=size;put(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach(n=>put(`${String(n).padStart(10,'0')} 00000 n \n`));
    put(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
    return new Blob(chunks,{type:'application/pdf'});
  }
  async function imageForProject(project){
    const source=project.aiImage || list(project.roomPhotos)[0];
    if(!source || !/^(data:image\/|https?:\/\/|blob:)/i.test(source)) return null;
    return new Promise(resolve=>{
      const image=new Image();image.crossOrigin='anonymous';
      const timer=setTimeout(()=>resolve(null),8000);
      image.onload=()=>{clearTimeout(timer);resolve(image);};
      image.onerror=()=>{clearTimeout(timer);resolve(null);};image.src=source;
    });
  }
  async function buildProjectPDF(project,kind,inventory=[]){
    const overview=kind==='overview',pages=[];let ctx,y;
    function page(){
      const canvas=document.createElement('canvas');canvas.width=W*2;canvas.height=H*2;
      ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#31543d';ctx.fillRect(0,0,W,12);ctx.font='bold 14px Arial';ctx.fillText('THE LIST  /  '+(overview?'DESIGN AT A GLANCE':'DIY PROJECT BINDER'),M,43);
      pages.push(canvas);y=78;
    }
    function lines(value,width,size,bold){
      ctx.font=`${bold?'bold ':''}${size}px Arial`;const result=[];
      text(value).split('\n').forEach(paragraph=>{
        let line='';paragraph.split(/\s+/).forEach(word=>{
          if(!word) return;
          if(ctx.measureText(line+(line?' ':'')+word).width>width && line){result.push(line);line='';}
          while(ctx.measureText(word).width>width){let n=1;while(n<word.length && ctx.measureText(word.slice(0,n+1)).width<=width)n++;if(line){result.push(line);line='';}result.push(word.slice(0,n));word=word.slice(n);}
          line+=(line?' ':'')+word;
        });result.push(line);
      });return result;
    }
    function paragraph(value,{size=14,bold=false,color='#292824',max=Infinity}={}){
      let rows=lines(value,W-2*M,size,bold);
      if(rows.length>max){rows=rows.slice(0,max);rows[rows.length-1]=rows.at(-1).slice(0,-3)+'...';}
      for(const row of rows){if(y+size*1.45>H-62){if(overview)return;page();}ctx.fillStyle=color;ctx.font=`${bold?'bold ':''}${size}px Arial`;ctx.fillText(row,M,y);y+=size*1.45;}y+=7;
    }
    function section(title){if(y>H-115 && !overview)page();y+=9;paragraph(title,{size:18,bold:true,color:'#31543d'});}
    const plan=project.aiPlan || {},brief=project.sageBrief || {};
    page();paragraph(project.name || 'Home project',{size:28,bold:true,max:overview?2:Infinity});
    paragraph('PRELIMINARY - verify measurements and cut sizes before building.',{size:12,color:'#80532c'});
    const image=await imageForProject(project);
    let imageMissing=false;
    if(image){
      const maxH=overview?190:320,scale=Math.min((W-2*M)/image.width,maxH/image.height);
      try{ctx.drawImage(image,M+(W-2*M-image.width*scale)/2,y,image.width*scale,image.height*scale);ctx.getImageData(0,0,1,1);y+=image.height*scale+18;}
      catch{imageMissing=true;page();paragraph(project.name,{size:28,bold:true});paragraph('PRELIMINARY - verify measurements before building.',{size:12});pages.shift();}
    }else imageMissing=Boolean(project.aiImage || list(project.roomPhotos).length);
    paragraph(project.description || plan.summary || 'No design summary saved yet.',{max:overview?3:Infinity});
    section('Design and measurements');
    paragraph(brief.choices || 'Design finishes: not recorded.',{max:overview?2:Infinity});
    paragraph(brief.measurements || 'Site measurements: not recorded.',{max:overview?2:Infinity});
    if(!overview){
      if(brief.keep)paragraph('Keep: '+brief.keep);
      list(plan.recommendedDimensions).forEach(row=>paragraph(`${row.name}: ${row.value}${row.reasoning?' - '+row.reasoning:''}`));
    }
    const missing=list(plan.measurementsNeeded);
    if(missing.length)paragraph('Measurements still needed: '+missing.map(row=>text(row.name || row)).join('; '),{max:overview?2:Infinity,color:'#80532c'});
    section('Budget');
    const spent=list(project.expenses).reduce((sum,row)=>sum+(Number(row.amount)||0),0);
    const money=n=>'$'+Number(n||0).toFixed(2);
    paragraph(`Target: ${project.budget?money(project.budget):'not set'}  |  Spent: ${money(spent)}${project.budget?'  |  Target remaining: '+money(Number(project.budget)-spent):''}`);
    if(project.costEstimate)paragraph(`Sage estimate: ${money(project.costEstimate.low)} - ${money(project.costEstimate.high)}`,{max:overview?1:Infinity});
    if(overview){
      section('Next steps');
      list(project.tasks).filter(row=>!row.done).slice(0,3).forEach(row=>paragraph('• '+text(row.text || row.title),{max:1}));
      paragraph('Full materials, cut list and instructions are in the DIY binder.',{size:11});
    }else{
      if(project.costEstimate?.assumptions)paragraph(project.costEstimate.assumptions);
      section('Materials and shopping checklist');
      const materials=list(project.materials).length?project.materials:list(plan.materials);
      if(!materials.length)paragraph('No materials saved. Ask Sage to organize the project into a plan.');
      materials.forEach(row=>paragraph(`☐ ${row.name || row.item || 'Material'} | Qty: ${row.quantity || 'confirm'}${row.specification?' | '+row.specification:''}${row.estimatedCost?' | Estimate: '+money(row.estimatedCost):''}${row.notes?'\n'+row.notes:''}`));
      section('Tools');
      const tools=list(plan.toolsNeeded);
      if(!tools.length && !list(plan.toolsAlreadyHave).length)paragraph('No tools recorded.');
      const key=v=>text(v).trim().toLowerCase();
      tools.forEach(row=>paragraph(`${row.tool || row} - ${inventory.some(tool=>key(tool.name)===key(row.tool || row))?'Have tool':row.required?'Needed':'Optional'}${row.reason?'\n'+row.reason:''}`));
      list(plan.toolsAlreadyHave).filter(name=>!tools.some(row=>key(row.tool)===key(name))).forEach(name=>paragraph(`${name} - ${inventory.some(tool=>key(tool.name)===key(name))?'Have tool':'Confirm inventory'}`));
      section('Cut list - verify before cutting');
      if(!list(plan.cutList).length)paragraph('No cut list saved. Confirm site measurements with Sage before preparing one.');
      list(plan.cutList).forEach(row=>paragraph(`${row.quantity || '?'} × ${row.piece || 'Piece'}\nSize: ${row.dimensions || 'not specified'} | Material: ${row.material || 'not specified'}${row.notes?'\n'+row.notes:''}`));
      section('Build instructions');
      if(!list(plan.buildSteps).length)paragraph('No detailed build instructions saved yet.');
      list(plan.buildSteps).forEach((row,i)=>{paragraph(`${i+1}. ${row.title || 'Step'}`,{bold:true});paragraph(row.instructions || 'Instructions not recorded.');if(row.safety)paragraph(row.safety,{color:'#80532c'});});
      section('Project task checklist');
      list(project.tasks).forEach(row=>paragraph(`${row.done?'☑':'☐'} ${row.text || row.title || 'Task'}${row.dueDate?' | Due: '+row.dueDate:''}`));
      if(list(plan.warnings).length){section('Before you begin');list(plan.warnings).forEach(row=>paragraph(row));}
      if(project.notes){section('Saved project notes');paragraph(project.notes);}
      if(list(project.records).length){section('Saved product and finish records');list(project.records).forEach(row=>paragraph(Object.entries(row).filter(([key,value])=>key!=='id' && typeof value!=='object').map(([key,value])=>`${key}: ${value}`).join(' | ')));}
    }
    pages.forEach((canvas,i)=>{const c=canvas.getContext('2d');c.save();c.setTransform(2,0,0,2,0,0);c.fillStyle='#756f65';c.font='11px Arial';c.fillText(`The List | ${new Date().toLocaleDateString()} | Preliminary`,M,H-28);c.textAlign='right';c.fillText(`${i+1} / ${pages.length}`,W-M,H-28);c.restore();});
    return {blob:pdfBlob(pages),imageMissing,pages:pages.length};
  }
  let activeURL='',exportBusy=false;
  window.buildProjectPDF=buildProjectPDF;
  window.exportProjectPDF=async function(projectId,kind){
    if(exportBusy)return;
    const project=data.projects.find(row=>String(row.id)===String(projectId));if(!project)return;
    const status=document.getElementById('projectPDFStatus');exportBusy=true;
    status.textContent='Creating your printable PDF…';
    try{
      const result=await buildProjectPDF(project,kind,data.tools || []);
      const name=(project.name || 'Project').replace(/[^a-z0-9_-]+/gi,'_').slice(0,80)+'_'+(kind==='overview'?'Overview':'DIY_Binder')+'.pdf';
      if(activeURL)URL.revokeObjectURL(activeURL);activeURL=URL.createObjectURL(result.blob);
      const link=document.getElementById('projectPDFDownload');link.href=activeURL;link.download=name;link.hidden=false;link.textContent='Open / save PDF';
      const share=document.getElementById('projectPDFShare');const file=new File([result.blob],name,{type:'application/pdf'});
      share.hidden=!navigator.canShare?.({files:[file]});
      share.onclick=async()=>{try{await navigator.share({files:[file],title:project.name});}catch(error){if(error.name!=='AbortError')status.textContent='Use Open / save PDF to save or share this file.';}};
      status.textContent=`${result.pages} ${result.pages===1?'page':'pages'} ready. Open the PDF to print or save it.${result.imageMissing?' The design image could not be included.':''}${kind==='overview'?' The overview is condensed; the binder includes full saved details.':''}`;
    }catch(error){status.textContent='Could not create the PDF. Your project has not changed. Please try again.';console.error(error);}
    finally{exportBusy=false;}
  };
})();
