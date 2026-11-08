import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

const manifestPath = 'android-native/app/src/main/AndroidManifest.xml';
let xml = await readFile(manifestPath, 'utf8');
const activityPattern = /<activity\\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>[\\s\\S]*?<\\/activity>/;
const match = xml.match(activityPattern);
if (!match) throw new Error('Could not find Capacitor MainActivity in AndroidManifest.xml');
if (match[0].includes('android:scheme="monetra"')) {
  console.log('Monetra SSO deep link is already configured.');
} else {
  let activity = match[0];
  activity = activity.replace(/<activity\\b([^>]*)>/, (_whole, attrs) => {
    const updated = /android:launchMode=/.test(attrs) ? attrs : attrs + ' android:launchMode="singleTask"';
    return '<activity' + updated + '>';
  });
  const filter = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="monetra" android:host="sso-callback" />
        </intent-filter>`;
  activity = activity.replace('</activity>', filter + '\\n    </activity>');
  xml = xml.replace(match[0], activity);
  await writeFile(manifestPath, xml);
  console.log('Configured monetra://sso-callback for Clerk OAuth.');
}
