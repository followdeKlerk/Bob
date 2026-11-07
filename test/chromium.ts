import {existsSync} from 'node:fs';
import {chromium} from 'playwright';

/** BOB_TEST_CHROMIUM=bundled selects Playwright's installed browser explicitly.
 * Other nonempty values are executable paths; invalid overrides must fail.
 * Prefer the existing local default, falling back to Playwright when absent.
 */
export function testChromiumExecutable(){
 const override=process.env.BOB_TEST_CHROMIUM;
 if(override==='bundled')return chromium.executablePath();
 return override||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath());
}
export function launchTestChromium(){
 return chromium.launch({headless:true,executablePath:testChromiumExecutable()});
}
