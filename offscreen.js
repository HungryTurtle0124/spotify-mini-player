let player,deviceId,state=null,failure='',volume=.5;
let resolveReady,rejectReady;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
ready.catch(()=>{});
const timeout=setTimeout(()=>fail('Spotify did not initialize. Check your connection and Chrome protected-content settings.'),22000);
function fail(message){failure=message;clearTimeout(timeout);rejectReady(new Error(message));}
window.onSpotifyWebPlaybackSDKReady=()=>{
  player=new Spotify.Player({name:'Chrome Mini Player',volume,enableMediaSession:true,getOAuthToken:callback=>{
    chrome.runtime.sendMessage({type:'token'}).then(result=>{if(!result?.ok) throw new Error(result?.error||'Connect Spotify first.');callback(result.token);}).catch(error=>fail(error.message));
  }});
  player.addListener('ready',data=>{deviceId=data.device_id;failure='';clearTimeout(timeout);resolveReady(deviceId);});
  player.addListener('not_ready',()=>{deviceId=null;state=null;failure='Spotify disconnected. Wait 30 seconds, then try Play here again.';});
  player.addListener('player_state_changed',next=>{state=next?{...next,updatedAt:Date.now()}:null;});
  player.addListener('autoplay_failed',()=>fail('Chrome blocked background autoplay. This route needs further compatibility work.'));
  for(const event of ['initialization_error','authentication_error','account_error','playback_error']) player.addListener(event,error=>fail(error.message));
  player.connect().then(connected=>{if(!connected) fail('Spotify could not connect the background player.');}).catch(error=>fail(error.message));
};
async function handle(message){
  if(message.type==='ready'){await ready;if(failure||!deviceId) throw new Error(failure||'Player disconnected.');return {ok:true,deviceId};}
  if(message.type==='status') return {ok:true,state,deviceId,volume,error:failure};
  if(message.type==='control'){
    await ready;if(!deviceId||failure) throw new Error(failure||'Player disconnected.');
    if(!['togglePlay','previousTrack','nextTrack','seek','setVolume'].includes(message.command)) throw new Error('Unknown command.');
    await player[message.command](message.value);if(message.command==='setVolume') volume=message.value;return {ok:true};
  }
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||message.target!=='audio') return;
  handle(message).then(reply).catch(error=>reply({ok:false,error:error.message}));return true;
});
