import {visualDisplayHeight} from '../visual-display-capability';

test('updated backend capability opts into content-sized metadata',()=>{
 expect(visualDisplayHeight({inlineHeight:8192})).toBe(8192);
});
test('older or unknown backend retains the compatible request format',()=>{
 for(const capability of [undefined,null,{},[],true,8192,{inlineHeight:420},{inlineHeight:9000},{inlineHeight:'8192'}])expect(visualDisplayHeight(capability)).toBe(420);
});
test('capability has no sticky cross-backend state',()=>{
 expect(visualDisplayHeight({inlineHeight:8192})).toBe(8192);
 expect(visualDisplayHeight(undefined)).toBe(420);
 expect(visualDisplayHeight({inlineHeight:8192})).toBe(8192);
});
