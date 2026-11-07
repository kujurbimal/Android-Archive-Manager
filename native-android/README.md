# Archive Manager+ — Native Android

This directory contains a native Kotlin/Jetpack Compose Android starter for the Archive Manager+ name and package ID.

## Build
- Android Studio with JDK 17
- Android SDK Platform 36 and matching Build Tools
- Open this `native-android` directory as the Gradle project
- Sync Gradle, then run on a physical device or emulator
- Release bundle: **Build → Generate Signed Bundle / APK → Android App Bundle**

## App identity
- Display name: Archive Manager+
- Application ID: `com.kujurbimal.archivemanager`
- Minimum SDK: 24
- Target SDK: 36
- Version: 1.0.0 (versionCode 1)

## Implemented archive features
- Import multiple documents through Android's Storage Access Framework and remember read access where the provider supports persistable permissions.
- Search the local library, sort by name or reverse insertion order, and toggle light/dark appearance.
- Inspect ZIP, TAR, TAR.GZ, GZIP, 7z and RAR entry names.
- Create ZIP, TAR, TAR.GZ, GZIP (one source file) and 7z archives from selected files.
- Extract ZIP, TAR, TAR.GZ, GZIP, 7z and RAR into a user-selected folder using Android's document provider.
- Extraction rejects absolute paths and parent traversal, blocks TAR links/device entries, stages output before copying, caps archive entries at 10,000 and expanded data at 1 GiB.
- RAR is extraction-only; creating RAR archives is not supported.
- Archive operations run off the main thread. The app does not request broad storage permissions.

## Known limitations / production hardening still required
- Archive creation currently accepts selected files, not recursive folder trees.
- RAR password-protected archives and multi-volume archives need dedicated UX and device testing; some methods/variants may not be supported by Junrar.
- ZIP symlink metadata is not preserved; extraction writes file contents as regular files.
- There is no archive integrity/checksum verification UI, pause/resume, or detailed per-file progress yet.
- Validate duplicate filenames, provider-specific document permissions, low-storage conditions, very large inputs, malformed archives, encrypted archives, and Android 8–16 devices before release.

## Before Play production
1. Run Gradle sync and compile with the current Android Gradle Plugin/Kotlin versions.
2. Test on Android 8–16 devices; fix all build, accessibility, lifecycle, and edge-case issues.
3. Implement archive creation and secure extraction before advertising them.
4. Add automated unit/instrumentation tests, including malformed archives and ZIP path traversal cases.
5. Replace draft privacy-policy placeholders and host the policy at a public HTTPS URL.
6. Complete Play Console app content, Data safety, content rating, target audience, ads, and store listing declarations truthfully.
7. Generate and securely back up your upload key; never commit keystores or passwords.
8. Upload an AAB to Internal testing and test the Play-delivered build before production.
