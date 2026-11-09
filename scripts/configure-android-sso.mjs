import { mkdir, readFile, writeFile } from 'node:fs/promises';

const manifestPath = 'android-native/app/src/main/AndroidManifest.xml';
let xml = await readFile(manifestPath, 'utf8');
const activityPattern = /<activity\\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>[\\s\\S]*?<\\/activity>/;
const match = xml.match(activityPattern);
if (!match) throw new Error('Could not find Capacitor MainActivity in AndroidManifest.xml');

if (!match[0].includes('android:scheme="monetra"')) {
  let activity = match[0].replace(/<activity\\b([^>]*)>/, (_whole, attrs) => {
    const updated = /android:launchMode=/.test(attrs) ? attrs : attrs + ' android:launchMode="singleTask"';
    return '<activity' + updated + '>';
  });
  const filter = [
    '        <intent-filter>',
    '            <action android:name="android.intent.action.VIEW" />',
    '            <category android:name="android.intent.category.DEFAULT" />',
    '            <category android:name="android.intent.category.BROWSABLE" />',
    '            <data android:scheme="monetra" android:host="sso-callback" />',
    '        </intent-filter>',
  ].join('\\n');
  activity = activity.replace('</activity>', filter + '\\n    </activity>');
  xml = xml.replace(match[0], activity);
  console.log('Configured monetra://sso-callback for Clerk OAuth.');
}

xml = xml.replace(/<application\\b([^>]*)>/, (_whole, attrs) => {
  let updated = attrs
    .replace(/\\s+android:icon="[^"]*"/, '')
    .replace(/\\s+android:roundIcon="[^"]*"/, '');
  updated += ' android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"';
  return '<application' + updated + '>';
});
await writeFile(manifestPath, xml);

// Monetra launcher mark: the same three-bar symbol used by public/icon.svg.
const res = 'android-native/app/src/main/res';
await mkdir(res + '/drawable', { recursive: true });
await mkdir(res + '/mipmap-anydpi', { recursive: true });
await mkdir(res + '/mipmap-anydpi-v26', { recursive: true });

const legacyIcon = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="64dp" android:height="64dp"
    android:viewportWidth="64" android:viewportHeight="64">
    <path android:fillColor="#0f766e" android:pathData="M18,0 H46 C55.94,0 64,8.06 64,18 V46 C64,55.94 55.94,64 46,64 H18 C8.06,64 0,55.94 0,46 V18 C0,8.06 8.06,0 18,0 Z"/>
    <path android:fillColor="#ecfdf5" android:pathData="M17,21h30v7H17zM21,32h22v7H21zM25,43h14v7H25z"/>
</vector>
`;
const foreground = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="64" android:viewportHeight="64">
    <path android:fillColor="#ecfdf5" android:pathData="M17,21h30v7H17zM21,32h22v7H21zM25,43h14v7H25z"/>
</vector>
`;
const background = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#0f766e"/>
</shape>
`;
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_monetra_background"/>
    <foreground android:drawable="@drawable/ic_monetra_foreground"/>
</adaptive-icon>
`;
await writeFile(res + '/drawable/ic_monetra_launcher.xml', legacyIcon);
await writeFile(res + '/drawable/ic_monetra_foreground.xml', foreground);
await writeFile(res + '/drawable/ic_monetra_background.xml', background);
await writeFile(res + '/mipmap-anydpi/ic_launcher.xml', legacyIcon);
await writeFile(res + '/mipmap-anydpi/ic_launcher_round.xml', legacyIcon);
await writeFile(res + '/mipmap-anydpi-v26/ic_launcher.xml', adaptive);
await writeFile(res + '/mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);

// Apply Android system-bar and display-cutout insets to the WebView itself.
// This prevents the WebView header and tap targets from sitting under the clock,
// battery, camera cutout, or navigation bar on Android 15+ edge-to-edge devices.
const javaDir = 'android-native/app/src/main/java/com/flickscient/monetra';
await mkdir(javaDir, { recursive: true });
const mainActivity = `package com.flickscient.monetra;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.rgb(17, 24, 21));
        getWindow().setNavigationBarColor(Color.rgb(17, 24, 21));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        WebView webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
`;
await writeFile(javaDir + '/MainActivity.java', mainActivity);

// capacitor-clerk applies the Kotlin Android plugin without declaring a version.
const settingsPath = 'android-native/settings.gradle';
let settings = await readFile(settingsPath, 'utf8');
if (!settings.includes("id 'org.jetbrains.kotlin.android' version '2.1.20'")) {
  const pluginManagement = [
    'pluginManagement {',
    '    repositories {',
    '        google()',
    '        mavenCentral()',
    '        gradlePluginPortal()',
    '    }',
    '    plugins {',
    "        id 'org.jetbrains.kotlin.android' version '2.1.20'",
    '    }',
    '}',
    '',
  ].join('\\n');
  settings = pluginManagement + settings;
  await writeFile(settingsPath, settings);
  console.log('Pinned Kotlin Android Gradle plugin 2.1.20 for capacitor-clerk.');
}
console.log('Configured Monetra launcher icons and Android system-bar insets.');
