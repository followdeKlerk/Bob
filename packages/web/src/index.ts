import {defineExtension,defineTool} from '@earendil-works/pi-durable';
import * as schema from '@earendil-works/pi-schema';
import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
export function parseDuckDuckGoSearch(status:number,html:string){
 if(status===202||/anomaly-modal|anomaly-form|challenge-form|bots use DuckDuckGo/i.test(html))throw Error('DuckDuckGo bot challenge; search unavailable');
 if(status<200||status>=300)throw Error(`Search HTTP ${status}`);
 const matches=Array.from(html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)).slice(0,8).map(m=>({url:m[1].replaceAll('&amp;','&'),title:m[2].replace(/<[^>]*>/g,'')}));
 if(matches.length)return matches;
 if(/class=["'][^"']*\bresult--no-result\b/.test(html)&&/No results found/i.test(html))return [];
 throw Error('DuckDuckGo search response could not be parsed');
}
export function createWebTools(executablePath:string){
 let browser:Browser|undefined;
 const pages=new Map<number,{context:BrowserContext;page:Page}>();
 const getPage=async(id:number)=>{const old=pages.get(id);if(old)return old.page;browser??=await chromium.launch({executablePath,headless:true});const context=await browser.newContext({acceptDownloads:false});const page=await context.newPage();page.setDefaultTimeout(15000);pages.set(id,{context,page});return page;};
 const extension=defineExtension({name:'bob.web',tools:[
 defineTool({name:'web_search',description:'Search public web via DuckDuckGo HTML. Network failures and bot challenges are errors, not invented results.',parameters:schema.obj({query:schema.str({minLength:1,maxLength:1000})},{open:true}),replay:'safe',execute:async(args)=>{const r=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(args.query),{signal:AbortSignal.timeout(15000)});const html=await r.text();const matches=parseDuckDuckGoSearch(r.status,html);return {output:[{type:'text',text:JSON.stringify(matches)}]};}}),
 defineTool({name:'browser',description:'Control an isolated backend Chromium session per conversation. No inherited user cookies. Browser state is ephemeral: after restart navigate again. Actions: navigate(url), text, click(selector), fill(selector,text). This is an agent tool, not an embedded UI capability.',parameters:schema.obj({action:schema.union(['navigate','text','click','fill'].map(v=>schema.lit(v))),url:schema.opt(schema.str({maxLength:8000})),selector:schema.opt(schema.str({maxLength:2000})),text:schema.opt(schema.str({maxLength:20000}))},{open:true}),replay:'unsafe',execute:async(args,api)=>{const page=await getPage(api.conversationId);if(args.action==='navigate'){if(!args.url||!['https:','http:'].includes(new URL(args.url).protocol))throw Error('HTTP(S) URL required');await page.goto(args.url,{waitUntil:'domcontentloaded'});}else if(args.action==='click'){if(!args.selector)throw Error('Selector required');await page.locator(args.selector).first().click();}else if(args.action==='fill'){if(!args.selector||args.text===undefined)throw Error('Selector and text required');await page.locator(args.selector).first().fill(args.text);}const text=(await page.locator('body').innerText()).slice(0,30000);return {output:[{type:'text',text:`URL: ${page.url()}\n${text}`}],details:{url:page.url(),ephemeral:true}};}})
 ]});
 return {extension,async close(){await browser?.close();pages.clear();}};
}
