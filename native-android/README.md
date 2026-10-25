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

## Current prototype scope
- Uses Android's Storage Access Framework; no broad storage permission is requested.
- Adds selected documents to an in-session list.
- Can inspect ZIP central-directory entries by copying the selected document temporarily into app cache.
- The original selected file is not modified.
- This is a starter implementation, not a complete archive utility. TAR/7z/RAR support, archive creation, safe extraction, checksum verification, persistent library metadata, and comprehensive error/security tests are not implemented.

## Before Play production
1. Run Gradle sync and compile with the current Android Gradle Plugin/Kotlin versions.
2. Test on Android 8–16 devices; fix all build, accessibility, lifecycle, and edge-case issues.
3. Implement archive creation and secure extraction before advertising them.
4. Add automated unit/instrumentation tests, including malformed archives and ZIP path traversal cases.
5. Replace draft privacy-policy placeholders and host the policy at a public HTTPS URL.
6. Complete Play Console app content, Data safety, content rating, target audience, ads, and store listing declarations truthfully.
7. Generate and securely back up your upload key; never commit keystores or passwords.
8. Upload an AAB to Internal testing and test the Play-delivered build before production.
