import {attentionItems,attentionKey} from './supervisor.js';
export function createNotificationCenter({deliver=()=>{},onChange=()=>{}}={}) {
  const seen=new Set();let records=[];
  return {
    update(run) {
      const active=new Set(run?attentionItems(run).map(item=>attentionKey(run,item)):[]);
      records=records.map(r=>({...r,active:active.has(r.key)}));
      for(const item of run?attentionItems(run):[]) {
        const key=attentionKey(run,item);if(seen.has(key))continue;seen.add(key);
        const record={key,action:item.action,title:item.title,time:new Date().toISOString(),read:false,active:true};
        records.unshift(record);records=records.slice(0,30);
        try{deliver(record);}catch{/* Notification failure never stops a production run. */}
      }
      onChange(records.map(r=>({...r})));return records;
    },
    read(key){records=records.map(r=>r.key===key?{...r,read:true}:r);onChange(records.map(r=>({...r})));},
    clear(){records=[];seen.clear();onChange([]);},
    records(){return records.map(r=>({...r}));}
  };
}
