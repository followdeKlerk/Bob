import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const native=(name:string)=>readFileSync(new URL(`../apps/mobile/android/app/src/main/java/com/bobmobile/${name}.kt`,import.meta.url),"utf8");

test("runtime version consumers use installed package metadata, not stale inlined build constants",()=>{
 for(const name of ["AppDiagnostics","ApprovedDiagnostics","RuntimeDiagnostics","CrashDiagnostics","BobFiles","BobNotifications"]){
  const source=native(name);
  assert.doesNotMatch(source,/BuildConfig\.VERSION_(NAME|CODE)/,name);
  assert.match(source,/InstalledAppVersion\.get\(/,name);
 }
 const provider=native("InstalledAppVersion");
 assert.match(provider,/getPackageInfo\(context\.packageName, 0\)/);
 assert.match(provider,/info\.longVersionCode/);
 assert.doesNotMatch(provider,/BuildConfig\.VERSION_(NAME|CODE)/);
});

test("crash capture resolves version before the fatal handler and preserves stored historical attribution",()=>{
 const source=native("CrashDiagnostics");
 assert.ok(source.indexOf("InstalledAppVersion.get(app)")<source.indexOf("val handler = CrashFingerprints.handler(previous)"));
 assert.match(source,/capture\(error, System\.currentTimeMillis\(\), InstalledAppVersion\.cached\(\)\.code,/);
 assert.match(native("InstalledAppVersion"),/fun cached\(\): AppVersion = cache\.peek\(\)/);
 assert.match(source,/put\("versionCode", record\.versionCode\)/);
});
