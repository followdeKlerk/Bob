/** Retry only reads and mutations with an explicit, server-deduplicated identity. */
export function retryableError(error:unknown):boolean {
 const detail=error as {httpStatus?:number;code?:string;userInfo?:{httpStatus?:number}}??{};
 const {code}=detail;
 const httpStatus=detail.httpStatus??detail.userInfo?.httpStatus??(code?.match(/^http_(\d{3})$/)?Number(code.slice(5)):undefined);
 return code!=='attachment'&&(!httpStatus||httpStatus===408||httpStatus===425||httpStatus===429||httpStatus>=500);
}
/** About one second initially, bounded exponential backoff with jitter thereafter. */
export function retryDelay(attempt:number,random:()=>number=Math.random):number {
 return Math.round(Math.min(25000,1000*2**Math.min(5,Math.max(0,attempt-1)))*(0.8+0.4*random()));
}
export function retryAfter(value:string|null|undefined,now=Date.now()):number|undefined {
 if(!value)return undefined;
 const milliseconds=/^\d+(\.\d+)?$/.test(value.trim())?Number(value)*1000:Date.parse(value)-now;
 return Number.isFinite(milliseconds)?Math.max(0,milliseconds):undefined;
}
/** Preserve HTTP identity even when a proxy returns HTML or an empty error body. */
export async function responseData(response:Response):Promise<any> {
 let data:any;
 try{data=await response.json();}catch(error){if(response.ok)throw error;}
 if(!response.ok)throw Object.assign(Error(typeof data?.error==='string'?data.error:`HTTP ${response.status}`),{
  httpStatus:response.status,retryAfterMs:retryAfter(response.headers?.get?.('Retry-After')),
 });
 return data;
}
