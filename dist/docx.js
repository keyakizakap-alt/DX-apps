// Reads a Word document locally; never sends files to a conversion service.
const MAX_XML_BYTES=1000000;
export function documentEntry(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const fail=()=>{throw new Error('Wordファイルを読み取れませんでした。文章をコピーして貼り付けることもできます。');};
  if(bytes.length<22||bytes.length>500000)fail();
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}}
  if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)fail();
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),length=view.getUint32(end+12,true);
  if(count>1000||offset+length>end)fail();let cursor=offset;
  for(let index=0;index<count;index++){
    if(cursor+46>offset+length||view.getUint32(cursor,true)!==0x02014b50)fail();
    const nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),next=cursor+46+nameLength+extra+comment;
    if(next>offset+length)fail();const name=new TextDecoder().decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(name==='word/document.xml'){
      const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),compressed=view.getUint32(cursor+20,true),uncompressed=view.getUint32(cursor+24,true),local=view.getUint32(cursor+42,true);
      if((flags&1)||![0,8].includes(method)||uncompressed>MAX_XML_BYTES||local+30>offset||view.getUint32(local,true)!==0x04034b50)fail();
      const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
      if(start+compressed>offset)fail();return {method,uncompressed,data:bytes.slice(start,start+compressed)};
    }
    cursor=next;
  }
  fail();
}
export async function readDocx(file){
  if(file.size>500000)throw new Error('500KB以内のWordファイルをご利用ください。');
  const entry=documentEntry(await file.arrayBuffer());let bytes=entry.data;
  if(entry.method===8){
    let stream;try{stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw new Error('このブラウザではWordを読み込めません。文章をコピーして貼り付けてください。');}
    const reader=stream.getReader(),chunks=[];let total=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_XML_BYTES){await reader.cancel();throw new Error('Wordの文章が長すぎます。必要な部分をコピーして貼り付けてください。');}chunks.push(value);}}catch(e){throw new Error(e.message.includes('長すぎ')?e.message:'Wordの文章を読み取れませんでした。コピーして貼り付けることもできます。');}
    bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  }
  if(bytes.length!==entry.uncompressed||bytes.length>MAX_XML_BYTES)throw new Error('Wordファイルの内容を読み取れませんでした。');
  let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Wordの文字を読み取れませんでした。文章をコピーして貼り付けてください。');}
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('このWordファイルは読み込めません。文章をコピーして貼り付けてください。');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const namespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  if(doc.querySelector('parsererror')||!doc.getElementsByTagNameNS(namespace,'document').length)throw new Error('Wordの文章を読み取れませんでした。');
  return [...doc.getElementsByTagNameNS(namespace,'p')].map(p=>[...p.getElementsByTagNameNS(namespace,'t')].map(t=>t.textContent).join('')).join('\n');
}
