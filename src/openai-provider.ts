import type {Model} from '@earendil-works/pi-ai';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';

/** Compatibility entry until pi-ai's static OpenAI catalogue includes Terra.
 * Keep the native provider's authentication, transport and availability filters.
 * An upstream entry wins unchanged when the dependency catches up.
 * Specs: https://developers.openai.com/api/docs/models/gpt-6.1-terra
 */
export const terraModel:Model<'openai-responses'>={
 id:'gpt-6.1-terra',name:'GPT-6.1 Terra',provider:'openai',api:'openai-responses',baseUrl:'https://api.openai.com/v1',
 reasoning:true,input:['text','image'],contextWindow:1050000,maxTokens:128000,
 cost:{input:1,output:5,cacheRead:.05,cacheWrite:1.25,tiers:[{inputTokensAbove:272000,input:2,output:7.5,cacheRead:.1,cacheWrite:2.5}]},
 thinkingLevelMap:{off:'none',minimal:null,low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'},
 // Only advertise verified/documented capabilities, not Sol's entire compat set.
 compat:{supportsStrictMode:true},
};
export function bobOpenAIProvider(provider=openaiProvider()){
 if(provider.getModels().some(model=>model.id===terraModel.id))return provider;
 return {...provider,
  getModels:()=>[...provider.getModels(),terraModel],
  getAllModels:()=>[...(provider.getAllModels?.()??provider.getModels()),terraModel],
 };
}
