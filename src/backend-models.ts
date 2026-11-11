import {createModels} from '@earendil-works/pi-ai/models';
import {anthropicProvider} from '@earendil-works/pi-ai/providers/anthropic';
import {bobOpenAIProvider} from './openai-provider.js';
import {providerCredentials} from './provider-auth.js';
import type {State} from './state.js';

export function createBackendModels(state:State){
  const models=createModels({credentials:providerCredentials(state),authContext:{
    env:async name=>name==='OPENAI_API_KEY'?state.get<string>('openaiKey'):name==='ANTHROPIC_API_KEY'?state.get<string>('anthropicKey'):undefined,
    fileExists:async()=>false,
  }});
  models.setProvider(bobOpenAIProvider());models.setProvider(anthropicProvider());
  return models;
}
