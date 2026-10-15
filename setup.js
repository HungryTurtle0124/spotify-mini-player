const redirect = document.querySelector('#redirect');
const status = document.querySelector('#status');
const connect = document.querySelector('#connect');
const disconnect = document.querySelector('#disconnect');
const client = document.querySelector('#client-id');
const save = document.querySelector('#save-client');
redirect.value = chrome.identity.getRedirectURL('callback');
async function request(message){
  const result=await chrome.runtime.sendMessage(message);
  if(!result?.ok)throw new Error(result?.error||'Could not reach the player. Reopen account setup.');
  return result;
}
async function update() {
  const {clientId,connected}=await request({type:'configuration'});
  client.value=clientId;
  disconnect.hidden = !connected;
  connect.disabled=!clientId;
  connect.textContent = connected ? 'Reconnect Spotify' : 'Connect Spotify';
  status.textContent = connected ? 'Account connected. Open the toolbar popup to load your Spotify session.' : clientId?'Ready when your redirect URL is saved.':'Save your Spotify Client ID to begin.';
}
async function saveClient(){await request({type:'configure',clientId:client.value});}
save.addEventListener('click',async()=>{
  save.disabled=true;
  try{await saveClient();await update();status.textContent='Client ID saved. Add the redirect URL to that app, then connect.';}
  catch(error){status.textContent=error.message;}
  finally{save.disabled=false;}
});
document.querySelector('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(redirect.value); status.textContent = 'Copied. Add this URL in Spotify’s app settings and save.'; }
  catch { redirect.select(); status.textContent = 'Press Ctrl+C to copy the selected address.'; }
});
connect.addEventListener('click', async () => {
  connect.disabled = true;
  status.textContent = 'Waiting for Spotify sign-in…';
  try {
    await saveClient();
    await request({type:'connect'});
    await update();
  } catch (error) { status.textContent = error.message; }
  finally { connect.disabled = false; }
});
disconnect.addEventListener('click',async()=>{
  try{await request({type:'disconnect'});await update();}
  catch(error){status.textContent=error.message;}
});
update().catch(error=>{status.textContent=error.message;});
