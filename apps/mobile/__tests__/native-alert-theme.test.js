const fs = require('fs');
const path = require('path');

// Source/resource contract only: Android inflation and physical contrast require device testing.
const mobile = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(mobile, file), 'utf8');
const styles = read('android/app/src/main/res/values/styles.xml');
const activity = read('android/app/src/main/java/com/bobmobile/MainActivity.kt');
const fragment = read('node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/dialog/AlertFragment.kt');
const block = (name) => {
  const escaped = name.replace(/\./g, '\\.');
  const result = styles.match(new RegExp(`<style name="${escaped}"[^>]*>([\\s\\S]*?)</style>`));
  if (!result) throw new Error(`Missing style ${name}`);
  return result[1];
};
const contrast = (a, b) => {
  const luminance = (hex) => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const item = (xml, name) => xml.match(new RegExp(`<item name="${name}">([^<]+)</item>`))?.[1] ?? '';

test.each(['Light', 'Dark'])('pairs Activity title and AppCompat body/buttons for %s alerts', mode => {
  const owner = block(`BobAlertOwner.${mode}`), dialog = block(`BobAlert.${mode}`), title = block(`BobAlertTitle.${mode}`);
  expect(item(owner, 'alertDialogTheme')).toBe(`@style/BobAlert.${mode}`);
  expect(item(owner, 'android:windowTitleStyle')).toBe(`@style/BobAlertTitle.${mode}`);
  const bg = item(dialog, 'android:windowBackground');
  expect(item(dialog, 'android:colorBackground')).toBe(bg);
  for (const color of [item(title, 'android:textColor'), item(dialog, 'android:textColorPrimary'), item(dialog, 'android:textColorSecondary'), item(dialog, 'colorAccent'), item(dialog, 'android:colorAccent')]) {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(bg, color)).toBeGreaterThanOrEqual(4.5);
  }
});

test('follows Bob appearance without recreation and retains RN native dialog ownership', () => {
  expect(activity).toContain('BobAppearance.palette(this@MainActivity).light');
  expect(activity).toContain('BobAppearance.addListener(alertAppearance)');
  expect(activity).toContain('BobAppearance.removeListener(alertAppearance)');
  expect(activity).toContain('alertAppearance.applyAppearance()');
  expect(fragment).toContain('getAccessibleTitle(activityContext, title)');
  expect(fragment).toContain('AlertDialog.Builder(activityContext)');
});
