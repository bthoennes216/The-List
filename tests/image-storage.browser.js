// Run with: node tests/image-storage.browser.js (requires Playwright browsers).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {chromium,webkit} = require("playwright");
const root = path.join(__dirname,"..");
const legacyPhoto = "data:image/jpeg;base64," + "a".repeat(900000);
const legacy = JSON.stringify({home:{},family:{note:"Keep this"},
  projects:[{id:"playset",name:"Backyard Play Set",aiImage:legacyPhoto}],
  aiChats:{playset:[{role:"user",content:"Show me a play set"},
    {role:"assistant",content:"A raised platform and swings",images:[legacyPhoto]}]},
  shopping:[],tools:[],calendar:[],maintenance:[],sageActiveThread:"playset"});
const server = http.createServer((req,res) => {
  const file = path.join(root,req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if(!file.startsWith(root) || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader("Content-Type",file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "image/png");
  res.end(fs.readFileSync(file));
});

async function check(browserType,url){
  const browser = await browserType.launch({headless:true});
  try{
    const context = await browser.newContext();
    await context.route("https://**/*",route => route.abort()); // No live AI or account writes.
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror",error => errors.push(error.message));
    await page.addInitScript(saved => {
      if(!localStorage.getItem("image-storage-test-seeded")){
        localStorage.setItem("theListDataV2",saved);
        localStorage.setItem("image-storage-test-seeded","yes");
      }
      // Simulate a localStorage quota that blocks full images but allows photo IDs.
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value){
        if(key === "theListDataV2" && value.length > 10000)
          throw new DOMException("Browser storage quota exceeded","QuotaExceededError");
        return original.call(this,key,value);
      };
    },legacy);
    await page.goto(url);
    await page.evaluate(() => window.appStorageReady);
    const migrated = await page.evaluate(() => ({saved:localStorage.getItem(STORAGE_KEY),
      project:data.projects[0].aiImage,chat:data.aiChats.playset[1].images[0],note:data.family.note}));
    assert.ok(migrated.saved.length < 10000,"large legacy images must leave localStorage");
    assert.ok(migrated.saved.includes("the-list-device-photo:v1:"));
    assert.equal(migrated.project,legacyPhoto);
    assert.equal(migrated.chat,legacyPhoto);
    assert.equal(migrated.note,"Keep this");
    await page.reload();
    await page.evaluate(() => window.appStorageReady);
    assert.equal(await page.evaluate(() => data.projects[0].aiImage),legacyPhoto);

    // Exercise the actual Sage handler with an image-service stub.
    const generated = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");canvas.width=800;canvas.height=800;
      const ctx = canvas.getContext("2d");const pixels=ctx.createImageData(800,800);
      for(let i=0;i<pixels.data.length;i++) pixels.data[i]=i%4===3 ? 255 : Math.random()*255;
      ctx.putImageData(pixels,0,0);
      const image=canvas.toDataURL("image/jpeg",.8);
      requestProjectImage=async () => image;
      showPage("aiChatPage");
      await generateAIChatImage(1);
      return {uri:data.aiChats.playset[1].images.at(-1),status:document.getElementById("aiChatStatus").textContent,
        saved:localStorage.getItem(STORAGE_KEY),portable:serializeStoredData(data)};
    });
    assert.match(generated.status,/Visual idea ready/);
    assert.ok(generated.uri.length > 10000,"the new image would not fit the old save format");
    assert.ok(generated.saved.length < 10000);
    assert.ok(generated.portable.includes(generated.uri),"backups and cloud uploads keep image bytes");
    assert.ok(!generated.portable.includes("the-list-device-photo:v1:"));
    await page.reload();
    await page.evaluate(() => window.appStorageReady);
    assert.equal(await page.evaluate(() => data.aiChats.playset[1].images.at(-1)),generated.uri);

    // Reload from a portable backup as cloud-download and restore both do.
    await page.evaluate(async portable => {
      const restored=parseStoredData(portable);
      await persistLocalSnapshot(restored);
    },generated.portable);
    await page.reload();await page.evaluate(() => window.appStorageReady);
    assert.equal(await page.evaluate(() => data.aiChats.playset[1].images.at(-1)),generated.uri);

    // A new device has no photo cache or IndexedDB records yet.
    const otherDevice = await browser.newContext();
    await otherDevice.route("https://**/*",route => route.abort());
    await otherDevice.addInitScript(portable => {
      if(!localStorage.getItem("theListDataV2")) localStorage.setItem("theListDataV2",portable);
    },generated.portable);
    const otherPage = await otherDevice.newPage();
    await otherPage.goto(url);await otherPage.evaluate(() => window.appStorageReady);
    assert.equal(await otherPage.evaluate(() => data.aiChats.playset[1].images.at(-1)),generated.uri);
    assert.ok((await otherPage.evaluate(() => localStorage.getItem(STORAGE_KEY))).length < 10000);
    await otherDevice.close();

    // An IndexedDB failure must leave the old metadata and image links intact.
    const failed = await page.evaluate(async () => {
      showPage("aiChatPage");
      const before=localStorage.getItem(STORAGE_KEY);
      const original=openImageDB;
      openImageDB=async () => {throw new DOMException("Photo storage quota exceeded","QuotaExceededError");};
      requestProjectImage=async () => data.aiChats.playset[1].images.at(-1);
      photoToJpeg=async () => "data:image/jpeg;base64,failed-image";
      await generateAIChatImage(1);
      openImageDB=original;
      return {before,after:localStorage.getItem(STORAGE_KEY),
        status:document.getElementById("aiChatStatus").textContent};
    });
    assert.equal(failed.after,failed.before);
    assert.match(failed.status,/browser photo storage/);
    assert.doesNotMatch(failed.status,/generation has reached its limit/);

    // Missing photo records must stop startup rather than replace the save with defaults.
    const beforeMissing = await page.evaluate(async () => {
      const saved=localStorage.getItem(STORAGE_KEY);
      const db=await openImageDB();
      await new Promise((resolve,reject) => {
        const tx=db.transaction("images","readwrite");tx.objectStore("images").clear();
        tx.oncomplete=resolve;tx.onerror=reject;
      });
      db.close();return saved;
    });
    page.on("dialog",dialog => dialog.dismiss());
    await page.reload();
    assert.equal(await page.evaluate(() => window.appStorageReady.then(() => false,() => true)),true);
    assert.equal(await page.evaluate(() => localStorage.getItem(STORAGE_KEY)),beforeMissing);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`${browserType.name()}: migration, quota, generation, reload, portable restore, and failed-write checks passed.`);
  }finally{await browser.close();}
}

(async () => {
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  try{
    const engines=process.env.TEST_BROWSER === "chromium" ? [chromium] : [chromium,webkit];
    for(const engine of engines) await check(engine,url);
  }
  finally{await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
