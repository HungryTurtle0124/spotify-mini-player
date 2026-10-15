const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';}
  append(...elements){this.children.push(...elements);}
  replaceChildren(...elements){this.children=[...elements];}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name];}
  addEventListener(name,listener){this.listeners[name]=listener;}
  async click(){if(!this.disabled)return this.listeners.click?.();}
}
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(handler,{rawInitialize=false,session={}}={}){
  const nodes=new Map(),commands=[],messages=[],timers=[];
  const html=fs.readFileSync('popup.html','utf8');
  for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)){
    const [,tag,attributes]=match;const id=attributes.match(/\bid="([^"]+)"/)?.[1];
    const command=attributes.match(/\bdata-command="([^"]+)"/)?.[1];
    if(!id&&!command)continue;
    const node=new Element(tag);node.hidden=/\bhidden\b/.test(attributes);node.disabled=/\bdisabled\b/.test(attributes);
    if(id)nodes.set(id,node);
    if(command){node.dataset.command=command;commands.push(node);}
  }
  const document={hidden:false,activeElement:null,createElement:tag=>new Element(tag),
    querySelector:selector=>{const node=nodes.get(selector.slice(1));if(!node)throw new Error('Missing UI element '+selector);return node;},
    querySelectorAll:selector=>selector==='[data-command]'?commands:selector==='.playlist-row'?nodes.get('playlists').children:[]};
  const context=vm.createContext({document,Date,console,setTimeout,clearTimeout,setInterval:(fn,ms)=>{timers.push({fn,ms});},
    chrome:{storage:{session:{get:async()=>session,set:async value=>Object.assign(session,value)}},runtime:{reload(){messages.push({type:'runtime-reload'});},openOptionsPage(){messages.push({type:'open-setup'});},sendMessage:async message=>{messages.push(message);const result=await handler(message);return !rawInitialize&&message.type==='initialize'&&result.ok?{protocol:4,...result}:result;}}}});
  vm.runInContext(fs.readFileSync('popup.js','utf8'),context);
  return {nodes,commands,messages,timers,run:code=>vm.runInContext(code,context)};
}
function phoneState(){return {track_window:{current_track:{name:'Phone song',uri:'spotify:track:phone',artists:[{name:'Artist'}]}},
  position:84000,duration:200000,paused:true,updatedAt:Date.now(),shuffle:false,repeat:'off',
  device:{id:'phone',name:'My phone',volume_percent:60,supports_volume:true},disallows:{}};}
const library={ok:true,items:[{name:'My playlist',uri:'spotify:playlist:1234567890123456789012'}],nextOffset:null};
test('popup automatically connects, shows paused phone position, and never sends Play on open',async()=>{
  const state=phoneState();const h=harness(message=>message.type==='playlists'?library:{ok:true,connected:true,state});
  await settle();
  assert.equal(h.messages[0].type,'initialize');
  assert.equal(h.nodes.get('track').textContent,'Phone song');assert.equal(h.nodes.get('elapsed').textContent,'1:24');
  assert.equal(h.nodes.get('device').textContent,'Paused on My phone');
  assert.equal(h.nodes.get('toggle').getAttribute('aria-label'),'Play on this PC');
  assert.equal(h.messages.some(m=>m.type==='play'||m.type==='control'),false);
  assert.equal(h.nodes.get('playlists').children.length,1);
});
test('empty fallback keeps playlists usable and playback controls disabled',async()=>{
  const h=harness(message=>message.type==='playlists'?library:{ok:true,connected:true,state:null});
  await settle();
  assert.equal(h.nodes.get('track').textContent,'Choose your music.');
  assert.equal(h.nodes.get('play').hidden,true);
  assert.equal(h.nodes.get('toggle').disabled,true);
  assert.equal(h.nodes.get('playlists').children[0].disabled,false);
  await h.nodes.get('playlists').children[0].click();await settle();
  assert.equal(h.nodes.get('playlist-detail').hidden,false);
  await h.nodes.get('play-playlist').click();await settle();
  assert.equal(h.messages.find(m=>m.type==='play').uri,library.items[0].uri);
});
test('shuffle and repeat buttons send the next mode and reflect Spotify responses',async()=>{
  const state=phoneState();
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='control'){state[message.command]=message.value;return {ok:true};}
    return {ok:true,connected:true,state};
  });await settle();
  await h.nodes.get('shuffle').click();await settle();
  assert.equal(h.nodes.get('shuffle').getAttribute('aria-pressed'),'true');
  for(const mode of ['context','track','off']){
    await h.nodes.get('repeat').click();await settle();
    assert.equal(h.messages.filter(m=>m.command==='repeat').at(-1).value,mode);
  }
  assert.equal(h.nodes.get('repeat').getAttribute('aria-pressed'),'false');
});
test('queue displays Spotify order, including duplicate tracks',async()=>{
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='queue')return {ok:true,current:{name:'Current'},items:[{name:'A'},{name:'B'},{name:'A'}]};
    return {ok:true,connected:true,state:phoneState()};
  });await settle();
  await h.nodes.get('show-queue').click();await settle();
  assert.equal(h.nodes.get('queue-panel').hidden,false);
  assert.equal(h.nodes.get('playlists-panel').hidden,true);
  assert.deepEqual(h.nodes.get('queue').children.map(item=>item.children[0].children[0].textContent),['A','B','A']);
});
test('cancelled automatic sign-in exposes retry without repeated authorization',async()=>{
  let attempts=0;
  const h=harness(message=>{
    if(message.type==='initialize'){attempts++;return {ok:false,error:'Sign-in cancelled'};}
    return {ok:true};
  });await settle();
  assert.equal(h.nodes.get('reconnect').hidden,false);
  h.timers.find(t=>t.ms===5000).fn();await settle();assert.equal(attempts,1);
  await h.nodes.get('reconnect').click();await settle();assert.equal(attempts,2);
});
test('a temporary status failure clears the display and recovers on the next poll',async()=>{
  let offline=true;
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='status'&&offline)return {ok:true,connected:true,state:null,error:'Offline'};
    return {ok:true,connected:true,state:phoneState()};
  });await settle();
  await h.run('update()');assert.equal(h.nodes.get('track').textContent,'Choose your music.');
  assert.equal(h.nodes.get('status').textContent,'Offline');
  offline=false;await h.run('update()');
  assert.equal(h.nodes.get('track').textContent,'Phone song');
  assert.equal(h.nodes.get('status').textContent,'Ready to continue from this position.');
});
test('restricted playback disables the relevant controls',async()=>{
  const state=phoneState();state.disallows={seeking:true,toggling_shuffle:true,skipping_next:true};
  const h=harness(message=>message.type==='playlists'?library:{ok:true,connected:true,state});
  await settle();
  assert.equal(h.nodes.get('seek').disabled,true);assert.equal(h.nodes.get('shuffle').disabled,true);
  assert.equal(h.commands.find(n=>n.dataset.command==='nextTrack').disabled,true);
});


test('the reported Unknown request startup automatically reloads the stale worker once',async()=>{
  const session={};
  const h=harness(()=>({ok:false,error:'Unknown request.'}),{rawInitialize:true,session});
  await settle();
  assert.equal(h.messages.filter(m=>m.type==='runtime-reload').length,1);
  assert.ok(session.workerReloadedAt);
  assert.equal(h.messages.some(m=>m.type==='play'),false);
});
test('worker recovery has a cooldown instead of an automatic reload loop',async()=>{
  const h=harness(()=>({ok:false,error:'Unknown request.'}),{rawInitialize:true,session:{workerReloadedAt:Date.now()}});
  await settle();
  assert.equal(h.messages.some(m=>m.type==='runtime-reload'),false);
  assert.match(h.nodes.get('status').textContent,/incompatible extension files/);
});
test('playlist browsing and Play remain available while the session request is stalled',async()=>{
  const finishStatus=[];
  const h=harness(message=>{
    if(message.type==='initialize')return {ok:true,connected:true};
    if(message.type==='status')return new Promise(resolve=>{finishStatus.push(resolve);});
    if(message.type==='playlists')return library;
    if(message.type==='playlistItems')return {ok:true,items:[],nextOffset:null};
    if(message.type==='queue')return {ok:true,items:[],current:null};
    return {ok:true};
  });
  await settle();
  assert.equal(h.nodes.get('playlists').children.length,1);
  assert.equal(h.nodes.get('playlists').children[0].disabled,false);
  await h.nodes.get('playlists').children[0].click();await settle();
  await h.nodes.get('play-playlist').click();await settle();
  assert.equal(h.messages.some(m=>m.type==='play'),true);
  for(const finish of finishStatus)finish({ok:true,connected:true,state:null});
  await settle();
});
test('opening a playlist loads songs without starting an audio player',async()=>{
  const track={name:'A song',uri:'spotify:track:1234567890123456789012',artists:[]};
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='playlistItems')return {ok:true,items:[{track,position:3}],nextOffset:null};
    if(message.type==='queue')return {ok:true,items:[],current:null};
    return {ok:true,connected:true,state:null};
  });await settle();
  await h.nodes.get('playlists').children[0].click();await settle();
  assert.equal(h.nodes.get('playlist-tracks').children.length,1);
  assert.equal(h.messages.some(m=>m.type==='play'),false);
  await h.nodes.get('playlist-tracks').children[0].click();await settle();
  const message=h.messages.find(m=>m.type==='play');
  assert.equal(message.uri,track.uri);assert.equal(message.context,library.items[0].uri);assert.equal(message.position,3);
});
test('queue loads from Spotify even when the playback-state endpoint returns empty',async()=>{
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='queue')return {ok:true,items:[{name:'Queued track'}],current:null};
    return {ok:true,connected:true,state:null};
  });await settle();
  assert.equal(h.nodes.get('queue').children.length,1);
});

test('history restoration shows the song without claiming to know its paused position',async()=>{
  const state={...phoneState(),source:'history',positionKnown:false,device:undefined,context:{type:'playlist'}};
  const h=harness(message=>{
    if(message.type==='playlists')return library;
    if(message.type==='queue')return {ok:true,items:[],current:null};
    return {ok:true,connected:true,state};
  });await settle();
  assert.equal(h.nodes.get('track').textContent,'Phone song');
  assert.equal(h.nodes.get('elapsed').textContent,'—:—');
  assert.equal(h.nodes.get('seek').disabled,true);assert.equal(h.nodes.get('shuffle').disabled,true);
  assert.equal(h.nodes.get('toggle').disabled,false);
  assert.equal(h.nodes.get('device').textContent,'Recently played · Playlist');
  assert.match(h.nodes.get('status').textContent,/position unavailable/);
  assert.equal(h.messages.some(message=>message.type==='play'||message.type==='control'),false);
  await h.nodes.get('play').click();await settle();
  assert.equal(h.messages.some(message=>message.type==='play'),true);
});

test('popup automatically upgrades a worker with the previous restore protocol',async()=>{
  const h=harness(()=>({ok:true,connected:true,protocol:2}),{rawInitialize:true});
  await settle();assert.equal(h.messages.filter(message=>message.type==='runtime-reload').length,1);
});

test('a new user is taken to account setup without attempting playback',async()=>{
  const h=harness(()=>({ok:false,configurationRequired:true,error:'Save your Spotify Client ID first.'}));
  await settle();
  assert.equal(h.messages.filter(message=>message.type==='open-setup').length,1);
  assert.equal(h.messages.some(message=>message.type==='play'),false);
  assert.match(h.nodes.get('status').textContent,/Client ID/);
});
