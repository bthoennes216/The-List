/* The List account and household sync. Local saves always remain the recovery copy. */
(() => {
  "use strict";
  const PROJECT_URL = "https://pllquupnlhzgguvmnxsc.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_iIQLOtnQEK7dpQ575opPFg_DnqWcVvl";
  const LINK_KEY = "theListCloudLinkV1";
  const DIRTY_KEY = "theListCloudDirtyV1";
  const PHOTO_PREFIX = "the-list-cloud-photo:v1:";
  const BUCKET = "the-list-photos";
  let client, user, household, revision = 0, linked = false;
  let pending = 0, timer, writing = false, polling = false;
  const uploaded = new Map(), downloaded = new Map();
  const byId = id => document.getElementById(id);
  const status = message => { byId("accountStatus").textContent = message; };
  const syncStatus = message => { byId("accountSyncStatus").textContent = message; };
  const message = error => error?.message || String(error);
  const hasLocalData = () => {
    try { return hasRecoveryContent(localStorage.getItem(STORAGE_KEY) || ""); }
    catch { return true; }
  };
  function choices(show) { byId("accountDataChoices").hidden = !show; }
  function remember() {
    localStorage.setItem(LINK_KEY,JSON.stringify({householdId:household.id,revision}));
  }
  async function getSnapshot() {
    const {data:row,error} = await client.from("household_snapshots")
      .select("revision,payload").eq("household_id",household.id).single();
    if(error) throw error;
    return row;
  }
  async function loadAccount() {
    linked = false;
    clearTimeout(timer);
    const sessionResult = await client.auth.getSession();
    if(sessionResult.error) throw sessionResult.error;
    if(sessionResult.data.session) {
      const result = await client.auth.getUser();
      if(result.error) throw result.error;
      user = result.data.user;
    } else user = null;
    byId("accountSignedOut").hidden = !!user;
    byId("accountSignedIn").hidden = !user;
    if(!user) { household = null; status("Your projects are saved on this device. Sign in to share them."); return; }
    byId("accountIdentity").textContent = user.email || "Signed in";
    const memberResult = await client.from("household_members")
      .select("household_id").eq("user_id",user.id).maybeSingle();
    if(memberResult.error) throw memberResult.error;
    byId("accountNoHousehold").hidden = !!memberResult.data;
    byId("accountHousehold").hidden = !memberResult.data;
    if(!memberResult.data) { household = null; status("Start a household or enter your partner's invite code."); return; }
    const homeResult = await client.from("households")
      .select("id,owner_user_id").eq("id",memberResult.data.household_id).single();
    if(homeResult.error) throw homeResult.error;
    household = homeResult.data;
    byId("accountOwnerActions").hidden = household.owner_user_id !== user.id;
    const row = await getSnapshot();
    revision = Number(row.revision);
    const saved = JSON.parse(localStorage.getItem(LINK_KEY) || "null");
    const sameHousehold = saved?.householdId === household.id;
    const dirty = localStorage.getItem(DIRTY_KEY) === household.id;
    if(row.payload && !hasLocalData() && !dirty) {
      await useCloud(row);
      return;
    }
    if(sameHousehold && !dirty && row.payload && saved.revision < revision) {
      await useCloud(row);
      return;
    }
    if(sameHousehold && !dirty && saved.revision === revision) {
      linked = true;
      choices(false);
      syncStatus("Your household is synced.");
      status("Signed in.");
      return;
    }
    choices(true);
    syncStatus(row.payload
      ? "Choose which copy to use. Your current device data stays here until you choose."
      : "This household has no shared data yet. Upload this device's data to begin.");
    status("Signed in. Finish setting up your shared household below.");
  }
  function credentials() {
    const email = byId("accountEmail").value.trim();
    const password = byId("accountPassword").value;
    if(!email || !password) throw Error("Enter an email and password.");
    return {email,password};
  }
  async function action(fn) {
    try { status("Working…"); await fn(); }
    catch(error) { status(message(error)); }
  }
  window.accountSignUp = () => action(async () => {
    const {error,data:authData} = await client.auth.signUp({
      ...credentials(),options:{emailRedirectTo:location.origin + location.pathname}
    });
    if(error) throw error;
    if(authData.session) await loadAccount();
    else status("Check your email for the confirmation link, then return here and sign in.");
  });
  window.accountSignIn = () => action(async () => {
    const {error} = await client.auth.signInWithPassword(credentials());
    if(error) throw error;
    await loadAccount();
  });
  window.accountSignOut = () => action(async () => {
    const {error} = await client.auth.signOut();
    if(error) throw error;
    linked = false;
    localStorage.removeItem(LINK_KEY);
    localStorage.removeItem(DIRTY_KEY);
    await loadAccount();
  });
  window.accountCreate = () => action(async () => {
    const {error} = await client.rpc("create_household");
    if(error) throw error;
    await loadAccount();
  });
  window.accountJoin = () => action(async () => {
    const code = byId("accountInviteCode").value.trim();
    if(!code) throw Error("Enter an invite code.");
    const {error} = await client.rpc("join_household",{invite_code:code});
    if(error) throw error;
    byId("accountInviteCode").value = "";
    await loadAccount();
  });
  window.accountInvite = () => action(async () => {
    const {data:code,error} = await client.rpc("create_household_invite");
    if(error) throw error;
    byId("accountInviteResult").textContent =
      "Send this one-time code to your partner. It expires in 24 hours: " + code;
    status("Invite code ready.");
  });
  async function photoToPath(uri) {
    if(uploaded.has(uri)) return uploaded.get(uri);
    const blob = await (await fetch(uri)).blob();
    const extensions = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
    const ext = extensions[blob.type];
    if(!ext || blob.size > 10485760) throw Error("A photo is too large or has an unsupported format. Your local copy is safe.");
    const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,"0")).join("");
    const path = household.id + "/" + hash + "." + ext;
    const {error} = await client.storage.from(BUCKET).upload(path,blob,{contentType:blob.type,upsert:false});
    if(error && String(error.statusCode || error.status) !== "409") throw error;
    uploaded.set(uri,path);
    downloaded.set(path,uri);
    return path;
  }
  async function cloudPayload(snapshot) {
    const compact = JSON.parse(serializeStoredData(snapshot));
    const photos = compact[STORED_IMAGE_POOL] || {};
    for(const id of Object.keys(photos)) {
      photos[id] = PHOTO_PREFIX + await photoToPath(photos[id]);
    }
    const text = JSON.stringify(compact);
    if(text.length > 4000000) throw Error("Your data is too large to sync right now. Your device backup is safe.");
    return compact;
  }
  async function localPayload(payload) {
    const compact = structuredClone(payload);
    const photos = compact[STORED_IMAGE_POOL] || {};
    for(const id of Object.keys(photos)) {
      const value = photos[id];
      if(!value.startsWith(PHOTO_PREFIX)) continue;
      const path = value.slice(PHOTO_PREFIX.length);
      if(!path.startsWith(household.id + "/")) throw Error("Photo belongs to another household.");
      if(!downloaded.has(path)) {
        const {data:blob,error} = await client.storage.from(BUCKET).download(path);
        if(error) throw error;
        const uri = await new Promise((resolve,reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        downloaded.set(path,uri);
        uploaded.set(uri,path);
      }
      photos[id] = downloaded.get(path);
    }
    return parseStoredData(JSON.stringify(compact));
  }
  async function useCloud(row) {
    if(!row) row = await getSnapshot();
    if(!row.payload) throw Error("There is no shared data to load yet.");
    syncStatus("Loading shared data and photos…");
    const next = await localPayload(row.payload);
    if(hasLocalData()) await saveRecoverySnapshot(localStorage.getItem(STORAGE_KEY),true);
    localStorage.setItem(STORAGE_KEY,serializeStoredData(next));
    revision = Number(row.revision);
    remember();
    localStorage.removeItem(DIRTY_KEY);
    location.reload();
  }
  window.accountUseCloud = () => action(async () => {
    if(hasLocalData() && !confirm("Use the shared household copy on this device? Your current device copy will be kept in recovery, and you should keep the backup you downloaded.")) {
      status("Your device data was not changed.");return;
    }
    await useCloud();
  });
  window.accountUpload = () => action(async () => {
    const row = await getSnapshot();
    const replacing = !!row.payload;
    if(replacing && !confirm("Replace the shared household copy with this device's data? Changes made on another device may be lost. Keep backups from both devices before continuing.")) {
      status("Shared data was not changed.");return;
    }
    const savedAtStart = localStorage.getItem(STORAGE_KEY);
    const snapshot = structuredClone(data);
    syncStatus("Uploading projects and photos…");
    const payload = await cloudPayload(snapshot);
    const {data:updated,error} = await client.from("household_snapshots")
      .update({payload,revision:Number(row.revision)+1,updated_at:new Date().toISOString()})
      .eq("household_id",household.id).eq("revision",row.revision).select("revision");
    if(error) throw error;
    if(!updated?.length) throw Error("The shared data changed during upload. Try again after reviewing it.");
    revision = Number(updated[0].revision);
    remember();
    localStorage.removeItem(DIRTY_KEY);
    linked = true;
    choices(false);
    syncStatus("Your household is synced.");
    status("Shared data uploaded.");
    if(localStorage.getItem(STORAGE_KEY) !== savedAtStart) window.queueCloudSync();
  });
  window.queueCloudSync = () => {
    if(!linked || !household) return;
    pending++;
    localStorage.setItem(DIRTY_KEY,household.id);
    syncStatus("Saving to household…");
    clearTimeout(timer);
    timer = setTimeout(flush,1200);
  };
  window.pauseCloudSyncForRestore = () => {
    if(!household) return;
    linked = false;
    clearTimeout(timer);
    localStorage.setItem(DIRTY_KEY,household.id);
  };
  async function flush() {
    if(writing || !linked || !household) return;
    writing = true;
    const generation = pending;
    try {
      const snapshot = structuredClone(data);
      const payload = await cloudPayload(snapshot);
      const {data:updated,error} = await client.from("household_snapshots")
        .update({payload,revision:revision+1,updated_at:new Date().toISOString()})
        .eq("household_id",household.id).eq("revision",revision).select("revision");
      if(error) throw error;
      if(!updated?.length) {
        linked = false;
        choices(true);
        syncStatus("Another device changed the shared data. Choose which copy to keep; your edits remain on this device.");
        return;
      }
      revision = Number(updated[0].revision);
      remember();
      if(generation === pending) {
        localStorage.removeItem(DIRTY_KEY);
        syncStatus("Your household is synced.");
      }
    } catch(error) {
      syncStatus("Could not sync: " + message(error) + ". Your edits remain on this device.");
    } finally {
      writing = false;
      if(linked && generation !== pending) { clearTimeout(timer);timer = setTimeout(flush,1200); }
    }
  }
  async function poll() {
    if(polling || !linked || writing || !household) return;
    if(localStorage.getItem(DIRTY_KEY)) { await flush(); return; }
    polling = true;
    try {
      const row = await getSnapshot();
      if(Number(row.revision) !== revision) await useCloud(row);
    } catch(error) {
      syncStatus("Cannot check for updates: " + message(error));
    } finally { polling = false; }
  }
  (async () => {
    try {
      const {createClient} = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm");
      client = createClient(PROJECT_URL,PUBLISHABLE_KEY);
      await loadAccount();
      setInterval(poll,15000);
      document.addEventListener("visibilitychange",() => { if(!document.hidden) poll(); });
    } catch(error) { status("Account connection unavailable: " + message(error)); }
  })();
})();
