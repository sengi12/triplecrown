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

## iOS

The iOS project is committed under `ios/` (Pods, DerivedData and the copied web assets
are git-ignored; `pod install` recreates Pods). Same shell, same live site. Built and run
on the iOS 27 Simulator with Xcode 27 on 2026-09-17.

Toolchain, once per Mac: full Xcode from the App Store (the command-line tools alone cannot
build an app), then

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -downloadPlatform iOS        # the iOS SDK + Simulator runtime (Xcode 27 does not bundle it)
brew install cocoapods                  # Capacitor's iOS plugins are CocoaPods
```

Then:

```sh
cd mobile
npm install
cd ios/App && pod install && cd ../..
npm run ios:sim                         # builds for the Simulator, installs, launches (no account needed)
npx cap open ios                        # Xcode, for your own iPhone or a store build
```

Two things Capacitor 7's template does not have, both kept in the project:

- **Deployment target 15.0.** Xcode 27 builds for iOS 15.0 and up; the template and its
  pods declare 14.0. `ios/App/Podfile` sets 15.0 and pins every pod target to it in
  `post_install`; the app target is 15.0 in `App.xcodeproj`.
- **The scene lifecycle.** iOS 27 traps at launch (`SIGTRAP` in UIKit's
  "no scene lifecycle adoption" check; the app never appears) for an app on the old
  app-delegate window lifecycle, which the template is. `Info.plist` carries
  `UIApplicationSceneManifest` pointing the scene at the storyboard (whose root is
  `CAPBridgeViewController`) and at `SceneDelegate` in `AppDelegate.swift`, which forwards
  URL opens to Capacitor's `ApplicationDelegateProxy` so the App plugin still raises
  `appUrlOpen` for the sign-in return.

The sign-in return scheme (`com.sengi.triplecrown://auth/callback`, see below) is declared
as a URL type in `Info.plist`; iOS offers "Open in TripleCrown?" for such a link.

**Your own iPhone, free.** Sign in to Xcode with an Apple ID (Xcode → Settings → Accounts):
a free account gives a "Personal Team". In Xcode select the App target → Signing &
Capabilities → your team, plug the phone in, pick it as the run destination, Run. The first
time, the phone asks you to trust the developer (Settings → General → VPN & Device
Management). Free signing lasts 7 days and covers three apps; re-run from Xcode to renew.

**TestFlight / the App Store** need the $99/year Apple Developer Program and a privacy
policy. App Store review wants an app that does more than frame a web page; TripleCrown
does (projections, drafts, league tools, local data), but describe it that way in the
listing. Product → Archive in Xcode with your team selected; nothing in the project changes.

## Bundled instead of live

`capacitor.config.json` points the shell at the live site. To ship the app's files inside
the binary instead (fully offline, but every data refresh then needs a store release),
remove the `server` block, copy `../index.html`, `../sw.js`, `../manifest.webmanifest`,
`../images/` and `../seeds/*.gz` into `www/`, and `npx cap sync`. The live-site shell is
the right default while the seeds refresh several times a day.

## Sign-in with Google inside the app

Inside the shell a plain OAuth navigation would leave the app for the phone's browser and
never return, and Google refuses to sign in inside an embedded WebView. So the app opens
Google in the system browser (the `@capacitor/browser` plugin, a Chrome Custom Tab) and
Supabase sends the code back on the app's own scheme, `com.sengi.triplecrown://auth/callback`
— an intent filter in `android/app/src/main/AndroidManifest.xml`, and the `@capacitor/app`
plugin hands the URL to the page (src/js/86-supabase.js exchanges the code).

The return trip goes through an https page first: Supabase is told to send the browser to
`https://sengi12.github.io/triplecrown/native-auth.html` (browsers other than Chrome refuse
a redirect straight to a custom scheme — Vivaldi sat on a blank Supabase page), and that
page hops into the app: on Android an `intent://…#Intent;scheme=com.sengi.triplecrown;
package=com.sengi.triplecrown;…;end` URL, the one form every Chromium browser hands to the
app that owns the scheme (a plain custom-scheme link is dropped by some), with a fallback
back to the page when no app answers; elsewhere the plain scheme. The page moves the
implicit flow's hash tokens into the query, since an intent URL keeps its own fragment, and
the app reads them from either place.

One thing lives outside the repo: in the Supabase dashboard, **Authentication → URL
Configuration → Redirect URLs**, add both `https://sengi12.github.io/triplecrown/native-auth.html`
and `com.sengi.triplecrown://auth/callback`. Without the first Supabase refuses the redirect
and the sign-in ends on an error page. Keep the site URL there too for the browser. When iOS
arrives, add the same scheme as a URL type in Xcode (Info → URL Types), nothing else changes.
