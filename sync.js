/* The List account and household sync. Local saves always remain the recovery copy. */
(() => {
  "use strict";
  const PROJECT_URL = "https://pllquupnlhzgguvmnxsc.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_iIQLOtnQEK7dpQ575opPFg_DnqWcVvl";
  const LINK_KEY = "theListCloudLinkV1";
  const INVITE_KEY = "theListPendingInviteV1";
  let outgoingInvite = "", outgoingInviteUser = "", outgoingInviteHome = "", outgoingInviteExpires = 0;
  let incomingInvite = "";
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get("invite");
    if(code && /^[a-zA-Z0-9-]{1,200}$/.test(code)) {
      incomingInvite = code;
      sessionStorage.setItem(INVITE_KEY,code);
    } else incomingInvite = sessionStorage.getItem(INVITE_KEY) || "";
    if(url.searchParams.has("invite")) {
      url.searchParams.delete("invite");
      history.replaceState(history.state,"",url.href);
    }
  } catch {}
  const DIRTY_KEY = "theListCloudDirtyV1";
  let pendingFamilyRow = null, pendingFamilyProjects = [], waitingForFamily = false;
  const PHOTO_PREFIX = "the-list-cloud-photo:v1:";
  const BUCKET = "the-list-photos";
  const FILE_BUCKET = "the-list-files";
  const fileBucket = path => /\.(pdf|docx|txt|md|csv|json)$/.test(path) ? FILE_BUCKET : BUCKET;
  let client, user, household, revision = 0, linked = false;
  let pending = 0, timer, writing = false, polling = false;
  let membersCheckedAt = 0, membersRequest = 0;
  const uploaded = new Map(), downloaded = new Map();
  const byId = id => document.getElementById(id);
  const status = message => { byId("accountStatus").textContent = message; };
  const syncStatus = message => { byId("accountSyncStatus").textContent = message; };
  const message = error => error?.message || String(error);
  window.accountDisplayName = () => typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  const refreshGreeting = () => { if(typeof renderHomeGreeting === "function") renderHomeGreeting(); };
  window.accountNoteAuthor = () => user?.user_metadata?.display_name || user?.email || "On this device";
  const hasLocalData = () => {
    try { return hasRecoveryContent(localStorage.getItem(STORAGE_KEY) || ""); }
    catch { return true; }
  };
  function choices(show) {
    byId("accountDataChoices").hidden = false;
    if(show) byId("accountRecovery").open = true;
  }
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
    membersRequest++;
    byId("accountFamilyMembers").replaceChildren();
    byId("accountFamilyMembersStatus").textContent = "Loading family members…";
    linked = false;
    waitingForFamily = false;
    clearTimeout(timer);
    const sessionResult = await client.auth.getSession();
    if(sessionResult.error) throw sessionResult.error;
    if(sessionResult.data.session) {
      const result = await client.auth.getUser();
      if(result.error) throw result.error;
      user = result.data.user;
    } else user = null;
    refreshGreeting();
    if(outgoingInviteUser !== user?.id) {
      outgoingInvite = "";
      byId("accountInviteShareActions").hidden = true;
      byId("accountInviteResult").textContent = "";
    }
    byId("accountFamilyProjectChoices").hidden = true;
    byId("accountSignedOut").hidden = !!user;
    byId("accountSignedIn").hidden = !user;
    byId("accountPassword").value = "";
    if(!user) {
      membersRequest++;
      byId("accountFamilyMembers").replaceChildren();
      household = null;
      status(incomingInvite ? "You have a family invitation. Sign in or create an account, then tap Join family." : "Your projects are saved on this device. Sign in to share them.");
      return;
    }
    byId("accountIdentity").textContent = user.email || "Signed in";
    byId("accountDisplayName").value = user.user_metadata?.display_name || "";
    const memberResult = await client.from("household_members")
      .select("household_id").eq("user_id",user.id).maybeSingle();
    if(memberResult.error) throw memberResult.error;
    byId("accountNoHousehold").hidden = !!memberResult.data;
    byId("accountHousehold").hidden = !memberResult.data;
    if(!memberResult.data) {
      household = null;
      byId("accountJoinIntro").textContent = incomingInvite ? "Your invitation is ready. Tap Join family to load your shared projects." : "Have an invitation? Enter its code below.";
      status("Signed in. Invite your family or join with an invitation.");
      return;
    }
    const homeResult = await client.from("households")
      .select("id,owner_user_id").eq("id",memberResult.data.household_id).single();
    if(homeResult.error) throw homeResult.error;
    household = homeResult.data;
    await refreshFamilyMembers(true);
    byId("accountOwnerActions").hidden = household.owner_user_id !== user.id;
    const row = await getSnapshot();
    revision = Number(row.revision);
    const saved = JSON.parse(localStorage.getItem(LINK_KEY) || "null");
    const sameHousehold = saved?.householdId === household.id;
    const dirty = localStorage.getItem(DIRTY_KEY) === household.id;
    byId("accountFamilyConnection").textContent = "Connected to your shared household";
    if(!row.payload) {
      if(household.owner_user_id === user.id) { await uploadDevice(false); return; }
      waitingForFamily = true;
      choices(false);
      syncStatus("Connected. Waiting for your partner to share their projects.");
      status("Your family is connected.");
      return;
    }
    if(sameHousehold && dirty) {
      if(saved.revision === revision) {
        linked = true;
        choices(false);
        await flush();
      } else {
        choices(true);
        byId("accountRecovery").open = true;
        syncStatus("Both copies have changes. Review them in Advanced recovery before continuing.");
      }
      return;
    }
    if(sameHousehold && saved.revision === revision) {
      linked = true;
      choices(false);
      syncStatus("Saved");
      status("Your family is connected.");
      return;
    }
    if(!sameHousehold && hasLocalData()) {
      const cloud = await localPayload(row.payload);
      const ids = new Set((cloud.projects || []).map(project => String(project.id)));
      pendingFamilyProjects = (data.projects || []).filter(project => !ids.has(String(project.id)));
      if(pendingFamilyProjects.length) {
        pendingFamilyRow = row;
        byId("accountFamilyProjectChoices").hidden = false;
        byId("accountFamilyProjectNote").textContent = "This phone has " + pendingFamilyProjects.length +
          " additional project(s). Add them to your family, or load the family projects and keep this phone’s copy in recovery.";
        choices(false);
        syncStatus("Choose what to do with this phone’s existing projects.");
        status("Your family is connected. Finish the project choice below.");
        return;
      }
    }
    await useCloud(row);
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
    byId("accountPassword").value = "";
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
  window.accountSaveProfile = () => action(async () => {
    if(!user) throw Error("Sign in to edit your profile.");
    const name = byId("accountDisplayName").value.trim();
    if(!name || name.length > 60) throw Error("Enter a name of up to 60 characters.");
    const {data:result,error} = await client.auth.updateUser({data:{display_name:name}});
    if(error) throw error;
    user = result.user;
    refreshGreeting();
    await refreshFamilyMembers(true);
    status("Name saved.");
  });
  window.accountChangeEmail = () => action(async () => {
    if(!user) throw Error("Sign in to edit your email.");
    const email = byId("accountNewEmail").value.trim();
    if(!email || !byId("accountNewEmail").checkValidity()) throw Error("Enter a valid new email address.");
    if(email.toLowerCase() === user.email?.toLowerCase()) throw Error("That is already your email address.");
    const {error} = await client.auth.updateUser({email},{emailRedirectTo:location.origin + location.pathname});
    if(error) throw error;
    byId("accountNewEmail").value = "";
    status("Check your current and new email inboxes for confirmation links. Your current email remains active until confirmed.");
  });
  window.accountRequestPasswordCode = () => action(async () => {
    if(!user) throw Error("Sign in to change your password.");
    const {error} = await client.auth.reauthenticate();
    if(error) throw error;
    status("Check your email for a verification code, then enter it here with your new password.");
  });
  window.accountChangePassword = () => action(async () => {
    if(!user) throw Error("Sign in to change your password.");
    const password = byId("accountNewPassword").value;
    const confirmPassword = byId("accountConfirmPassword").value;
    if(password.length < 6) throw Error("Use at least 6 characters for your new password.");
    if(password !== confirmPassword) throw Error("The new passwords do not match.");
    const nonce = byId("accountPasswordCode").value.trim();
    const {error} = await client.auth.updateUser(nonce ? {password,nonce} : {password});
    if(error) throw error;
    byId("accountNewPassword").value = "";
    byId("accountConfirmPassword").value = "";
    byId("accountPasswordCode").value = "";
    status("Password changed.");
  });
  window.accountCreate = () => action(async () => {
    const {error} = await client.rpc("create_household");
    if(error) throw error;
    await loadAccount();
    await prepareFamilyInvite();
  });
  window.accountJoin = () => action(async () => {
    const code = byId("accountInviteCode").value.trim();
    if(!code) throw Error("Enter an invite code.");
    const {error} = await client.rpc("join_household",{invite_code:code});
    if(error) throw error;
    byId("accountInviteCode").value = "";
    incomingInvite = "";
    try { sessionStorage.removeItem(INVITE_KEY); } catch {}
    await loadAccount();
  });
  async function prepareFamilyInvite() {
    if(!household || !linked) throw Error("Finish connecting your projects before inviting family.");
    const {data:code,error} = await client.rpc("create_household_invite");
    if(error) throw error;
    outgoingInvite = String(code);
    outgoingInviteUser = user.id;
    outgoingInviteHome = household.id;
    outgoingInviteExpires = Date.now() + 24 * 60 * 60 * 1000;
    byId("accountInviteShareActions").hidden = false;
    byId("accountInviteResult").textContent =
      "Send this one-time code to your partner. It expires in 24 hours: " + code;
    status("Family invite ready. Tap Share invite and choose Messages.");
  }
  window.accountInvite = () => action(prepareFamilyInvite);
  function inviteMessage() {
    if(!outgoingInvite || outgoingInviteUser !== user?.id || outgoingInviteHome !== household?.id)
      throw Error("Make an invite code first.");
    if(Date.now() >= outgoingInviteExpires) throw Error("This invite has expired. Make a new invite code.");
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("invite",outgoingInvite);
    return "Join our family on The List! Open this link, sign in or create an account, then tap Join family.\n\n" +
      url.href + "\n\nInvite code: " + outgoingInvite + "\nThis one-time invite expires in 24 hours.";
  }
  window.accountCopyInvite = async () => {
    try {
      const text = inviteMessage();
      if(!navigator.clipboard?.writeText) {
        byId("accountInviteMessage").value = text;
        byId("accountInviteMessage").hidden = false;
        byId("accountInviteMessage").focus();
        byId("accountInviteMessage").select();
        status("Select and copy the invitation below.");
        return;
      }
      await navigator.clipboard.writeText(text);
      status("Invitation copied. Paste it into a message.");
    } catch(error) { status("Could not copy: " + message(error)); }
  };
  window.accountShareInvite = async () => {
    try {
      const text = inviteMessage();
      if(!navigator.share) { await window.accountCopyInvite(); return; }
      // Call immediately from the tap; no network request before the share sheet.
      await navigator.share({title:"Join our family on The List",text});
      status("Invitation opened in your chosen app.");
    } catch(error) {
      if(error?.name === "AbortError") status("Sharing canceled. Your invite code is still ready.");
      else status("Could not open sharing. Use Copy invite instead. " + message(error));
    }
  };
  async function refreshFamilyMembers(force = false) {
    if(!user || !household) return;
    if(!force && Date.now() - membersCheckedAt < 60000) return;
    membersCheckedAt = Date.now();
    const request = ++membersRequest;
    const homeId = household.id, currentUser = user.id;
    const box = byId("accountFamilyMembers");
    try {
      const {data:members,error} = await client.rpc("list_family_members");
      if(error) throw error;
      if(request !== membersRequest || household?.id !== homeId || user?.id !== currentUser) return;
      box.replaceChildren();
      for(const member of members || []) {
        const row = document.createElement("div");
        row.className = "toolRow";
        const name = document.createElement("strong");
        name.textContent = member.display_name || "Family member";
        const labels = document.createElement("span");
        const role = document.createElement("span");
        role.className = "badge";
        role.textContent = member.member_role === "Owner" ? "Owner" : "Member";
        labels.append(role);
        if(member.user_id === currentUser) {
          const you = document.createElement("span");
          you.className = "badge";
          you.textContent = "You";
          labels.append(you);
        }
        row.append(name,labels);
        box.append(row);
      }
      byId("accountFamilyMembersStatus").textContent = (members || []).length + " family member(s)";
    } catch(error) {
      if(request === membersRequest) byId("accountFamilyMembersStatus").textContent = "Could not refresh family members. " + message(error);
    }
  }
  window.refreshFamilyMembers = () => refreshFamilyMembers(true);
  async function photoToPath(uri) {
    if(uploaded.has(uri)) return uploaded.get(uri);
    const blob = await (await fetch(uri)).blob();
    const extensions = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","application/pdf":"pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx","text/plain":"txt","text/markdown":"md","text/csv":"csv","application/json":"json"};
    const ext = extensions[blob.type];
    if(!ext || blob.size > 10485760) throw Error("A file is too large or has an unsupported format. Your local copy is safe.");
    const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,"0")).join("");
    const path = household.id + "/" + hash + "." + ext;
    const {error} = await client.storage.from(fileBucket(path)).upload(path,blob,{contentType:blob.type,upsert:false});
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
      if(!path.startsWith(household.id + "/")) throw Error("File belongs to another household.");
      if(!downloaded.has(path)) {
        const {data:blob,error} = await client.storage.from(fileBucket(path)).download(path);
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
    if(hasLocalData()) await saveRecoverySnapshot(serializeStoredData(data),true);
    await persistLocalSnapshot(next);
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
  async function uploadDevice(askToReplace = true) {
    const row = await getSnapshot();
    const replacing = !!row.payload;
    if(replacing && !askToReplace) throw Error("Family data appeared during setup. Refresh to load it safely.");
    if(replacing && askToReplace && !confirm("Replace the shared household copy with this device's data? Changes made on another device may be lost. Keep backups from both devices before continuing.")) {
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
    syncStatus("Saved");
    status("Your projects are shared with your family.");
    if(localStorage.getItem(STORAGE_KEY) !== savedAtStart) window.queueCloudSync();
  }
  window.accountUpload = () => action(() => uploadDevice(true));
  window.accountKeepFamilyProjects = () => action(async () => {
    if(!pendingFamilyRow) throw Error("Refresh Account to load your family projects.");
    await useCloud(pendingFamilyRow);
  });
  window.accountAddFamilyProjects = () => action(async () => {
    if(!pendingFamilyRow) throw Error("Refresh Account to load your family projects.");
    const row = await getSnapshot();
    const shared = await localPayload(row.payload);
    const ids = new Set((shared.projects || []).map(project => String(project.id)));
    shared.projects = [...(shared.projects || []), ...pendingFamilyProjects.filter(project => !ids.has(String(project.id)))];
    await saveRecoverySnapshot(serializeStoredData(data),true);
    const payload = await cloudPayload(shared);
    const {data:updated,error} = await client.from("household_snapshots")
      .update({payload,revision:Number(row.revision)+1,updated_at:new Date().toISOString()})
      .eq("household_id",household.id).eq("revision",row.revision).select("revision");
    if(error) throw error;
    if(!updated?.length) throw Error("Family projects changed. Tap Add my projects again to use the latest copy.");
    await useCloud({payload,revision:updated[0].revision});
  });
  window.queueCloudSync = () => {
    if(!linked || !household) return;
    pending++;
    localStorage.setItem(DIRTY_KEY,household.id);
    syncStatus("Syncing…");
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
        syncStatus("Saved");
      }
    } catch(error) {
      syncStatus("Offline or sync unavailable — saved on this phone. " + message(error));
    } finally {
      writing = false;
      if(linked && generation !== pending) { clearTimeout(timer);timer = setTimeout(flush,1200); }
    }
  }
  async function poll() {
    if(polling || writing || !household) return;
    await refreshFamilyMembers();
    if(waitingForFamily) {
      polling = true;
      try { const row = await getSnapshot(); if(row.payload) await loadAccount(); }
      catch(error) { syncStatus("Waiting for family data. " + message(error)); }
      finally { polling = false; }
      return;
    }
    if(!linked) return;
    if(localStorage.getItem(DIRTY_KEY)) { await flush(); return; }
    polling = true;
    try {
      const row = await getSnapshot();
      if(Number(row.revision) !== revision) await useCloud(row);
    } catch(error) {
      syncStatus("Offline or sync unavailable — saved on this phone. " + message(error));
    } finally { polling = false; }
  }
  (async () => {
    try {
      await window.appStorageReady;
      if(incomingInvite) {
        byId("accountInviteCode").value = incomingInvite;
        showPage("accountPage");
      }
      const {createClient} = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm");
      client = createClient(PROJECT_URL,PUBLISHABLE_KEY);
      await loadAccount();
      setInterval(poll,15000);
      document.addEventListener("visibilitychange",() => { if(!document.hidden) poll(); });
      window.addEventListener("online",poll);
      window.addEventListener("offline",() => { if(household) syncStatus("Offline — saved on this phone"); });
    } catch(error) { status("Account connection unavailable: " + message(error)); }
  })();
})();
