const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
const files=['manifest.json','background.js','popup.html','popup.js','setup.html','setup.js','style.css',
  'offscreen.html','offscreen.js','vendor/spotify-player.js','PRIVACY.md','THIRD_PARTY_NOTICES.md','INSTALL.md','LICENSE'];
// An explicit list excludes credentials, Git metadata, tests, and local build files.
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const local=[],central=[];let offset=0;
for(const filename of files){
  const data=fs.readFileSync(path.join(root,filename));const name=Buffer.from(filename);const crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
  header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);
  entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
  central.push(entry,name);offset+=header.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...local,directory,end]);
const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});
const name=`spotify-mini-player-${manifest.version}.zip`;fs.writeFileSync(path.join(dist,name),zip);
fs.writeFileSync(path.join(dist,name+'.sha256'),crypto.createHash('sha256').update(zip).digest('hex')+'  '+name+'\n');
console.log(`Built dist/${name} (${files.length} files).`);
