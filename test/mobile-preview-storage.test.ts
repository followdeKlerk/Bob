import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Structural ownership guard, not a physical-device preview/rotation test.
// Downloads, camera staging and update files share this native directory.
test('opening an attachment never sweeps shared preview, camera or update storage',()=>{
 const files=readFileSync('apps/mobile/android/app/src/main/java/com/bobmobile/BobFiles.kt','utf8');
 const preview=files.slice(files.indexOf('@ReactMethod fun preview('));
 assert.match(preview,/@ReactMethod\s+fun\s+preview\(/);
 assert.doesNotMatch(preview,/\b(?:listFiles|walk|walkTopDown|walkBottomUp|deleteRecursively)\s*\(/);
 assert.match(preview,/File\(dir,\s*UUID\.randomUUID\(\)\.toString\(\)\)/);
 assert.match(preview,/catch\s*\(e:\s*Exception\)\s*\{\s*file\?\.delete\(\)/);
});
