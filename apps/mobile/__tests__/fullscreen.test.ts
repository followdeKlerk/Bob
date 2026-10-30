declare const __dirname:string;
const {readFileSync}=jest.requireActual('node:fs'),{resolve}=jest.requireActual('node:path');
const source=(path:string):string=>readFileSync(resolve(__dirname,'..',path),'utf8');
const native=(name:string)=>source('android/app/src/main/java/com/bobmobile/'+name+'.kt');
test('fullscreen hides only the status bar and leaves Home/overview available without a reveal swipe',()=>{
 const text=native('BobFullscreen');
 expect(text.match(/\bhide\([^\n]+/g)).toEqual(['hide(WindowInsetsCompat.Type.statusBars())']);
 expect(text).toContain('show(WindowInsetsCompat.Type.navigationBars())');
 expect(text).toContain('systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT');
 expect(text).not.toMatch(/BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE|SYSTEM_UI_FLAG_|Type\.ime\(|[Ss]ystemGestureExclusionRects|setOnTouchListener|onInterceptTouchEvent|dispatchTouchEvent|startLockTask|postDelayed|setInterval/);
});
test('visible navigation stays transparent and edge-to-edge without a system contrast scrim',()=>{
 const text=native('BobFullscreen');
 expect(text).toContain('WindowCompat.setDecorFitsSystemWindows(window, false)');
 expect(text).toContain('window.navigationBarColor = Color.TRANSPARENT');
 expect(text).toMatch(/if \(Build\.VERSION\.SDK_INT >= 29\)\s*\{\s*window\.isNavigationBarContrastEnforced = false/);
});
test('owned activities and React modal windows share fullscreen policy and clean up focus listeners',()=>{
 const text=native('BobFullscreen'),platform=native('BobPlatform');
 expect(native('MainApplication')).toContain('BobFullscreen.install(this)');
 expect(text).toContain('override fun onActivityResumed');expect(text).toContain('if (focused) apply(window)');expect(text).toContain('removeOnWindowFocusChangeListener');expect(text).toContain('WeakHashMap<Window, WeakReference<');
 expect(platform).toContain('context.addExtraWindowEventListener(fullscreenListener)');expect(platform).toContain('BobFullscreen.attach(window)');expect(platform).toContain('BobFullscreen.detach(window)');expect(platform).toContain('context.removeExtraWindowEventListener(fullscreenListener)');
});
test('native interactive and attachment previews preserve display-cutout clearance in fullscreen',()=>{
 expect(native('BobFullscreen')).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES');
 for(const name of ['BobInteractive','BobPreviewActivity']){
  const text=native(name);expect(text).toContain('WindowInsetsCompat.Type.displayCutout()');expect(text).toContain('safe.left');expect(text).toContain('safe.right');
 }
});
test('React leaves Android bar control to the native fullscreen owner, without removing safe areas',()=>{
 const app=source('App.tsx');expect(app.match(/Platform\.OS!=='android'&&<StatusBar hidden/g)).toHaveLength(2);
 expect(app).toContain("edges={Platform.OS==='android'?['left','right','bottom']:undefined}");
 expect(source('android/app/src/main/res/values/styles.xml')).not.toContain('name="android:windowFullscreen"');
});

export {};
