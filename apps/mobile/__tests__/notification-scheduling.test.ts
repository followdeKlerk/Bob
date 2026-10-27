declare const __dirname:string;
const {readFileSync}=jest.requireActual('node:fs'),{resolve}=jest.requireActual('node:path');
const source=(path:string):string=>readFileSync(resolve(__dirname,'../android/app/'+path),'utf8');
test('generic monitoring is not a foreground service; location retains its required visible foreground service',()=>{
 const native=source('src/main/java/com/bobmobile/BobNotifications.kt'),manifest=source('src/main/AndroidManifest.xml');
 expect(native).toContain('OneTimeWorkRequestBuilder<BobNotificationWorker>');expect(native).toContain('PeriodicWorkRequestBuilder<BobNotificationWorker>(15, TimeUnit.MINUTES)');
 expect(native).not.toMatch(/\b(startForeground|startForegroundService|setForeground|setForegroundAsync)\s*\(/);
 expect(manifest).not.toContain('.BobNotificationService');expect(manifest).not.toContain('FOREGROUND_SERVICE_SPECIAL_USE');expect(manifest).toContain('.BobLocationService');expect(manifest).toContain('FOREGROUND_SERVICE_LOCATION');
});
test('scheduled job payloads contain an identity, not a bearer; stored watch records use authenticated encrypted bytes',()=>{
 const native=source('src/main/java/com/bobmobile/BobNotifications.kt'),store=source('src/main/java/com/bobmobile/NotificationWatchStore.kt');
 expect(native).toContain('Data.Builder().putString("identity", identity).build()');expect(native).not.toMatch(/putString\("token"/);
 expect(store).toContain('AndroidKeyStore');expect(store).toContain('NotificationCipher.encrypt');expect(store).toContain('Base64.encodeToString(box.ciphertext');
});

export {};

test('Settings copy distinguishes scheduled notifications from the visible location service',()=>{
 const app=readFileSync(resolve(__dirname,'../App.tsx'),'utf8');
 expect(app).toContain('Android schedules background checks and may delay delivery');
 expect(app).toContain('Automatic location has its own visible service notification');
 expect(app).not.toContain('Android requires a silent background-monitoring indicator');
});
