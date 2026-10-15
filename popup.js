const $ = selector => document.querySelector(selector);
let snapshot=null,busy=false,uiError='',syncError='',connected=false,authRequired=false;
let updating=null,playbackRevision=0,initialized=false,initializing=false,authRecoveryAttempted=false,view='playlists',lastTrack='',queueLoading=false;
const format=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
async function send(message){
  let timer;
  const result=await Promise.race([chrome.runtime.sendMessage(message),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('The '+message.type+' request timed out. Please try again.')),message.type==='initialize'?180000:message.type==='play'?45000:20000);
  })]).finally(()=>clearTimeout(timer));
  if(!result?.ok) throw Object.assign(new Error(result?.error||'Extension unavailable. Reopen the popup.'),{authRequired:result?.authRequired,configurationRequired:result?.configurationRequired});
  return result;
}
function render(){
  const fromHistory=snapshot?.source==='history';
  const track=snapshot?.track_window?.current_track;
  $('#track').textContent=track?.name||'Choose your music.';
  $('#artist').textContent=track?.artists?.map(artist=>artist.name).join(', ')||'Pick a playlist below to get started.';
  const image=track?.album?.images?.[0]?.url;
  $('#cover').hidden=!image;if(image&&$('#cover').src!==image)$('#cover').src=image;
  const disallows=snapshot?.disallows||{};
  const restrictions={previousTrack:'skipping_prev',nextTrack:'skipping_next',seek:'seeking',
    shuffle:'toggling_shuffle',repeat:snapshot?.repeat==='context'?'toggling_repeat_track':'toggling_repeat_context',
    togglePlay:snapshot?.paused?'resuming':'pausing'};
  document.querySelectorAll('[data-command]').forEach(button=>{
    button.disabled=!snapshot||busy||Boolean(disallows[restrictions[button.dataset.command]])||
      (fromHistory&&button.dataset.command!=='togglePlay');
  });
  $('#seek').disabled=!snapshot||snapshot.positionKnown===false||busy||Boolean(disallows.seeking);$('#seek').max=snapshot?.duration||1;
  $('#duration').textContent=format(snapshot?.duration||0);
  if(!snapshot){$('#elapsed').textContent='0:00';$('#seek').value=0;}
  const device=snapshot?.device;
  $('#volume').disabled=!device?.id||device.supports_volume===false||busy;
  if(document.activeElement!==$('#volume'))$('#volume').value=device?.volume_percent??50;
  const paused=!snapshot||snapshot.paused;
  $('#toggle').textContent=paused?'▶':'Ⅱ';$('#toggle').setAttribute('aria-label',paused?'Play on this PC':'Pause');
  $('#shuffle').setAttribute('aria-pressed',String(Boolean(snapshot?.shuffle)));
  const repeat=snapshot?.repeat||'off';
  $('#repeat').textContent=repeat==='track'?'↻ 1':'↻';
  $('#repeat').setAttribute('aria-pressed',String(repeat!=='off'));
  $('#repeat').setAttribute('aria-label','Repeat: '+({off:'off',context:'playlist',track:'song'}[repeat]||'off')+'. Click to change.');
  $('#repeat').title=$('#repeat').getAttribute('aria-label');
  $('#play').hidden=!snapshot;$('#play').disabled=busy||Boolean(disallows.transferring_playback);
  $('#play').textContent=fromHistory?'Play recent song on this PC':'Continue on this PC';
  $('#load').disabled=busy||!connected;
  $('#reconnect').hidden=!authRequired;$('#reconnect').disabled=busy;
  $('#device').textContent=fromHistory?'Recently played'+(snapshot.context?.type==='playlist'?' · Playlist':''):device?.name?(paused?'Paused on ':'Playing on ')+device.name:'';
  $('#status').textContent=busy?'Connecting to Spotify…':uiError||syncError||(!connected?'Connect Spotify to load your music.':snapshot?
    (fromHistory?'Last song from Spotify history. Paused position unavailable; Play starts this song again.':paused?'Ready to continue from this position.':'Your Spotify session is in sync.'):'No session to restore. Choose a playlist below.');
  document.querySelectorAll('.playlist-row').forEach(button=>button.disabled=!connected);
  position();
}
function position(){
  if(!snapshot)return;
  if(snapshot.positionKnown===false){$('#elapsed').textContent='—:—';$('#seek').value=0;return;}
  const now=Math.min(snapshot.duration,snapshot.position+(snapshot.paused?0:Date.now()-snapshot.updatedAt));
  if(document.activeElement!==$('#seek'))$('#seek').value=now;
  $('#elapsed').textContent=format(now);
}
async function update(){
  if(updating)return updating;
  const revision=playbackRevision;
  const pending=(async()=>{
    try{
      let result=await send({type:'status'});
      if(result.authRequired&&!authRecoveryAttempted){
        authRecoveryAttempted=true;
        await send({type:'initialize',reauthorize:true});
        result=await send({type:'status'});
        if(result.connected){loadPlaylists(true);loadQueue();}
      }
      if(result.connected&&!result.authRequired)authRecoveryAttempted=false;
      if(revision!==playbackRevision)return;
      snapshot=result.state;connected=result.connected;authRequired=Boolean(result.authRequired);
      syncError=result.error||'';
      const track=snapshot?.track_window?.current_track?.uri||'';
      if(track!==lastTrack){lastTrack=track;if(view==='queue')loadQueue();}
    }catch(error){if(revision!==playbackRevision)return;syncError=error.message;snapshot=null;if(error.authRequired){authRequired=true;connected=false;}}
    render();
  })();
  updating=pending;
  try{return await pending;}finally{if(updating===pending)updating=null;}
}
async function action(message){
  if(busy)return;
  busy=true;uiError='';playbackRevision++;updating=null;render();
  try{await send(message);}catch(error){uiError=error.message;if(error.authRequired){authRequired=true;connected=false;}}
  finally{busy=false;render();update();loadQueue();}
}
$('#setup').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('#play').addEventListener('click',()=>action({type:'play'}));
$('#load').addEventListener('click',()=>action({type:'play',uri:$('#uri').value}));
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{
  const command=button.dataset.command;
  const value=command==='shuffle'?!snapshot?.shuffle:command==='repeat'?({off:'context',context:'track',track:'off'}[snapshot?.repeat||'off']):undefined;
  action({type:'control',command,value});
}));
$('#seek').addEventListener('change',()=>action({type:'control',command:'seek',value:Number($('#seek').value)}));
$('#volume').addEventListener('change',()=>action({type:'control',command:'setVolume',value:Number($('#volume').value)/100}));
let nextOffset=null,libraryLoading=false;
function row(item,subtitle,playable=false){
  const element=document.createElement(playable?'button':'li');element.className=playable?'playlist-row':'queue-row';
  const artwork=item.images?.[0]?.url||item.album?.images?.[0]?.url;
  if(artwork){const image=document.createElement('img');image.src=artwork;image.alt='';image.loading='lazy';element.append(image);}
  const label=document.createElement('span');const title=document.createElement('strong');title.textContent=item.name||'Unavailable track';
  const detail=document.createElement('small');detail.textContent=subtitle;label.append(title,detail);element.append(label);
  if(playable){
    element.setAttribute('aria-label',(item.uri?.startsWith('spotify:playlist:')?'Open ':'Play ')+item.name);element.disabled=!connected;
    element.addEventListener('click',()=>item.uri?.startsWith('spotify:playlist:')?openPlaylist(item):action({type:'play',uri:item.uri}));
  }
  return element;
}
async function loadPlaylists(reset=false){
  if(libraryLoading)return;
  libraryLoading=true;$('#refresh-library').disabled=true;$('#more').disabled=true;
  if(reset){$('#playlists').replaceChildren();nextOffset=null;$('#more').hidden=true;}
  $('#library-status').textContent='Loading playlists…';
  try{
    const page=await send({type:'playlists',offset:reset?0:nextOffset??0});
    for(const playlist of page.items)$('#playlists').append(row(playlist,playlist.owner||'Spotify playlist',true));
    nextOffset=page.nextOffset;$('#more').hidden=nextOffset===null;
    $('#library-status').textContent=$('#playlists').children.length?'Choose a playlist to play on this PC.':'No playlists found in this account.';
  }catch(error){$('#library-status').textContent=error.message;}
  finally{libraryLoading=false;$('#refresh-library').disabled=false;$('#more').disabled=false;}
}
async function loadQueue(){
  if(queueLoading)return;
  if(!connected)return;
  queueLoading=true;$('#refresh-queue').disabled=true;$('#queue-status').textContent='Loading queue…';
  try{
    const page=await send({type:'queue'});$('#queue').replaceChildren();$('#queue-current').replaceChildren();
    if(page.current)$('#queue-current').append(row(page.current,'Now playing · '+(page.current.artists||[]).map(a=>a.name).join(', ')));
    for(const item of page.items)$('#queue').append(row(item,(item.artists||[]).map(a=>a.name).join(', ')));
    $('#queue-status').textContent=page.items.length?'Up next · Spotify playback order':'Nothing queued. Choose a playlist.';
  }catch(error){$('#queue').replaceChildren();$('#queue-current').replaceChildren();$('#queue-status').textContent='Queue unavailable. '+error.message;}
  finally{queueLoading=false;$('#refresh-queue').disabled=false;}
}
function selectView(selected){
  view=selected;
  for(const name of ['queue','playlists']){
    $('#show-'+name).setAttribute('aria-pressed',String(view===name));$('#'+name+'-panel').hidden=view!==name;
  }
  if(view==='queue')loadQueue();
}
$('#show-queue').addEventListener('click',()=>selectView('queue'));
$('#show-playlists').addEventListener('click',()=>selectView('playlists'));
$('#refresh-queue').addEventListener('click',loadQueue);
$('#refresh-library').addEventListener('click',()=>loadPlaylists(true));
$('#more').addEventListener('click',()=>loadPlaylists());
let selectedPlaylist=null,tracksLoading=null,tracksOffset=null;
async function openPlaylist(playlist){
  selectedPlaylist=playlist;tracksOffset=null;
  $('#playlist-name').textContent=playlist.name;
  $('#playlist-detail').hidden=false;$('#playlists').hidden=true;$('#more').hidden=true;
  $('#playlist-tracks').replaceChildren();
  await loadTracks();
}
async function loadTracks(){
  if(!selectedPlaylist||tracksLoading===selectedPlaylist)return;
  const playlist=selectedPlaylist;
  tracksLoading=playlist;$('#more-tracks').hidden=true;
  $('#playlist-status').textContent='Loading songs…';
  try{
    const page=await send({type:'playlistItems',id:playlist.uri.split(':')[2],offset:tracksOffset??0});
    if(selectedPlaylist!==playlist)return;
    for(const {track,position:offset} of page.items){
      if(!track)continue;
      const element=row(track,(track.artists||[]).map(a=>a.name).join(', '));
      const button=document.createElement('button');button.className='track-choice';
      button.setAttribute('aria-label','Play '+track.name);
      button.disabled=track.is_playable===false||Boolean(track.is_local)||!track.uri;
      button.append(...element.children);
      button.addEventListener('click',()=>action({type:'play',uri:track.uri,context:playlist.uri,position:offset}));
      $('#playlist-tracks').append(button);
    }
    tracksOffset=page.nextOffset;$('#more-tracks').hidden=tracksOffset===null;
    $('#playlist-status').textContent=$('#playlist-tracks').children.length?'Choose a song, or play the whole playlist.':'No playable songs returned. You can still try Play playlist.';
  }catch(error){$('#playlist-status').textContent=error.message;}
  finally{if(tracksLoading===playlist)tracksLoading=null;}
}
$('#back-library').addEventListener('click',()=>{
  selectedPlaylist=null;$('#playlist-detail').hidden=true;$('#playlists').hidden=false;$('#more').hidden=nextOffset===null;
});
$('#play-playlist').addEventListener('click',()=>{if(selectedPlaylist)action({type:'play',uri:selectedPlaylist.uri});});
$('#more-tracks').addEventListener('click',loadTracks);
async function initialize(){
  if(initializing)return;
  initializing=true;initialized=false;authRecoveryAttempted=false;uiError='';syncError='';render();
  $('#status').textContent='Connecting your Spotify account…';
  try{
    const result=await send({type:'initialize'});
    if(result.protocol!==4) {await recoverWorker();return;}
    connected=result.connected;authRequired=false;
  }catch(error){
    if(/^Unknown request\b/.test(error.message)) {await recoverWorker();return;}
    if(error.configurationRequired){connected=false;authRequired=false;uiError=error.message;chrome.runtime.openOptionsPage();return;}
    snapshot=null;connected=false;authRequired=true;uiError=error.message;
  }finally{initializing=false;initialized=true;render();}
  if(connected)await Promise.allSettled([update(),loadPlaylists(true),loadQueue()]);
}
async function recoverWorker(){
  try {
    const {workerReloadedAt}=await chrome.storage.session.get('workerReloadedAt');
    if(workerReloadedAt && Date.now()-workerReloadedAt<60000) throw new Error('Chrome is still using incompatible extension files. Check that the installed extension points to this project folder.');
    await chrome.storage.session.set({workerReloadedAt:Date.now()});
    $('#status').textContent='Updating the background player automatically. Open the extension again after it closes.';
    chrome.runtime.reload();
  }catch(error){uiError=error.message;connected=false;authRequired=false;render();}
}
$('#reconnect').addEventListener('click',initialize);
initialize();
setInterval(()=>{if(initialized&&connected&&!busy&&!document.hidden)update();},5000);
setInterval(()=>{if(initialized&&connected&&!busy&&view==='queue'&&!document.hidden)loadQueue();},15000);
setInterval(position,500);
