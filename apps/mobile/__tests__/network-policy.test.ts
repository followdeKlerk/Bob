import {responseData,retryableError,retryAfter,retryDelay} from '../network-policy';
test('backoff starts near one second, increases, stays capped and includes jitter',()=>{
 expect(retryDelay(1,()=>0.5)).toBe(1000);expect(retryDelay(2,()=>0.5)).toBe(2000);
 expect(retryDelay(100,()=>1)).toBe(30000);expect(retryDelay(100,()=>0)).toBe(20000);
 expect(retryDelay(1,()=>0)).not.toBe(retryDelay(1,()=>1));
});
test.each([408,425,429,500,502,503,504])('transient HTTP %s remains retryable',httpStatus=>{expect(retryableError({httpStatus})).toBe(true);});
test.each([400,401,403,404,409,412,413,422])('terminal HTTP %s requires attention rather than automatic replay',httpStatus=>{expect(retryableError({httpStatus})).toBe(false);});
test('native upload failures follow the same retry rules as JS requests',()=>{
 expect(retryableError({code:'attachment'})).toBe(false);expect(retryableError({code:'transfer'})).toBe(true);
 expect(retryableError({code:'http_401'})).toBe(false);expect(retryableError({code:'http_429',userInfo:{httpStatus:429}})).toBe(true);
});
test('Retry-After supports seconds and HTTP dates without accepting invalid values',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z');expect(retryAfter('2',now)).toBe(2000);
 expect(retryAfter('Thu, 01 Jan 2026 00:01:00 GMT',now)).toBe(60000);
 expect(retryAfter('Wed, 31 Dec 2025 00:00:00 GMT',now)).toBe(0);expect(retryAfter('nonsense',now)).toBeUndefined();
});
test('non-JSON errors retain HTTP status and server retry instructions',async()=>{
 const response={ok:false,status:503,json:async()=>{throw SyntaxError('HTML proxy page');},headers:{get:()=> '10'}} as unknown as Response;
 await expect(responseData(response)).rejects.toMatchObject({httpStatus:503,retryAfterMs:10000,message:'HTTP 503'});
 await expect(responseData({...response,status:401})).rejects.toMatchObject({httpStatus:401});
});
