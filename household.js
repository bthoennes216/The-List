/* Household sync is opt-in. Configure these PUBLIC client settings after creating the
   Supabase project described in HOUSEHOLD_SETUP.md. Never put a service-role key here. */
const HOUSEHOLD_SUPABASE_URL = "";
const HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY = "";
const householdClient = HOUSEHOLD_SUPABASE_URL && HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY && window.supabase
  ? window.supabase.createClient(HOUSEHOLD_SUPABASE_URL,HOUSEHOLD_SUPABASE_PUBLISHABLE_KEY)
  : null;
const HOUSEHOLD_PHOTO_BUCKET = "list-project-photos";
const HOUSEHOLD_PHOTO_PREFIX = "the-list-cloud-photo:v1:";
let householdUser = null;
let householdCurrent = null;
let householdReviewState = null;
let householdRefreshBusy = false;

function householdStatus(message){document.getElementById("householdStatus").textContent = message;}
function householdLocalChange(){
  if(householdCurrent) document.getElementById("householdSyncState").textContent =
    "This phone has changes. Review them before saving to your household.";
  householdReviewState = null;
  document.getElementById("householdReviewPanel").hidden = true;
}
async function householdRender(){
  const signIn = document.getElementById("householdSignIn");
  const signed = document.getElementById("householdSignedIn");
  if(!householdClient){
    signIn.hidden = true;signed.hidden = true;
    householdStatus("Household sign-in is being set up. Projects on this phone remain available.");
    return;
  }
  if(householdRefreshBusy) return;
  householdRefreshBusy = true;
  try{
    const {data:auth,error} = await householdClient.auth.getUser();
    if(error && !/session missing/i.test(error.message || "")) throw error;
    householdUser = auth?.user || null;
    signIn.hidden = !!householdUser;
    signed.hidden = !householdUser;
    if(!householdUser){householdCurrent = null;householdStatus("Sign in to set up sharing.");return;}
    document.getElementById("householdSignedEmail").textContent = householdUser.email || "your account";
    const {data:members,error:memberError} = await householdClient.from("list_household_members")
      .select("household_id,joined_at").eq("user_id",householdUser.id)
      .order("joined_at",{ascending:false}).limit(1);
    if(memberError) throw memberError;
    const id = members?.[0]?.household_id;
    if(id){
      const {data:home,error:homeError} = await householdClient.from("list_households")
        .select("id,name,invite_code").eq("id",id).single();
      if(homeError) throw homeError;
      householdCurrent = home;
    }else householdCurrent = null;
    document.getElementById("householdChoose").hidden = !!householdCurrent;
    document.getElementById("householdConnected").hidden = !householdCurrent;
    if(householdCurrent){
      document.getElementById("householdName").textContent = householdCurrent.name;
      document.getElementById("householdCode").value = householdCurrent.invite_code;
      document.getElementById("householdSyncState").textContent = "Projects stay on this phone until you review and sync.";
    }
    householdStatus(householdCurrent ? "Signed in and connected to a household." : "Signed in. Create or join a household.");
  }catch(error){householdStatus(`Could not load your household. ${error.message || "Try again."}`);}
  finally{householdRefreshBusy = false;}
}
async function householdSignIn(){
  if(!householdClient) return;
  const email = document.getElementById("householdEmail").value.trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){householdStatus("Enter a valid email address.");return;}
  householdStatus("Sending your sign-in link…");
  const {error} = await householdClient.auth.signInWithOtp({email,
    options:{emailRedirectTo:location.origin+location.pathname}});
  householdStatus(error ? `Could not send the link. ${error.message}` : "Check your email, then open the link on this phone.");
}
async function householdSignOut(){
  if(!householdClient) return;
  const {error} = await householdClient.auth.signOut();
  if(error){householdStatus(error.message);return;}
  householdCurrent = null;householdUser = null;householdReviewState = null;
  householdRender();
}
async function householdCreate(){
  householdStatus("Creating your household…");
  const {error} = await householdClient.rpc("list_create_household",{p_name:"Our home"});
  if(error){householdStatus(`Could not create a household. ${error.message}`);return;}
  householdRender();
}
async function householdJoin(){
  const code = document.getElementById("householdJoinCode").value.trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)){
    householdStatus("Enter the invitation code from the other phone.");return;
  }
  householdStatus("Joining your household…");
  const {error} = await householdClient.rpc("list_join_household",{p_code:code});
  if(error){householdStatus(`Could not join. ${error.message}`);return;}
  document.getElementById("householdJoinCode").value = "";
  householdRender();
}

// Merge records by stable ID. Different IDs survive; the homeowner chooses how to
// resolve edits to the same record. Tasks and materials within a project are combined.
function householdMergeRows(phone=[],shared=[],prefer="local",projects=false){
  const result = [...shared];
  const keys = new Map(result.map((row,index) => [householdRowKey(row),index]));
  for(const row of phone){
    const key = householdRowKey(row);
    if(!keys.has(key)){keys.set(key,result.length);result.push(row);continue;}
    const index = keys.get(key);
    const previous = result[index];
    if(JSON.stringify(previous) === JSON.stringify(row)) continue;
    const chosen = prefer === "local" ? row : previous;
    result[index] = projects ? {...chosen,
      tasks:householdMergeRows(row.tasks || [],previous.tasks || [],prefer),
      materials:householdMergeRows(row.materials || [],previous.materials || [],prefer)} : chosen;
  }
  return result;
}
function householdRowKey(row){
  return row?.id == null ? "content:"+JSON.stringify(row) : "id:"+String(row.id);
}
function householdMerge(phone,shared,prefer="local"){
  const merged = JSON.parse(JSON.stringify(prefer === "local" ? {...shared,...phone} : {...phone,...shared}));
  for(const field of ["projects","shopping","tools","maintenance","calendar"])
    merged[field] = householdMergeRows(phone[field] || [],shared[field] || [],prefer,field === "projects");
  merged.aiChats = {...(shared.aiChats || {})};
  for(const [key,thread] of Object.entries(phone.aiChats || {})){
    if(!merged.aiChats[key] || prefer === "local") merged.aiChats[key] = thread;
  }
  const selected = prefer === "local" ? phone : shared;
  merged.home = Object.values(selected.home || {}).some(Boolean) ? selected.home :
    (prefer === "local" ? shared.home : phone.home) || {};
  merged.family = Object.values(selected.family || {}).some(Boolean) ? selected.family :
    (prefer === "local" ? shared.family : phone.family) || {};
  return merged;
}
function householdConflictCount(phone,shared){
  const sharedProjects = new Map((shared.projects || []).map(item => [householdRowKey(item),item]));
  let count = (phone.projects || []).filter(item => sharedProjects.has(householdRowKey(item)) &&
    JSON.stringify(sharedProjects.get(householdRowKey(item))) !== JSON.stringify(item)).length;
  for(const [key,thread] of Object.entries(phone.aiChats || {}))
    if(shared.aiChats?.[key] && JSON.stringify(shared.aiChats[key]) !== JSON.stringify(thread)) count++;
  return count;
}
async function householdFetchShared(){
  const {data:row,error} = await householdClient.from("list_household_snapshots")
    .select("revision,snapshot").eq("household_id",householdCurrent.id).single();
  if(error) throw error;
  const shared = row.snapshot ? await householdExpandPhotos(row.snapshot) : structuredClone(defaultData);
  validateBackup({app:"The List",formatVersion:1,data:shared});
  return {revision:row.revision,shared};
}
async function householdReview(){
  if(!householdCurrent) return;
  householdReviewState = null;
  document.getElementById("householdReviewPanel").hidden = true;
  householdStatus("Checking the shared household…");
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const phone = raw ? parseStoredData(raw) : structuredClone(defaultData);
    validateBackup({app:"The List",formatVersion:1,data:phone});
    const {revision,shared} = await householdFetchShared();
    householdReviewState = {raw,phone,shared,revision,householdId:householdCurrent.id};
    const conflicts = householdConflictCount(phone,shared);
    document.getElementById("householdReviewSummary").textContent =
      `This phone: ${phone.projects.length} projects. Shared household: ${shared.projects.length} projects. `+
      `${conflicts} overlapping project or conversation${conflicts === 1 ? "" : "s"} need your choice.`;
    document.getElementById("householdReviewPanel").hidden = false;
    householdStatus("Review the two copies before making any change.");
  }catch(error){householdStatus(`Could not review the shared household. ${error.message || "Try again."}`);}
}
async function householdPreservePhone(raw){
  if(!raw || !hasRecoveryContent(raw)) return;
  if(!await saveRecoverySnapshot(raw,true)) throw new Error("Could not save a recovery copy. Download a backup of this phone first.");
}
async function householdApplyReview(){
  const review = householdReviewState;
  if(!review || review.householdId !== householdCurrent?.id) return;
  if(localStorage.getItem(STORAGE_KEY) !== review.raw){
    householdStatus("This phone changed since the review. Review it again before saving.");return;
  }
  const prefer = document.getElementById("householdConflictChoice").value;
  const merged = householdMerge(review.phone,review.shared,prefer);
  if(!confirm("Save the reviewed projects to your shared household and this phone?")) return;
  householdStatus("Saving photos and projects to your household…");
  try{
    await householdPreservePhone(review.raw);
    // Serialize locally before the network write so a full phone never silently loses data.
    const localCopy = serializeStoredData(merged);
    const cloudCopy = await householdPreparePhotos(merged,review.householdId);
    const {error} = await householdClient.rpc("list_save_snapshot",{
      p_household:review.householdId,p_revision:review.revision,p_snapshot:cloudCopy});
    if(error) throw error;
    localStorage.setItem(STORAGE_KEY,localCopy);
    location.reload();
  }catch(error){householdStatus(`Nothing on this phone was replaced. ${error.message || "Try reviewing again."}`);}
}
async function householdLoadOnly(){
  const review = householdReviewState;
  if(!review || review.householdId !== householdCurrent?.id) return;
  if(localStorage.getItem(STORAGE_KEY) !== review.raw){householdStatus("Review again: this phone changed.");return;}
  if(!confirm("Replace this phone's projects with the shared copy? Your current phone data will first be kept as a recovery copy.")) return;
  householdStatus("Checking the latest shared copy…");
  try{
    const newest = await householdFetchShared();
    if(newest.revision !== review.revision) throw new Error("The shared household changed. Review again.");
    await householdPreservePhone(review.raw);
    localStorage.setItem(STORAGE_KEY,serializeStoredData(newest.shared));
    location.reload();
  }catch(error){householdStatus(`This phone was not replaced. ${error.message || "Try again."}`);}
}

async function householdPreparePhotos(snapshot,householdId){
  const originals = new Map();
  JSON.stringify(snapshot,(_,value) => {
    if(typeof value === "string" && value.startsWith("data:image/")) originals.set(value,null);
    return value;
  });
  for(const image of originals.keys()){
    const match = /^data:image\/(jpeg|png|webp);base64,/i.exec(image);
    if(!match) throw new Error("A photo format cannot be synced yet. Keep a downloaded backup.");
    const blob = await (await fetch(image)).blob();
    const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,"0")).join("");
    const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const path = `${householdId}/${hash}.${extension}`;
    const {error} = await householdClient.storage.from(HOUSEHOLD_PHOTO_BUCKET)
      .upload(path,blob,{contentType:blob.type || `image/${match[1]}`,upsert:false});
    if(error && Number(error.statusCode || error.status) !== 409 && !/already exists/i.test(error.message || "")) throw error;
    originals.set(image,HOUSEHOLD_PHOTO_PREFIX + path);
  }
  return JSON.parse(JSON.stringify(snapshot,(_,value) =>
    typeof value === "string" && originals.has(value) ? originals.get(value) : value));
}
async function householdExpandPhotos(snapshot){
  const photoPaths = new Set();
  JSON.stringify(snapshot,(_,value) => {
    if(typeof value === "string" && value.startsWith(HOUSEHOLD_PHOTO_PREFIX))
      photoPaths.add(value.slice(HOUSEHOLD_PHOTO_PREFIX.length));
    return value;
  });
  const photos = new Map();
  for(const path of photoPaths){
    if(!/^[0-9a-f-]{36}\/[0-9a-f]{64}\.(jpg|png|webp)$/.test(path)) throw new Error("Invalid shared photo path.");
    const {data:blob,error} = await householdClient.storage.from(HOUSEHOLD_PHOTO_BUCKET).download(path);
    if(error) throw error;
    const uri = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    photos.set(HOUSEHOLD_PHOTO_PREFIX + path,uri);
  }
  return JSON.parse(JSON.stringify(snapshot,(_,value) =>
    typeof value === "string" && photos.has(value) ? photos.get(value) : value));
}

if(householdClient){
  householdClient.auth.onAuthStateChange(() => {
    // Let Supabase finish persisting its session before reading household rows.
    setTimeout(() => {if(!document.getElementById("householdPage").classList.contains("hidden")) householdRender();},0);
  });
}
