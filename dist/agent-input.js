// Shared by the workflow and server: each specialist receives only its task inputs.
const brief=['topic','audience','goal','media','targetLength'];
const policies={
 research:{fields:['topic','audience','goal','sourceMaterial','editorialContext','webSearchEnabled'],artifacts:[]},
 planning:{fields:[...brief,'sourceMaterial','editorialContext'],artifacts:['research']},
 coordination:{fields:['topic','audience','goal','media','interviewAlreadyProvided','planning','research'],artifacts:[]},
 interview:{fields:[...brief,'sourceMaterial'],artifacts:['research','planning']},
 transcript:{fields:['topic','transcript'],artifacts:[]},
 writing:{fields:[...brief,'transcript','sourceMaterial','rules','editorialContext'],artifacts:['planning','transcript','research']},
 facts:{fields:['draft','transcript','rules'],artifacts:[]},
 style:{fields:['draft','transcript','rules'],artifacts:[]},
 structure:{fields:['draft','transcript','rules'],artifacts:[]},
 rewrite:{fields:[...brief,'draft','transcript','sourceMaterial','rules','verifiedFindings'],artifacts:[]},
 final_check:{fields:['draft','transcript','rules'],artifacts:[]},
 titles:{fields:[...brief,'draft','editorialContext'],artifacts:[]},
 visuals:{fields:['topic','draft','media'],artifacts:[]},
 publishing:{fields:[...brief,'draft','rules'],artifacts:['titles','visuals']},
 social:{fields:['topic','audience','goal','draft','media'],artifacts:['titles']},
 analytics:{fields:['topic','audience','goal','metrics'],artifacts:['planning','social']},
 paragraph:{fields:['paragraph','request','article','transcript','sources','rules'],artifacts:[]}
};
export function scopeAgentInput(id,input){
 const policy=policies[id];if(!policy)throw new Error('Unknown specialist');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('資料の形式を確認してください。');
 const scoped={};for(const field of policy.fields)if(Object.hasOwn(input,field))scoped[field]=input[field];
 if(policy.artifacts.length&&input.artifacts&&typeof input.artifacts==='object'){
  scoped.artifacts={};for(const stage of policy.artifacts)if(Object.hasOwn(input.artifacts,stage))scoped.artifacts[stage]=input.artifacts[stage];
 }
 return scoped;
}

// A Japanese character target is not a reason to reserve 8,000 tokens for every short article.
// Largest max_tokens any agent requests; the connection check reserves this much so a low balance is caught early.
export const MAX_AGENT_OUTPUT_TOKENS=8000;
export function agentOutputBudget(id,input={}){
 if(id!=='writing')return 4000;
 const length=Number(input.targetLength);
 return Number.isFinite(length)&&length>0?Math.min(MAX_AGENT_OUTPUT_TOKENS,Math.max(1800,Math.ceil(length*1.6+600))):4000;
}
