import {inlineMediaSizing} from '../components/media-sizing';
test('native sizing reserves only the surface and an accessible 48dp seek target',()=>{
 expect(inlineMediaSizing(1,288,false)).toEqual({videoHeight:0,seekHeight:48,height:48});
 expect(inlineMediaSizing(1,288,true)).toEqual({videoHeight:162,seekHeight:48,height:210});
});
test.each([1.3,1.5,2,3])('font scale %s cannot clip labels: all player text is outside the native fixed-height host',scale=>{
 expect(inlineMediaSizing(scale,288,false)).toEqual(inlineMediaSizing(1,288,false));
 expect(inlineMediaSizing(scale,288,true)).toEqual(inlineMediaSizing(1,288,true));
});
test('video uses its available width rather than a fixed tiny viewport',()=>{
 expect(inlineMediaSizing(2,640,true)).toEqual({videoHeight:360,seekHeight:48,height:408});
 expect(inlineMediaSizing(2,160,true).videoHeight).toBe(120);
});
test('invalid metrics fail to bounded defaults',()=>{
 expect(inlineMediaSizing(NaN,NaN,true)).toEqual(inlineMediaSizing(1,288,true));
 expect(inlineMediaSizing(1,0,false)).toEqual(inlineMediaSizing(1,288,false));
});
