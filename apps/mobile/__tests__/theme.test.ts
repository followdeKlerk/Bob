const {readFileSync}=jest.requireActual('node:fs');
const {resolve}=jest.requireActual('node:path');
declare const __dirname:string;
import {colors} from '../theme';
const source=(path:string)=>readFileSync(resolve(__dirname,'..',path),'utf8');
test('app background is pure black while raised controls remain distinguishable',()=>{
 expect(colors.background).toBe('#000000');expect(colors.surface).not.toBe(colors.background);expect(colors.composer).not.toBe(colors.background);
 expect(source('tailwind.config.js')).toContain("background:'#000000'");
});
test('Android launch window and system bars use the same pure-black background',()=>{
 const styles=source('android/app/src/main/res/values/styles.xml');
 for(const name of ['windowBackground','colorBackground','statusBarColor','navigationBarColor'])expect(styles).toContain(`<item name="android:${name}">#000000</item>`);
});
test('interactive host chrome matches the app without recoloring user-generated visuals',()=>{
 const native=source('android/app/src/main/java/com/bobmobile/BobInteractive.kt');expect(native).toContain('setBackgroundColor(0xff000000.toInt())');expect(native).toContain('margin:0;background:#000000');
 expect(source('../interactive/host.ts')).toContain('border:0;background:#000000');
});

const tailwind=require('../tailwind.config');
test('native and utility chrome use only black, white and grayscale tokens',()=>{
 for(const color of [...Object.values(colors),...Object.values(tailwind.theme.extend.colors)] as string[]){
  expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(color.slice(1,3)).toBe(color.slice(3,5));expect(color.slice(3,5)).toBe(color.slice(5,7));
 }
 expect(tailwind.theme.extend.colors.primary).toBe(colors.accent);
 expect(tailwind.theme.extend.colors['primary-foreground']).toBe(colors.onAccent);
});
