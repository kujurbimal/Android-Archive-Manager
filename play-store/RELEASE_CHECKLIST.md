# Archive Manager+ — Play Console release checklist

- [ ] Confirm app feature set is complete and matches the store listing.
- [ ] Build and test debug and release variants on Android 8–16.
- [ ] Confirm application ID is correct and will remain stable.
- [ ] Confirm target SDK meets the current Play Console requirement at submission time.
- [ ] Set a unique versionCode for each uploaded bundle.
- [ ] Create an upload key; store keystore and passwords outside the repository.
- [ ] Build a signed Android App Bundle (.aab).
- [ ] Test the AAB through an Internal testing track.
- [ ] Host the reviewed privacy policy at a publicly accessible HTTPS URL.
- [ ] Complete Data safety based on the actual shipped code and every SDK.
- [ ] Complete content rating, target audience, ads, app access, and other declarations accurately.
- [ ] Upload 512×512 icon, 1024×500 feature graphic, and real device screenshots.
- [ ] Check pre-launch report, accessibility, crashes, ANRs, and policy warnings.
- [ ] Confirm any personal developer-account testing requirements shown in Play Console.
- [ ] Submit for production review only after all checks pass.

Never commit upload keys, signing passwords, API secrets, or user data to Git.
