// Public OAuth identifier used only to migrate existing local sign-ins.
// New installations configure their own app in Account setup.
const legacyClientId = '19dd006d647a4fcba9c572b62746755a';
const requestedScopes='streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-read-currently-playing user-read-recently-played';
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let connection,authGeneration=0;
const configurationError=()=>Object.assign(new Error('Open account setup and save your Spotify app Client ID first.'),{configurationRequired:true});
async function oauthClientId(){
  await storageReady;
  const {settings,spotify}=await chrome.storage.local.get(['settings','spotify']);
  const value=settings?.clientId||spotify?.clientId||(spotify?legacyClientId:'');
  if(!/^[a-f0-9]{32}$/i.test(value))throw configurationError();
  return value;
}
async function disconnect(){
  authGeneration++;refreshing=undefined;
  if(await chrome.offscreen.hasDocument())await chrome.offscreen.closeDocument();
  await chrome.storage.local.remove('spotify');
  historyCache=undefined;historyReadAt=0;historyGeneration++;
}
function connect(options={}) {
  if(!connection) connection=authorize(options).finally(()=>{connection=undefined;});
  return connection;
}

async function authorize({silentFirst=false}={}) {
  await storageReady;
    const clientId=await oauthClientId(),generation=authGeneration;
    const verifier = encode(crypto.getRandomValues(new Uint8Array(64)));
    const state = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const redirect = chrome.identity.getRedirectURL('callback');
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({client_id: clientId, response_type: 'code', redirect_uri: redirect,
      code_challenge_method: 'S256', code_challenge: challenge, state,
      scope:requestedScopes});
    let result;
    if(silentFirst) {
      try {result=await chrome.identity.launchWebAuthFlow({url:url.href,interactive:false});} catch {}
    }
    if(!result) result=await chrome.identity.launchWebAuthFlow({url:url.href,interactive:true});
    if (!result) throw new Error('Sign-in was closed. You can try again.');
    const callback = new URL(result);
    const expected = new URL(redirect);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.get('state') !== state)
      throw new Error('Sign-in response could not be verified. Please try again.');
    if (callback.searchParams.has('error')) throw new Error('Spotify did not approve access. Please try again.');
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('Spotify returned no authorization code.');
    const response = await fetchTimed('https://accounts.spotify.com/api/token', {method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier})});
    if (!response.ok) throw new Error(`Spotify sign-in failed (${response.status}). Check your Client ID and redirect URL.`);
    const tokens = await bounded(()=>response.json(),8000,'Spotify sign-in response');
    if (!tokens.access_token) throw new Error('Spotify returned no access token.');
    if(generation!==authGeneration)throw new Error('Account configuration changed. Open the player to sign in again.');
    await chrome.storage.local.set({spotify: {clientId,accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,scopes:tokens.scope||requestedScopes}});
    historyCache=undefined;historyReadAt=0;historyGeneration++;
    return {ok: true};
}

async function bounded(operation,ms,label) {
  let timer;
  const controller=new AbortController();
  try {
    return await Promise.race([operation(controller.signal),new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error(label+' timed out. Please try again.'));},ms);
    })]);
  } finally {clearTimeout(timer);}
}
const fetchTimed=(url,options)=>bounded(signal=>fetch(url,{...options,signal}),12000,'Spotify request');

const authError = () => Object.assign(new Error('Connect Spotify to continue.'), {authRequired:true});
let refreshing, creating;
async function token(force=false) {
  await storageReady;
  const {spotify} = await chrome.storage.local.get('spotify');
  if (!spotify) throw authError();
  const clientId=await oauthClientId(),generation=authGeneration;
  if((spotify.clientId||legacyClientId)!==clientId)throw authError();
  if (!force && spotify.expiresAt > Date.now()+60000) return spotify.accessToken;
  if (!spotify.refreshToken) throw authError();
  if (!refreshing) {
    const pending=(async () => {
    const response = await fetchTimed('https://accounts.spotify.com/api/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:spotify.refreshToken,client_id:clientId})});
    if (!response.ok) {
      if([400,401].includes(response.status)) throw authError();
      throw new Error('Spotify sign-in could not be renewed. Please try again shortly.');
    }
    const next = await bounded(()=>response.json(),8000,'Spotify token response');
    if (!next.access_token) throw authError();
    if(generation!==authGeneration)throw authError();
    await chrome.storage.local.set({spotify:{clientId,accessToken:next.access_token,refreshToken:next.refresh_token || spotify.refreshToken,expiresAt:Date.now()+next.expires_in*1000,scopes:next.scope||spotify.scopes}});
    return next.access_token;
    })();
    refreshing=pending;
    pending.finally(()=>{if(refreshing===pending)refreshing=undefined;}).catch(()=>{});
  }
  return refreshing;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,body,{method='PUT',retry=false}={}) {
  let renewed=false;
  for(let attempt=0; ;attempt++) {
    const response=await fetchTimed('https://api.spotify.com/v1'+path,{method,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401) {
      if(renewed) throw authError();
      await token(true);renewed=true;continue;
    }
    if(retry && [502,503,504].includes(response.status) && attempt<2){await delay(500*2**attempt);continue;}
    if(response.ok) return response.status===204?null:bounded(()=>response.json(),8000,'Spotify response');
    let detail='';
    try {const payload=await bounded(()=>response.json(),8000,'Spotify error response');if(typeof payload.error?.message==='string') detail=' — '+payload.error.message.slice(0,180);} catch {}
    const endpoint=method+' '+path.split('?')[0];
    if(response.status===404) throw new Error(endpoint+' (404): no active playback session. Choose a playlist.'+detail);
    if(response.status===403) throw new Error(endpoint+' (403): Spotify denied access. Check the app account permissions and Premium status.'+detail);
    if(response.status===429) throw new Error('Spotify rate limit. Retry after '+(response.headers.get('Retry-After')||'a few')+' seconds.');
    if(response.status>=500) throw new Error('Spotify could not complete '+(method==='GET'?'the player check':'playback')+' ('+response.status+'). Try a track link below, or wait a moment and retry.'+detail);
    throw new Error(endpoint+' failed ('+response.status+').'+detail);
  }
}
async function startPlayback(device,body,current) {
  // A fresh SDK device has no queue. Transfer an existing session instead of
  // asking that empty device to resume; explicit links start their own context.
  if(Object.keys(body).length) return api('/me/player/play?device_id='+encodeURIComponent(device),body);
  if(current===undefined) current=await restorablePlayback();
  if(!current?.item) throw new Error('Choose a playlist below, or paste a Spotify link.');
  if(current.source==='history') {
    const trackBody=playbackBody(current.item.uri);
    if(!trackBody.uris) throw new Error('This recent item cannot be played. Choose a playlist.');
    const context=current.context?.uri;
    const resumeBody=/^spotify:(playlist|album):[A-Za-z0-9]{22}$/.test(context||'')?
      {context_uri:context,offset:{uri:current.item.uri}}:trackBody;
    return api('/me/player/play?device_id='+encodeURIComponent(device),resumeBody);
  }
  if(current.device?.id===device) return api('/me/player/play?device_id='+encodeURIComponent(device),{});
  return api('/me/player',{device_ids:[device],play:true},{retry:true});
}
let historyCache,historyReadAt=0,readingHistory,historyGeneration=0;
async function recentPlayback() {
  if(historyReadAt && Date.now()-historyReadAt<30000) return historyCache;
  if(!readingHistory) readingHistory=(async()=>{
    const generation=historyGeneration;
    const page=await api('/me/player/recently-played?limit=1',undefined,{method:'GET'});
    if(generation!==historyGeneration)return null;
    const entry=page?.items?.[0];
    historyCache=entry?.track?.uri&&!entry.track.is_local?{
      item:entry.track,context:entry.context,is_playing:false,progress_ms:null,
      source:'history',played_at:entry.played_at
    }:null;
    historyReadAt=Date.now();return historyCache;
  })().finally(()=>{readingHistory=undefined;});
  return readingHistory;
}
async function restorablePlayback() {
  const current=await api('/me/player',undefined,{method:'GET',retry:true});
  if(current?.item) return current;
  // A paused/inactive device may be absent from the full player response.
  const track=await api('/me/player/currently-playing',undefined,{method:'GET'});
  if(track?.item) return {...current,...track,source:'current-track'};
  // History is real account data, but has no paused playback position.
  return recentPlayback();
}
function playbackState(current) {
  if(!current?.item) return null;
  return {track_window:{current_track:current.item},position:current.progress_ms??0,
    duration:current.item.duration_ms??0,paused:!current.is_playing,updatedAt:Date.now(),
    shuffle:current.shuffle_state===true,repeat:current.repeat_state||'off',
    device:current.device,context:current.context,disallows:current.actions?.disallows||current.actions||{},
    source:current.source||'session',positionKnown:Number.isFinite(current.progress_ms),
    playedAt:current.played_at};
}
async function status() {
  const {spotify}=await chrome.storage.local.get('spotify');
  if(!spotify) return {ok:true,connected:false,state:null,authRequired:true};
  try {
    const current=await restorablePlayback();
    let audioError='',localState=null;
    if(await chrome.offscreen.hasDocument()) {
      try {
        const local=await bounded(()=>chrome.runtime.sendMessage({target:'audio',type:'status'}),1500,'Player status');
        audioError=local?.error||'';
        const localNewerThanHistory=current?.source==='history'&&
          (!current.played_at||Date.parse(current.played_at)<=(local?.state?.updatedAt||0));
        if(local?.state && (!current?.item||localNewerThanHistory||current.device?.id===local.deviceId)) {
          localState={...local.state,shuffle:Boolean(local.state.shuffle),repeat:['off','context','track'][local.state.repeat_mode]||'off',
            device:current?.device||{id:local.deviceId,name:'Chrome Mini Player',volume_percent:Math.round((local.volume??.5)*100)},
            disallows:local.state.disallows||{}};
        }
      } catch {}
    }
    return {ok:true,connected:true,state:localState||playbackState(current),error:audioError};
  } catch(error) {
    // Do not invent a last-played track when Spotify has no recoverable session.
    return {ok:true,connected:!error.authRequired,state:null,error:error.message,authRequired:Boolean(error.authRequired)};
  }
}
async function control(message) {
  const {command,value}=message;
  if(!['togglePlay','previousTrack','nextTrack','seek','setVolume','shuffle','repeat'].includes(command)) throw new Error('Unknown command.');
  if(command==='seek' && (!Number.isInteger(value)||value<0)) throw new Error('Invalid position.');
  if(command==='setVolume' && (!Number.isFinite(value)||value<0||value>1)) throw new Error('Invalid volume.');
  if(command==='shuffle' && typeof value!=='boolean') throw new Error('Invalid shuffle setting.');
  if(command==='repeat' && !['off','context','track'].includes(value)) throw new Error('Invalid repeat setting.');
  const current=await restorablePlayback();
  if(!current?.item) throw new Error('No session to restore. Choose a playlist below.');
  if(command==='togglePlay' && !current.is_playing) {
    const device=await ensurePlayer();
    await startPlayback(device,{},current);
    return {ok:true};
  }
  if(!current.device?.id) throw new Error('Press Play to continue this song on your PC first.');
  const device='device_id='+encodeURIComponent(current.device.id);
  const routes={togglePlay:['pause','PUT'],previousTrack:['previous','POST'],nextTrack:['next','POST'],
    seek:['seek','PUT','position_ms='+value],setVolume:['volume','PUT','volume_percent='+Math.round(value*100)],
    shuffle:['shuffle','PUT','state='+value],repeat:['repeat','PUT','state='+value]};
  const [path,method,query]=routes[command];
  await api('/me/player/'+path+'?'+device+(query?'&'+query:''),undefined,{method});
  return {ok:true};
}
async function ensurePlayer() {
  await token();
  if (!creating) creating=(async()=>{
    if(await chrome.offscreen.hasDocument()) {
      let local;
      try {local=await bounded(()=>chrome.runtime.sendMessage({target:'audio',type:'status'}),1500,'Player status');} catch {}
      if(!local?.ok||local.error) await chrome.offscreen.closeDocument();
    }
    if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'Play Spotify audio while the toolbar popup is closed.'});
  })().finally(()=>{creating=undefined;});
  await creating;
  let response;
  for(let attempt=0;attempt<4;attempt++) {
    try {response=await bounded(()=>chrome.runtime.sendMessage({target:'audio',type:'ready'}),24000,'Background audio');break;}
    catch(error) {if(error.message.includes('timed out'))throw error;await new Promise(resolve=>setTimeout(resolve,150));}
  }
  if (!response?.ok) throw new Error(response?.error || 'Background audio did not start. Try playing again.');
  return response.deviceId;
}
function playbackBody(value) {
  if (!value) return {};
  const match=value.match(/^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/) || value.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]{22})(?:\?[^\s]*)?$/);
  if (!match) throw new Error('Paste a Spotify track, album, or playlist link.');
  const uri='spotify:'+match[1]+':'+match[2];
  return match[1]==='track'?{uris:[uri]}:{context_uri:uri};
}
async function handle(message,sender) {
  await storageReady;
  if(message.type==='configuration'){
    let clientId='';try{clientId=await oauthClientId();}catch(error){if(!error.configurationRequired)throw error;}
    const {spotify}=await chrome.storage.local.get('spotify');
    return {ok:true,clientId,connected:Boolean(spotify),redirect:chrome.identity.getRedirectURL('callback')};
  }
  if(message.type==='configure'){
    const clientId=typeof message.clientId==='string'?message.clientId.trim():'';
    if(!/^[a-f0-9]{32}$/i.test(clientId))throw new Error('Enter the 32-character Spotify Client ID, not a client secret.');
    let previous='';try{previous=await oauthClientId();}catch(error){if(!error.configurationRequired)throw error;}
    if(previous!==clientId)await disconnect();
    await chrome.storage.local.set({settings:{clientId}});
    return {ok:true};
  }
  if(message.type==='initialize') {
    historyReadAt=0;
    let authorized=false;
    if(message.reauthorize) {await connect({silentFirst:true});authorized=true;}
    else try {await token();} catch(error) {if(!error.authRequired) throw error;await connect({silentFirst:true});authorized=true;}
    const {spotify}=await chrome.storage.local.get('spotify');
    const scopes=(spotify?.scopes||'').split(' ');
    if(!authorized && !['user-read-currently-playing','user-read-recently-played'].every(scope=>scopes.includes(scope))) await connect({silentFirst:true});
    return {ok:true,connected:true,protocol:4};
  }
  if(message.type==='queue') {
    const page=await api('/me/player/queue',undefined,{method:'GET',retry:true});
    return {ok:true,current:page?.currently_playing||null,items:(page?.queue||[]).filter(Boolean)};
  }
  if(message.type==='playlistItems') {
    if(!/^[A-Za-z0-9]{22}$/.test(message.id||'')) throw new Error('Invalid playlist.');
    const offset=message.offset??0;
    if(!Number.isInteger(offset)||offset<0) throw new Error('Invalid playlist page.');
    const base='/playlists/'+message.id;
    let page;
    try {page=await api(base+'/items?limit=50&offset='+offset,undefined,{method:'GET'});}
    catch(error) {
      // Older app registrations still use the original tracks endpoint.
      if(!error.message.includes('(404)')) throw error;
      page=await api(base+'/tracks?limit=50&offset='+offset,undefined,{method:'GET'});
    }
    return {ok:true,items:(page?.items||[]).map((entry,index)=>({track:entry?.item||entry?.track||null,position:offset+index})),
      nextOffset:page?.next?offset+(page.limit||50):null};
  }
  if(message.type==='playlists') {
    const offset=message.offset ?? 0;
    if(!Number.isInteger(offset)||offset<0) throw new Error('Invalid playlist page.');
    try {
      const page=await api('/me/playlists?limit=50&offset='+offset,undefined,{method:'GET',retry:true});
      return {ok:true,items:(page.items||[]).filter(Boolean).map(item=>({name:item.name,uri:item.uri,
        image:item.images?.[0]?.url,owner:item.owner?.display_name})),nextOffset:page.next?offset+50:null};
    } catch(error) {
      if(error.message.includes('denied')) throw new Error('Playlist access was denied. Open setup and reconnect Spotify to approve playlist access.');
      throw error;
    }
  }
  if (message.type==='connect') return connect();
  if (message.type==='token' && sender.url===chrome.runtime.getURL('offscreen.html')) return {ok:true,token:await token()};
  if (message.type==='disconnect') {
    await disconnect();return {ok:true};
  }
  if (message.type==='status') return status();
  if(message.type==='play') {
    let body=playbackBody(message.uri?.trim());
    if(message.context) {
      const context=playbackBody(message.context);
      if(!context.context_uri||!body.uris?.length||!Number.isInteger(message.position)||message.position<0) throw new Error('Invalid playlist track.');
      body={context_uri:context.context_uri,offset:{position:message.position}};
    }
    // Read the phone session before registering a new browser device.
    const current=Object.keys(body).length?null:await restorablePlayback();
    if(!Object.keys(body).length && !current?.item) throw new Error('No session to restore. Choose a playlist below.');
    const device=await ensurePlayer();
    await startPlayback(device,body,current);return {ok:true};
  }
  if(message.type==='control') return control(message);
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || message.target==='audio') return;
  handle(message,sender).then(reply).catch(error=>reply({ok:false,error:error.message,authRequired:Boolean(error.authRequired),configurationRequired:Boolean(error.configurationRequired)}));return true;
});
