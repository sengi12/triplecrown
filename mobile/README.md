# TripleCrown on a phone — the native shells

One Capacitor project wraps the app for **Android** (today) and **iOS** (add the platform
when you have Xcode). The shell loads the live site, `https://sengi12.github.io/triplecrown/`,
so every push to `main` updates the app in the store with no resubmission — the same
pipeline you already run. The service worker keeps it usable on a weak connection.

## Build an APK you can sideload today

```sh
cd mobile
npm install                 # once
npx cap sync                # after any change to capacitor.config.json
export JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home -v 19)
npm run apk                 # → android/app/build/outputs/apk/debug/app-debug.apk
```

Copy `app-debug.apk` to the phone (AirDrop, Drive, `adb install app-debug.apk`) and open it;
Android asks once to allow installs from that source. The debug build is signed with a
throwaway debug key, which is fine for your own phone.

## Updating the app on your phone

The shell loads the live site, so the APP updates itself: push to `main`, and the next
open (or the service worker's background refresh) has it. You rebuild and reinstall the
APK only when the SHELL changes — the icon, the name, the version, a native plugin:

```sh
cd mobile
npx cap sync
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
npm run apk
```

Installing the new APK over the old one keeps your data (the site's storage lives with the
app) as long as both are signed with the same key — debug over debug, release over
release. A release build cannot install over a debug build: uninstall first, once.

## The icon and splash

`assets/` holds the sources (`icon-only.png`, `icon-foreground.png`, `icon-background.png`
at 1024, `splash.png` at 2732); `npx capacitor-assets generate --android` writes every
launcher size and the adaptive icon into `android/app/src/main/res/`. Re-run it after
changing a source, then rebuild.

## Release builds for Google Play

1. Create an upload key once, OUTSIDE the repo (it is git-ignored anyway):
   ```sh
   keytool -genkeypair -v -keystore ~/triplecrown-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Put the signing config in `android/keystore.properties` (also git-ignored):
   ```
   storeFile=/Users/you/triplecrown-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```
   and reference it from `android/app/build.gradle` (`signingConfigs.release`) — the
   Capacitor docs' standard block.
3. `npm run aab` → `android/app/build/outputs/bundle/release/app-release.aab`, the file
   Play Console takes. Play App Signing holds the release key; keep the upload key backed up.
4. Play Console needs: a $25 developer account, a privacy policy URL (the app keeps all data
   on the device and talks to Sleeper and ESPN), the closed test (12+ testers for 14 days
   on a newer personal account) before production, and a target SDK that Capacitor's
   yearly update keeps current (`npm update @capacitor/android && npx cap sync`).

Bump `versionCode` / `versionName` in `android/app/build.gradle` per store release.

## iOS, when you're ready

Install full Xcode from the App Store (the command-line tools alone cannot build an app),
then:

```sh
cd mobile
npm install @capacitor/ios
npx cap add ios
npx cap open ios            # Xcode: set your team, then Product → Archive for TestFlight / the App Store
```

Same shell, same live site. App Store review wants an app that does more than frame a
web page; TripleCrown does (projections, drafts, league tools, local data), but describe
it that way in the listing. Apple needs a $99/year developer account and a privacy policy.

## Bundled instead of live

`capacitor.config.json` points the shell at the live site. To ship the app's files inside
the binary instead (fully offline, but every data refresh then needs a store release),
remove the `server` block, copy `../index.html`, `../sw.js`, `../manifest.webmanifest`,
`../images/` and `../seeds/*.gz` into `www/`, and `npx cap sync`. The live-site shell is
the right default while the seeds refresh several times a day.
