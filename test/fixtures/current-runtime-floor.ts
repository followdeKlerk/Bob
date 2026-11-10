// Pre-application-feature fixtures still use the CURRENT installed native runtime.
// Seed its fresh floor before creating any native database; this is not an upgrade
// shortcut and must never be called for an existing native database.
import {prepareFreshPi15Floor,prepareFreshPi151Floor,installedDurableVersion,pi151Fingerprint} from '../../src/maintenance-migration.js';
export function prepareCurrentRuntimeFixtureFloor(directory:string){
 if(installedDurableVersion()==='1.5.0')return prepareFreshPi15Floor(directory);
 return prepareFreshPi151Floor(directory,{id:'synthetic-fixture',cli:new URL('../../src/cli.js',import.meta.url).pathname,durableVersion:'1.5.1',compatibility:pi151Fingerprint});
}
