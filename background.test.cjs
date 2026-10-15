const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(){
  let stored={spotify:{accessToken:'old',refreshToken:'refresh',expiresAt:0,scopes:'user-read-currently-playing user-read-recently-played'}},calls=0;
  const context=vm.createContext({URL,URLSearchParams,Uint8Array,TextEncoder,crypto:globalThis.crypto,btoa,Date,setTimeout,clearTimeout,AbortController,
    fetch:async()=>{calls++;return {ok:true,json:async()=>({access_token:'renewed',expires_in:3600})};},
    chrome:{storage:{local:{setAccessLevel:async()=>{},get:async()=>stored,set:async value=>Object.assign(stored,value),remove:async key=>delete stored[key]}},
      identity:{getRedirectURL:path=>'https://test.chromiumapp.org/'+path},
      runtime:{onMessage:{addListener(){}},getURL:path=>'chrome-extension://test/'+path},offscreen:{hasDocument:async()=>false}}});
  vm.runInContext(fs.readFileSync('background.js','utf8'),context);
  return {run:code=>vm.runInContext(code,context),calls:()=>calls,stored:()=>stored};
}
const id='1234567890123456789012';
test('track links, playlist links and invalid input',()=>{
  const h=harness();
  assert.equal(h.run(`playbackBody('https://open.spotify.com/track/${id}?si=abc').uris[0]`),'spotify:track:'+id);
  assert.equal(h.run(`playbackBody('spotify:playlist:${id}').context_uri`),'spotify:playlist:'+id);
  assert.throws(()=>h.run(`playbackBody('https://evil.example/track/${id}')`));
  assert.throws(()=>h.run(`playbackBody('https://open.spotify.com/track/short')`));
});
test('concurrent expired-token requests share a refresh and preserve refresh token',async()=>{
  const h=harness();const result=await h.run('Promise.all([token(),token(),token()])');
  assert.deepEqual(Array.from(result),['renewed','renewed','renewed']);assert.equal(h.calls(),1);
  assert.equal(h.stored().spotify.refreshToken,'refresh');
});
test('popup cannot request the token directly',async()=>{
  const h=harness();await assert.rejects(h.run("handle({type:'token'},{url:'chrome-extension://test/popup.html'})"),/Unknown/);
});
test('invalid volume rejected before playback',async()=>{
  const h=harness();await assert.rejects(h.run("handle({type:'control',command:'setVolume',value:9},{})"),/Invalid volume/);
});
test('status reads Spotify without creating a player or writing playback',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';globalThis.requests=[];fetch=async(url,options)=>{requests.push({url,...options});return {ok:true,status:204};};
    chrome.offscreen.createDocument=()=>{throw new Error('Must not create player');};`);
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.connected,true);assert.equal(result.state,null);
  assert.equal(h.run('requests.length'),3);assert.equal(h.run('requests.every(request=>request.method==="GET")'),true);
});
test('fresh player transfers existing session without empty resume',async()=>{
  const h=harness();
  await h.run(`
    token=async()=> 'test';
    globalThis.requests=[];
    fetch=async(url,options)=>{requests.push({url,...options});return requests.length===1?
      {ok:true,status:200,json:async()=>({item:{id:'song'},device:{id:'other'}})}:{ok:true,status:204};};
    startPlayback('new-device',{});
  `);
  assert.equal(h.run('requests[0].method'),'GET');
  assert.equal(h.run('requests[1].url'),'https://api.spotify.com/v1/me/player');
  assert.equal(h.run('JSON.parse(requests[1].body).device_ids[0]'),'new-device');
  assert.equal(h.run('JSON.parse(requests[1].body).play'),true);
});
test('no session gives song-selection guidance without playback write',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';globalThis.requests=0;fetch=async()=>{requests++;return {ok:true,status:204};};`);
  await assert.rejects(h.run("startPlayback('new-device',{})"),/Choose a playlist/);
  assert.equal(h.run('requests'),3);
});
test('temporary gateway failures are retried with a bound',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';setTimeout=callback=>callback();globalThis.requests=0;fetch=async()=>{requests++;return {ok:false,status:502,json:async()=>({error:{message:'Bad gateway'}})};};`);
  await assert.rejects(h.run("api('/me/player',undefined,{method:'GET',retry:true})"),/502.*Bad gateway/);
  assert.equal(h.run('requests'),3);
});
test('explicit track start is not replayed after an ambiguous gateway failure',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';globalThis.requests=0;fetch=async()=>{requests++;return {ok:false,status:502,json:async()=>({})};};`);
  await assert.rejects(h.run("startPlayback('new-device',{uris:['spotify:track:123']})"),/502/);
  assert.equal(h.run('requests'),1);
});



test('opening restores a paused phone track and never starts or transfers playback',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';globalThis.requests=[];connect=async()=>{throw new Error('Already signed in');};
    ensurePlayer=async()=>{throw new Error('Opening must not start audio');};
    fetch=async(url,options)=>{requests.push({url,...options});return {ok:true,status:200,json:async()=>({
      item:{uri:'spotify:track:phone',name:'Phone song',duration_ms:200000},progress_ms:84000,is_playing:false,
      device:{id:'phone',name:'My phone'},shuffle_state:true,repeat_state:'context',context:{uri:'spotify:playlist:phone'},
      actions:{seeking:true}
    })};};`);
  await h.run("handle({type:'initialize'},{})");
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.state.position,84000);assert.equal(result.state.paused,true);
  assert.equal(result.state.track_window.current_track.name,'Phone song');
  assert.equal(result.state.shuffle,true);assert.equal(result.state.repeat,'context');
  assert.equal(result.state.disallows.seeking,true);assert.equal(result.state.device.id,'phone');
  assert.equal(h.run('requests.length'),1);assert.equal(h.run('requests[0].method'),'GET');
});
test('opening without a Spotify session leaves the player empty',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';ensurePlayer=()=>{throw new Error('No audio expected');};
    fetch=async()=>({ok:true,status:204});`);
  await h.run("handle({type:'initialize'},{})");
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.connected,true);assert.equal(result.state,null);
});
test('a failed session read returns an empty player with a recoverable error',async()=>{
  const h=harness();h.run("token=async()=> 'test';fetch=async()=>{throw new Error('Offline');};");
  await h.run("handle({type:'initialize'},{})");
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.state,null);assert.equal(result.connected,true);assert.match(result.error,/Offline/);
});
test('opening without credentials automatically starts sign-in once',async()=>{
  const h=harness();delete h.stored().spotify;
  h.run(`globalThis.signIns=0;connect=async()=>{signIns++;await chrome.storage.local.set({spotify:{accessToken:'ok',expiresAt:Date.now()+3600000}});};
    fetch=async()=>({ok:true,status:204});`);
  await h.run("handle({type:'initialize'},{})");
  assert.equal(h.run('signIns'),1);
});
test('expired credentials refresh silently without another sign-in',async()=>{
  const h=harness();
  h.run(`globalThis.signIns=0;connect=async()=>{signIns++;};
    fetch=async url=>url.includes('/api/token')?{ok:true,json:async()=>({access_token:'new',expires_in:3600})}:{ok:true,status:204};`);
  await h.run("handle({type:'initialize'},{})");assert.equal(h.run('signIns'),0);
  assert.equal(h.stored().spotify.accessToken,'new');
});
test('revoked credentials start reauthorization, transient outages do not',async()=>{
  const h=harness();
  h.run(`globalThis.signIns=0;connect=async()=>{signIns++;await chrome.storage.local.set({spotify:{accessToken:'ok',expiresAt:Date.now()+3600000}});};
    fetch=async url=>url.includes('/api/token')?{ok:false,status:400}:{ok:true,status:204};`);
  await h.run("handle({type:'initialize'},{})");assert.equal(h.run('signIns'),1);
  h.stored().spotify.expiresAt=0;h.stored().spotify.refreshToken='refresh';
  h.run("fetch=async()=>({ok:false,status:503});");
  await assert.rejects(h.run("handle({type:'initialize'},{})"),/renewed/);
  assert.equal(h.run('signIns'),1);
});
test('cancelled sign-in propagates once and passive polling never reopens it',async()=>{
  const h=harness();delete h.stored().spotify;
  h.run("globalThis.signIns=0;connect=async()=>{signIns++;throw new Error('Sign-in cancelled');};");
  await assert.rejects(h.run("handle({type:'initialize'},{})"),/cancelled/);
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.authRequired,true);assert.equal(h.run('signIns'),1);
});
test('Play captures the phone session before creating the browser player',async()=>{
  const h=harness();
  h.run(`globalThis.steps=[];api=async(path,body,options)=>{steps.push({path,body,method:options?.method});
    return options?.method==='GET'?{item:{uri:'spotify:track:phone'},device:{id:'phone'},progress_ms:84000,is_playing:false}:null;};
    ensurePlayer=async()=>{steps.push({create:true});return 'pc';};`);
  await h.run("handle({type:'play'},{})");
  assert.equal(h.run('steps[0].method'),'GET');assert.equal(h.run('steps[1].create'),true);
  assert.equal(h.run('steps[2].path'),'/me/player');assert.equal(h.run('steps[2].body.device_ids[0]'),'pc');
  assert.equal(h.run('steps[2].body.play'),true);assert.equal(h.run('steps.length'),3);
});
test('Play with no session does not create a device or write playback',async()=>{
  const h=harness();
  h.run("api=async()=>null;ensurePlayer=()=>{throw new Error('Must not create audio');};");
  await assert.rejects(h.run("handle({type:'play'},{})"),/Choose a playlist/);
});
test('paused Play button transfers to PC while pause targets the active device',async()=>{
  const h=harness();
  h.run(`globalThis.requests=[];globalThis.playing=false;
    api=async(path,body,options)=>{requests.push({path,body,method:options?.method});
      return options?.method==='GET'?{item:{id:'song'},device:{id:'phone'},is_playing:playing}:null;};
    ensurePlayer=async()=> 'pc';`);
  await h.run("handle({type:'control',command:'togglePlay'},{})");
  assert.equal(h.run('requests[1].body.device_ids[0]'),'pc');
  h.run('playing=true;requests=[];');
  await h.run("handle({type:'control',command:'togglePlay'},{})");
  assert.equal(h.run('requests[1].path'),'/me/player/pause?device_id=phone');
});
test('shuffle and every repeat mode target the current device',async()=>{
  const h=harness();
  h.run(`globalThis.requests=[];api=async(path,body,options)=>{
    requests.push({path,body,method:options?.method});
    return options?.method==='GET'?{item:{id:'song'},device:{id:'phone id'}}:null;};`);
  for(const mode of ['off','context','track']){
    await h.run("handle({type:'control',command:'repeat',value:'"+mode+"'},{})");
    assert.equal(h.run('requests.at(-1).path'),'/me/player/repeat?device_id=phone%20id&state='+mode);
    assert.equal(h.run('requests.at(-1).method'),'PUT');
  }
  await h.run("handle({type:'control',command:'shuffle',value:true},{})");
  assert.equal(h.run('requests.at(-1).path'),'/me/player/shuffle?device_id=phone%20id&state=true');
});
test('invalid repeat, shuffle, seek and commands fail before network access',async()=>{
  const h=harness();
  for(const message of [
    {command:'repeat',value:'all'},{command:'shuffle',value:'true'},{command:'seek',value:-1},
    {command:'seek',value:NaN},{command:'unknown'}
  ]) await assert.rejects(h.run('handle('+JSON.stringify({type:'control',...message})+',{})'));
  assert.equal(h.calls(),0);
});
test('queue preserves playback order and repeated tracks',async()=>{
  const h=harness();
  h.run(`api=async()=>({currently_playing:{name:'Current'},queue:[{name:'A'},{name:'B'},{name:'A'},null]});`);
  const result=await h.run("handle({type:'queue'},{})");
  assert.equal(result.current.name,'Current');assert.deepEqual(Array.from(result.items,item=>item.name),['A','B','A']);
});
test('401 renews the access token and retries the rejected request only once',async()=>{
  const h=harness();h.stored().spotify.expiresAt=Date.now()+3600000;
  h.run(`globalThis.requests=[];fetch=async(url,options)=>{requests.push({url,...options});
    if(url.includes('/api/token'))return {ok:true,json:async()=>({access_token:'fresh',expires_in:3600})};
    return requests.length===1?{ok:false,status:401}:{ok:true,status:204};};`);
  await h.run("api('/me/player',undefined,{method:'GET'})");
  assert.equal(h.run('requests.length'),3);
  assert.equal(h.run('requests[2].headers.Authorization'),'Bearer fresh');
});
test('persistent 401 is bounded and asks for reauthorization',async()=>{
  const h=harness();h.stored().spotify.expiresAt=Date.now()+3600000;
  h.run(`globalThis.requests=0;fetch=async(url)=>{requests++;return url.includes('/api/token')?
    {ok:true,json:async()=>({access_token:'fresh',expires_in:3600})}:{ok:false,status:401};};`);
  await assert.rejects(h.run("api('/me/player',undefined,{method:'GET'})"),error=>error.authRequired===true);
  assert.equal(h.run('requests'),3);
});


test('authentication initialization does not wait for the playback endpoint',async()=>{
  const h=harness();
  h.run("token=async()=> 'test';fetch=()=>new Promise(()=>{});");
  const result=await h.run("handle({type:'initialize'},{})");
  assert.equal(result.protocol,4);assert.equal(result.connected,true);
});
test('bounded requests abort and reject instead of keeping the player busy forever',async()=>{
  const h=harness();
  h.run("globalThis.aborted=false;");
  await assert.rejects(h.run("bounded(signal=>new Promise(()=>{signal.addEventListener('abort',()=>{aborted=true;});}),5,'Test request')"),/timed out/);
  assert.equal(h.run('aborted'),true);
});
test('playlist browsing accepts both the new item and legacy track response fields',async()=>{
  const h=harness();
  h.run("api=async()=>({items:[{item:{name:'New'}},{track:{name:'Legacy'}},{item:null}],next:null});");
  const page=await h.run("handle({type:'playlistItems',id:'1234567890123456789012'}, {})");
  assert.equal(page.items[0].track.name,'New');assert.equal(page.items[1].track.name,'Legacy');
  assert.equal(page.items[2].track,null);assert.equal(page.nextOffset,null);
});
test('choosing a playlist song keeps playlist context and the requested position',async()=>{
  const h=harness();
  h.run("ensurePlayer=async()=> 'pc';globalThis.writes=[];api=async(path,body)=>{writes.push({path,body});};");
  await h.run("handle({type:'play',uri:'spotify:track:1234567890123456789012',context:'spotify:playlist:1234567890123456789012',position:4},{})");
  assert.equal(h.run('writes[0].body.context_uri'),'spotify:playlist:1234567890123456789012');
  assert.equal(h.run('writes[0].body.offset.position'),4);
  assert.equal(h.run('writes.length'),1);
});

test('paused phone track is recovered from currently-playing when full playback is empty',async()=>{
  const h=harness();
  h.run(`globalThis.reads=[];api=async(path,body,options)=>{
    reads.push({path,method:options.method});
    return path==='/me/player/currently-playing'?{item:{name:'Phone song',uri:'spotify:track:${id}',duration_ms:200000},
      progress_ms:84000,is_playing:false,context:{uri:'spotify:playlist:${id}'}}:null;
  };ensurePlayer=()=>{throw new Error('Must stay paused');};`);
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.state.track_window.current_track.name,'Phone song');
  assert.equal(result.state.position,84000);assert.equal(result.state.paused,true);
  assert.equal(result.state.source,'current-track');assert.equal(result.state.positionKnown,true);
  assert.equal(h.run('reads.length'),2);assert.equal(h.run('reads.every(r=>r.method==="GET")'),true);
});

test('Spotify history recovers the actual last song and playlist without inventing a position',async()=>{
  const h=harness();
  h.run(`globalThis.reads=[];api=async(path,body,options)=>{
    reads.push({path,method:options.method});return path.includes('recently-played')?{items:[{
      track:{name:'Last phone song',uri:'spotify:track:${id}',duration_ms:200000},
      context:{uri:'spotify:playlist:${id}',type:'playlist'},played_at:new Date().toISOString()}]}:null;
  };ensurePlayer=()=>{throw new Error('Opening must not play');};`);
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.state.track_window.current_track.name,'Last phone song');
  assert.equal(result.state.context.uri,'spotify:playlist:'+id);
  assert.equal(result.state.source,'history');assert.equal(result.state.positionKnown,false);
  assert.equal(result.state.paused,true);assert.equal(result.state.device,undefined);
  assert.equal(h.run('reads.length'),3);assert.equal(h.run('reads.every(r=>r.method==="GET")'),true);
});

test('Play starts the history track within its original playlist without requiring a selected playlist',async()=>{
  const h=harness();
  h.run(`globalThis.writes=[];api=async(path,body,options)=>{
    if(options?.method==='GET')return path.includes('recently-played')?{items:[{
      track:{uri:'spotify:track:${id}'},context:{uri:'spotify:playlist:${id}'}}]}:null;
    writes.push({path,body});};ensurePlayer=async()=> 'pc';`);
  await h.run("handle({type:'control',command:'togglePlay'},{})");
  assert.equal(h.run('writes.length'),1);
  assert.equal(h.run('writes[0].path'),'/me/player/play?device_id=pc');
  assert.equal(h.run('writes[0].body.context_uri'),'spotify:playlist:'+id);
  assert.equal(h.run('writes[0].body.offset.uri'),'spotify:track:'+id);
  assert.equal(h.run('writes[0].body.position_ms'),undefined);
});

test('a history track without playlist context can still be played',async()=>{
  const h=harness();
  h.run(`globalThis.body=null;api=async(path,body)=>{globalThis.body=body;};`);
  await h.run(`startPlayback('pc',{}, {source:'history',item:{uri:'spotify:track:${id}'}})`);
  assert.equal(h.run('body.uris[0]'),'spotify:track:'+id);
});

test('history is cached between polls but refreshed whenever the popup opens',async()=>{
  const h=harness();
  h.run(`token=async()=> 'test';globalThis.historyReads=0;api=async path=>{
    if(!path.includes('recently-played'))return null;historyReads++;
    return {items:[{track:{uri:'spotify:track:${id}',name:'Song '+historyReads}}]};};`);
  await h.run("handle({type:'status'},{})");await h.run("handle({type:'status'},{})");
  assert.equal(h.run('historyReads'),1);
  await h.run("handle({type:'initialize'},{})");
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(h.run('historyReads'),2);assert.equal(result.state.track_window.current_track.name,'Song 2');
});

test('existing authorization upgrades history scopes once and retains them during refresh',async()=>{
  const h=harness();h.stored().spotify.scopes='streaming';
  h.run(`globalThis.authorizations=0;connect=async()=>{authorizations++;
    await chrome.storage.local.set({spotify:{accessToken:'new',refreshToken:'refresh',expiresAt:0,
      scopes:'user-read-currently-playing user-read-recently-played'}});};`);
  await h.run("handle({type:'initialize'},{})");
  await h.run("handle({type:'initialize'},{})");
  assert.equal(h.run('authorizations'),1);
  assert.match(h.stored().spotify.scopes,/user-read-recently-played/);
});

test('older paused extension state does not hide newer listening history from the phone',async()=>{
  const h=harness();
  h.run(`api=async path=>path.includes('recently-played')?{items:[{
    track:{uri:'spotify:track:${id}',name:'New phone song'},played_at:new Date().toISOString()}]}:null;
    chrome.offscreen.hasDocument=async()=>true;
    chrome.runtime.sendMessage=async()=>({ok:true,deviceId:'pc',state:{paused:true,updatedAt:Date.now()-60000,
      track_window:{current_track:{name:'Old extension song'}}}});`);
  const result=await h.run("handle({type:'status'},{})");
  assert.equal(result.state.track_window.current_track.name,'New phone song');
  assert.equal(result.state.source,'history');
});

test('disconnect discards a history response that was already in flight',async()=>{
  const h=harness();h.run('globalThis.finishHistory=null;api=()=>new Promise(resolve=>{finishHistory=resolve;});');
  const pending=h.run('recentPlayback()');
  await h.run("handle({type:'disconnect'},{})");
  h.run(`finishHistory({items:[{track:{uri:'spotify:track:${id}',name:'Previous account'}}]});`);
  assert.equal(await pending,null);assert.equal(h.run('historyCache'),undefined);
});

test('new installations require a Client ID and do not use the maintainer app',async()=>{
  const h=harness();delete h.stored().spotify;
  await assert.rejects(h.run("handle({type:'initialize'},{})"),error=>error.configurationRequired===true);
  const config=await h.run("handle({type:'configuration'},{})");
  assert.equal(config.clientId,'');assert.equal(config.connected,false);assert.equal(h.calls(),0);
});

test('changing Spotify apps clears previous credentials and stops local playback',async()=>{
  const h=harness();h.run('globalThis.closed=0;chrome.offscreen.hasDocument=async()=>true;chrome.offscreen.closeDocument=async()=>{closed++;};');
  await h.run("handle({type:'configure',clientId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},{})");
  assert.equal(h.stored().spotify,undefined);assert.equal(h.stored().settings.clientId,'a'.repeat(32));
  assert.equal(h.run('closed'),1);
  const config=await h.run("handle({type:'configuration'},{})");
  assert.equal(config.clientId,'a'.repeat(32));assert.equal(config.connected,false);
  assert.equal(config.accessToken,undefined);assert.equal(config.refreshToken,undefined);
});

test('saving the existing Client ID preserves the current sign-in',async()=>{
  const h=harness();
  await h.run("handle({type:'configure',clientId:legacyClientId},{})");
  assert.equal(h.stored().spotify.accessToken,'old');
});

test('invalid Client IDs fail before modifying the account',async()=>{
  const h=harness();
  for(const clientId of ['',null,'not-an-id','https://example.com','a'.repeat(33)])
    await assert.rejects(h.run('handle('+JSON.stringify({type:'configure',clientId})+',{})'),/Client ID/);
  assert.equal(h.stored().spotify.accessToken,'old');assert.equal(h.stored().settings,undefined);
});

test('each configured app is used for authorization and token exchange',async()=>{
  const h=harness();
  await h.run("handle({type:'configure',clientId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},{})");
  h.run(`globalThis.authorization=null;globalThis.tokenBody=null;
    chrome.identity.launchWebAuthFlow=async options=>{
      authorization=new URL(options.url);
      return 'https://test.chromiumapp.org/callback?code=test&state='+authorization.searchParams.get('state');
    };
    fetch=async(url,options)=>{tokenBody=options.body;return {ok:true,json:async()=>({access_token:'own-token',refresh_token:'own-refresh',expires_in:3600})};};`);
  await h.run('connect()');
  assert.equal(h.run("authorization.searchParams.get('client_id')"),'a'.repeat(32));
  assert.equal(h.run("tokenBody.get('client_id')"),'a'.repeat(32));
  assert.equal(h.stored().spotify.clientId,'a'.repeat(32));assert.equal(h.stored().spotify.accessToken,'own-token');
  assert.match(h.stored().spotify.scopes,/user-read-recently-played/);
});

test('token refresh uses the configured app instead of the migration identifier',async()=>{
  const h=harness();h.stored().settings={clientId:'a'.repeat(32)};h.stored().spotify.clientId='a'.repeat(32);
  h.run("globalThis.refreshClient=null;fetch=async(url,options)=>{refreshClient=options.body.get('client_id');return {ok:true,json:async()=>({access_token:'new',expires_in:3600})};};");
  await h.run('token()');assert.equal(h.run('refreshClient'),'a'.repeat(32));
  assert.equal(h.stored().spotify.clientId,'a'.repeat(32));
});

test('a token refresh already in flight cannot restore credentials after changing apps',async()=>{
  const h=harness();h.run('globalThis.finishRefresh=null;fetch=()=>new Promise(resolve=>{finishRefresh=resolve;});');
  const pending=h.run('token()');
  for(let i=0;i<10&&!h.run('finishRefresh');i++)await new Promise(resolve=>setImmediate(resolve));
  await h.run("handle({type:'configure',clientId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},{})");
  h.run("finishRefresh({ok:true,json:async()=>({access_token:'stale',expires_in:3600})});");
  await assert.rejects(pending,error=>error.authRequired===true);
  assert.equal(h.stored().spotify,undefined);
});
