import {z} from 'zod';
import * as schema from '@earendil-works/pi-schema';
import {getSupportedThinkingLevels,type Models} from '@earendil-works/pi-ai/models';
import {Thinking,type DelegationConfig,type DelegationRoute} from './delegation-config.js';

const Name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
// Delegation configuration imports the module catalog, which also loads runtime tools.
// Delay reading its thinking enum until validation to keep CLI import order safe.
export const CustomDelegation=z.lazy(()=>z.object({
 baseProfile:Name,provider:Name,model:z.string().trim().min(1).max(200),reasoning_effort:Thinking,
 instructions:z.string().trim().min(1).max(12000).optional(),
}).strict());
export type CustomDelegation=z.infer<typeof CustomDelegation>;
export type DelegationSelection={option?:string;profile?:string;custom?:CustomDelegation};
/** Custom routing requires an existing profiled tool-policy boundary. */
export function hasCustomDelegation(config:DelegationConfig){return config.mode==='profile_routes'&&config.profileRoutes.profiles.length>0;}
export function customDelegationSchema(config:DelegationConfig){return schema.obj({
 baseProfile:schema.union(config.profileRoutes.profiles.map(p=>schema.lit(p.name)),{description:'Existing profile whose tool permissions, modules, skills and working directory remain unchanged.'}),
 provider:schema.str({minLength:1,maxLength:64,description:'Configured authenticated provider from action=models; no custom endpoint or credential overrides.'}),
 model:schema.str({minLength:1,maxLength:200}),
 reasoning_effort:schema.union(Thinking.options.map(level=>schema.lit(level)),{description:'Explicit supported thinking level from action=models; never silently substituted.'}),
 instructions:schema.opt(schema.str({minLength:1,maxLength:12000,description:'Extra bounded role/task instructions, appended to the base profile. Does not grant tools or change scope.'})),
});}
export function customSelection(config:DelegationConfig,args:DelegationSelection){
 // Presence of the object distinguishes an override from an existing preset named custom.
 if(args.custom===undefined){
  if(args.profile!=='custom'||config.profileRoutes.profiles.some(p=>p.name==='custom'))return;
  if(hasCustomDelegation(config))throw Error('Custom spawn requires profile=custom and a complete custom selection.');
  return;
 }
 if(!hasCustomDelegation(config))throw Error('Custom routing is unavailable in this snapshot; use configured profiles or refresh this settled chat.');
 if(args.profile!=='custom'||args.custom===undefined||args.option!==undefined)throw Error('Custom spawn requires profile=custom and a complete custom selection.');
 const parsed=CustomDelegation.safeParse(args.custom);
 if(!parsed.success)throw Error('Invalid Custom selection. Supply baseProfile, provider, model, supported reasoning_effort and optional instructions only.');
 const custom=parsed.data;
 if(custom.provider.startsWith('bob-ad-'))throw Error('Internal delegation aliases cannot be selected as a Custom provider.');
 if(!config.profileRoutes.profiles.some(p=>p.name===custom.baseProfile))throw Error('Custom baseProfile must be an allowlisted profile.');
 const profile=config.profiles.find(p=>p.name===custom.baseProfile);
 if(!profile)throw Error('Custom base profile is unavailable.');
 // Build from explicit catalog fields, never spread a preset's endpoint/secret/tier.
 const route:DelegationRoute={provider:custom.provider,model:custom.model,reasoning_effort:custom.reasoning_effort,service_tier:'normal',credential:{kind:'provider',provider:custom.provider}};
 return {label:'custom',route,profile,instructions:custom.instructions};
}

const ModelQuery=z.object({provider:Name.optional(),offset:z.number().int().min(0).max(100000).default(0)}).strict();
/** Catalog/auth checks only: no refresh, credential resolution or inference calls. */
export async function customDelegationModels(models:Models,query:unknown){
 const parsed=ModelQuery.safeParse(query??{});if(!parsed.success)throw Error('Invalid models query; use optional provider and offset only.');
 const {provider,offset}=parsed.data;
 if(provider&&(!models.getProvider(provider)||provider.startsWith('bob-ad-')))throw Error('Unknown configured Custom provider.');
 let available;
 try{available=await models.getAvailable(provider);}catch{throw Error('Configured model availability could not be checked; no inference was attempted.');}
 const rows=available.filter(model=>!model.provider.startsWith('bob-ad-')).map(model=>({provider:model.provider,model:model.id,thinkingLevels:getSupportedThinkingLevels(model)})).sort((a,b)=>a.provider.localeCompare(b.provider)||a.model.localeCompare(b.model));
 const page=rows.slice(offset,offset+50);
 return {models:page,total:rows.length,...(offset+page.length<rows.length?{nextOffset:offset+page.length}:{}),note:'Configured authenticated catalog, not a live capability guarantee. Use an explicit listed thinking level; spawn validates again. Custom keeps the selected base profile permissions and uses normal service tier.'};
}
